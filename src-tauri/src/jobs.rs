//! Download jobs: yt-dlp sidecar orchestration with tree-kill guarantees.
//!
//! Kill policy (do not weaken): cancelling or watchdog-firing kills the whole
//! process TREE — yt-dlp forks ffmpeg for merges, and killing only yt-dlp
//! orphans ffmpeg holding file locks. Unix: setsid at spawn + killpg.
//! Windows: Job Object with KILL_ON_JOB_CLOSE assigned right after spawn.

use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;

use crate::tools;

const IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RETRIES: u32 = 3;

#[derive(Clone, Debug)]
pub struct DownloadSpec {
    pub url: String,
    pub video_id: Option<String>,
    pub container: String,
    pub quality: serde_json::Value,
    pub codec: Option<String>,
    pub audio_tracks: Vec<String>,
    pub captions: Vec<String>,
    /// Captions-only: no media, just sidecar subtitle files.
    pub captions_only: bool,
    pub out_dir: String,
    pub title: Option<String>,
    pub overwrite: bool,
    pub split_kinds: bool,
}

fn sanitize_name(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    trimmed.chars().take(120).collect()
}

fn codec_label(codec: &Option<String>) -> Option<&'static str> {
    match codec.as_deref() {
        Some("avc") => Some("AVC"),
        Some("hevc") => Some("HEVC"),
        Some("vp9") => Some("VP9"),
        Some("av1") => Some("AV1"),
        _ => None,
    }
}

const AUDIO_ONLY: [&str; 5] = ["mp3", "m4a", "opus", "wav", "flac"];

/// Post-download: rename to quality/codec (video) or language (audio) tags
/// and move sidecar subs into Captions/ when splitting. Returns final path.
async fn finalize_file(spec: &DownloadSpec, path: Option<String>) -> Option<String> {
    let path = path?;
    let src = std::path::Path::new(&path);
    let parent = src.parent()?.to_path_buf();
    let ext = src.extension()?.to_string_lossy().to_string();
    let stem = src.file_stem()?.to_string_lossy().to_string();
    let tag = if AUDIO_ONLY.contains(&spec.container.as_str()) {
        spec.audio_tracks
            .first()
            .cloned()
            .unwrap_or_else(|| "original".to_string())
    } else {
        let q = spec
            .quality
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                spec.quality
                    .as_u64()
                    .map(|n| n.to_string())
                    .unwrap_or_default()
            });
        let q = if q == "best" || q.is_empty() {
            "best".to_string()
        } else {
            format!("{q}p")
        };
        match codec_label(&spec.codec) {
            Some(c) => format!("{q}-{c}"),
            None => q,
        }
    };
    let final_name = sanitize_name(&format!("{stem} [{tag}].{ext}"));
    let final_path = parent.join(&final_name);
    let final_str = match std::fs::rename(&src, &final_path) {
        Ok(()) => final_path.to_string_lossy().to_string(),
        Err(_) => path,
    };
    if spec.split_kinds && !spec.captions_only && !spec.captions.is_empty() {
        let cap_dir = parent.join("Captions");
        let _ = std::fs::create_dir_all(&cap_dir);
        if let Ok(entries) = std::fs::read_dir(&parent) {
            for entry in entries.flatten() {
                let p = entry.path();
                let is_sub = p
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e == "srt" || e == "vtt");
                let same_video = match (&spec.video_id, p.file_name().and_then(|n| n.to_str())) {
                    (Some(id), Some(name)) => name.contains(id.as_str()),
                    _ => false,
                };
                if is_sub && same_video {
                    if let Some(name) = p.file_name() {
                        let _ = std::fs::rename(&p, cap_dir.join(name));
                    }
                }
            }
        }
    }
    Some(final_str)
}

/// List existing outputs mentioning a video id (overwrite pre-check).
pub async fn existing_outputs(out_dir: &str, video_id: &str) -> Vec<String> {
    let mut out = vec![];
    if video_id.is_empty() {
        return out;
    }
    if let Ok(entries) = std::fs::read_dir(out_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                    if name.contains(video_id) {
                        out.push(name.to_string());
                    }
                }
            }
        }
    }
    out.sort();
    out
}

#[derive(Clone, Debug, Default)]
struct JobView {
    status: String,
    percent: f64,
    speed: Option<String>,
    eta: Option<String>,
    title: Option<String>,
    filepath: Option<String>,
    error: Option<String>,
    note: Option<String>,
}

struct JobHandle {
    view: JobView,
    // Unix: child started in its own session → killpg(child_pid).
    child_pid: Option<u32>,
    // Windows: Job Object address as usize — HANDLE (*mut c_void) is not
    // Send and must never live in shared state; reconstructed at kill time.
    #[cfg(windows)]
    job_object: Option<usize>,
    cancelled: bool,
}

type Jobs = Arc<Mutex<HashMap<String, JobHandle>>>;

fn jobs() -> Jobs {
    use std::sync::OnceLock;
    static CELL: OnceLock<Jobs> = OnceLock::new();
    CELL.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

/// Capped in-memory log ring (last 200 lines) backing `get_recent_logs`.
/// Everything here also goes to stderr, so `cargo tauri dev` shows it live.
fn logs() -> Arc<Mutex<Vec<String>>> {
    use std::sync::OnceLock;
    static CELL: OnceLock<Arc<Mutex<Vec<String>>>> = OnceLock::new();
    CELL.get_or_init(|| Arc::new(Mutex::new(Vec::new())))
        .clone()
}

pub(crate) fn blog(line: String) {
    eprintln!("[koutube] {line}");
    if let Ok(rt) = tokio::runtime::Handle::try_current() {
        rt.spawn(async move {
            let logs = logs();
            let mut guard = logs.lock().await;
            guard.push(line);
            if guard.len() > 200 {
                let excess = guard.len() - 200;
                guard.drain(..excess);
            }
        });
    }
}

pub async fn recent_logs() -> Vec<String> {
    logs().lock().await.clone()
}

fn emit_progress(app: &AppHandle, job_id: &str, view: &JobView) {
    if let Err(e) = app.emit(
        "dl://progress",
        serde_json::json!({
            "job_id": job_id, "status": view.status, "percent": view.percent,
            "speed": view.speed, "eta": view.eta, "title": view.title,
            "filepath": view.filepath, "error": view.error, "note": view.note,
        }),
    ) {
        blog(format!("emit dl://progress failed job={job_id}: {e}"));
    }
}

async fn emit_queue(app: &AppHandle) {
    let map = jobs();
    let guard = map.lock().await;
    let list: Vec<_> = guard
        .iter()
        .map(|(id, h)| {
            serde_json::json!({ "job_id": id, "status": h.view.status,
            "percent": h.view.percent, "title": h.view.title,
            "filepath": h.view.filepath, "error": h.view.error })
        })
        .collect();
    let _ = app.emit("queue://updated", serde_json::json!({ "jobs": list }));
}

async fn set_status(app: &AppHandle, job_id: &str, view: JobView) {
    {
        let map = jobs();
        let mut guard = map.lock().await;
        if let Some(h) = guard.get_mut(job_id) {
            h.view = view.clone();
        }
    }
    emit_progress(app, job_id, &view);
    emit_queue(app).await; // canonical snapshot AFTER every transition
}

/// Terminal transition: snapshot, then drop the job so the map can't leak.
async fn finish(app: &AppHandle, job_id: &str, view: JobView) {
    set_status(app, job_id, view).await;
    jobs().lock().await.remove(job_id);
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

fn is_playlist_url(url: &str) -> bool {
    url.contains("list=")
}

pub async fn resolve(app: &AppHandle, url: &str) -> Result<serde_json::Value> {
    blog(format!("resolve start url={}", short_url(url)));
    let (ytdlp, _) = tools::resolve_tool(app, "yt-dlp")
        .ok_or_else(|| anyhow!("yt-dlp missing: run setup first"))?;
    validate_url(url)?;
    let flat = is_playlist_url(url);
    let mut cmd = tokio::process::Command::new(&ytdlp);
    cmd.args(["--dump-json", "--no-warnings", "--socket-timeout", "15"]);
    if flat {
        cmd.args(["--flat-playlist", "--playlist-end", "50"]);
    } else {
        cmd.arg("--no-playlist");
    }
    cmd.arg(url).stdout(Stdio::piped()).stderr(Stdio::null());
    let out = tokio::time::timeout(Duration::from_secs(60), cmd.output())
        .await
        .map_err(|_| {
            blog(format!("resolve failed (timeout) url={}", short_url(url)));
            anyhow!("resolve timed out after 60s")
        })??;
    if !out.status.success() {
        blog(format!("resolve failed url={}", short_url(url)));
        return Err(anyhow!("resolve failed"));
    }
    let info: serde_json::Value = serde_json::from_slice(&out.stdout)?;
    let avatar = fetch_avatar(
        &ytdlp,
        info.get("uploader_url")
            .or_else(|| info.get("channel_url"))
            .and_then(|v| v.as_str()),
    )
    .await;
    blog(format!("resolve ok url={}", short_url(url)));
    Ok(build_resolve_payload(&info, avatar))
}

/// Best-effort channel avatar: second lightweight resolve of the channel
/// page, whose `thumbnails[]` carries `avatar_uncropped`. Cached per channel,
/// 10s timeout, failures yield None (UI falls back to initials).
fn avatar_cache() -> Arc<Mutex<HashMap<String, Option<String>>>> {
    use std::sync::OnceLock;
    static CELL: OnceLock<Arc<Mutex<HashMap<String, Option<String>>>>> = OnceLock::new();
    CELL.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

async fn fetch_avatar(ytdlp: &std::path::Path, channel_url: Option<&str>) -> Option<String> {
    let channel_url = channel_url?.to_string();
    if let Some(hit) = avatar_cache().lock().await.get(&channel_url) {
        return hit.clone();
    }
    let avatar = fetch_avatar_inner(ytdlp, &channel_url).await;
    avatar_cache()
        .lock()
        .await
        .insert(channel_url, avatar.clone());
    avatar
}

async fn fetch_avatar_inner(ytdlp: &std::path::Path, channel_url: &str) -> Option<String> {
    let mut cmd = tokio::process::Command::new(ytdlp);
    cmd.args([
        "--dump-json",
        "--skip-download",
        "--no-warnings",
        "--socket-timeout",
        "8",
        "--playlist-items",
        "0",
        channel_url,
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    let out = tokio::time::timeout(Duration::from_secs(10), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let info: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    // Priority: exact avatar entry, then any avatar-ish (non-banner) google
    // image. Banners (wide =w crops) must never become the "avatar".
    let mut thumbs = info
        .get("thumbnails")?
        .as_array()?
        .iter()
        .filter_map(|t| {
            let url = t.get("url")?.as_str()?;
            let id = t.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let score = if id == "avatar_uncropped" {
                0
            } else if id.contains("avatar") {
                1
            } else if url.contains("googleusercontent") && !url.contains("=w") {
                2
            } else {
                return None;
            };
            Some((score, url.to_string()))
        })
        .collect::<Vec<_>>();
    thumbs.sort_by_key(|(score, _)| *score);
    thumbs.into_iter().next().map(|(_, url)| url)
}

/// Log-safe URL: host + video id only, never tokens or full query strings.
fn short_url(url: &str) -> String {
    let id = url
        .split("v=")
        .nth(1)
        .and_then(|s| s.split('&').next())
        .unwrap_or("?");
    let host = url.split('/').nth(2).unwrap_or("?");
    format!("{host} v={id}")
}

fn validate_url(url: &str) -> Result<String> {
    let lower = url.to_lowercase();
    let ok_host = [
        "youtube.com",
        "youtu.be",
        "music.youtube.com",
        "youtube-nocookie.com",
    ]
    .iter()
    .any(|h| lower.contains(h));
    if !(lower.starts_with("http://") || lower.starts_with("https://")) || !ok_host {
        return Err(anyhow!("Only YouTube URLs are supported"));
    }
    Ok(url.to_string())
}

/// Same shape as the old /api/resolve so the frontend normalizer is reused,
/// plus channel metadata for the info card.
fn build_resolve_payload(info: &serde_json::Value, avatar: Option<String>) -> serde_json::Value {
    if info.get("_type").and_then(|v| v.as_str()) == Some("playlist")
        || info.get("entries").is_some()
    {
        let entries: Vec<_> = info
            .get("entries")
            .and_then(|e| e.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .take(50)
            .filter_map(|e| {
                let vid = e.get("id")?.as_str()?.to_string();
                Some(serde_json::json!({
                    "videoId": vid,
                    "title": e.get("title").and_then(|v| v.as_str()).unwrap_or(&vid),
                    "duration": e.get("duration"),
                    "thumbnail": e.get("thumbnail"),
                }))
            })
            .collect();
        return serde_json::json!({
            "videoId": null, "title": info.get("title").and_then(|v| v.as_str()).unwrap_or("Playlist"),
            "thumbnail": info.get("thumbnail"), "duration": null,
            "formats": [], "audioTracks": [], "manualCaptions": [],
            "is_playlist": true, "entries": entries,
        });
    }
    let formats = info
        .get("formats")
        .and_then(|f| f.as_array())
        .cloned()
        .unwrap_or_default();
    let mut seen_heights = std::collections::BTreeSet::new();
    let mut out_formats = vec![];
    for f in &formats {
        let h = f.get("height").and_then(|v| v.as_u64());
        let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
        if let Some(h) = h {
            if vcodec != "none" && seen_heights.insert(h) {
                out_formats.push(serde_json::json!({
                    "height": h, "ext": f.get("ext"),
                    "fps": f.get("fps"),
                    "filesize": f.get("filesize").or_else(|| f.get("filesize_approx")),
                    "vcodec": f.get("vcodec"), "acodec": f.get("acodec"),
                }));
            }
        }
    }
    // Manual captions ONLY: info["subtitles"], never automatic_captions, no live_chat.
    let mut caps = vec![];
    if let Some(subs) = info.get("subtitles").and_then(|s| s.as_object()) {
        let mut langs: Vec<_> = subs.keys().filter(|l| l.as_str() != "live_chat").collect();
        langs.sort();
        for lang in langs {
            caps.push(serde_json::json!({ "lang": lang, "label": lang }));
        }
    }
    // Audio tracks grouped by language. Original is detected via the
    // `format_note` "original" marker (maintainer recipe), falling back to
    // the first track. Exact-duplicate (lang) rows collapse into one.
    let mut seen_lang = std::collections::HashSet::new();
    let mut tracks: Vec<serde_json::Value> = vec![];
    let empty = vec![];
    let candidates: Vec<&serde_json::Value> = info
        .get("requested_formats")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty)
        .iter()
        .chain(formats.iter())
        .collect();
    for f in candidates {
        let lang = f
            .get("language")
            .and_then(|v| v.as_str())
            .unwrap_or("und")
            .to_string();
        if !seen_lang.insert(lang.clone()) {
            continue;
        }
        let marked = f
            .get("format_note")
            .and_then(|v| v.as_str())
            .is_some_and(|n| n.to_lowercase().contains("original"));
        tracks.push(serde_json::json!({ "lang": lang, "label": lang, "marked_original": marked }));
    }
    let any_marked = tracks.iter().any(|t| {
        t.get("marked_original")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    });
    for (i, t) in tracks.iter_mut().enumerate() {
        let is_original = t
            .get("marked_original")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
            || (!any_marked && i == 0);
        t.as_object_mut().map(|o| {
            o.remove("marked_original");
            o.insert("is_default".to_string(), serde_json::json!(is_original));
            o.insert("is_original".to_string(), serde_json::json!(is_original));
        });
    }
    serde_json::json!({
        "videoId": info.get("id"), "title": info.get("title").and_then(|v| v.as_str()).unwrap_or(""),
        "thumbnail": info.get("thumbnail"), "duration": info.get("duration"),
        "description": info.get("description").and_then(|v| v.as_str()).unwrap_or(""),
        "channel": info.get("channel").or_else(|| info.get("uploader")),
        "channelUrl": info.get("channel_url").or_else(|| info.get("uploader_url")),
        "channelVerified": info.get("channel_is_verified"),
        "subscribers": info.get("channel_follower_count"),
        "views": info.get("view_count"),
        "uploadDate": info.get("upload_date").or_else(|| info.get("release_date")),
        "timestamp": info.get("timestamp").or_else(|| info.get("release_timestamp")),
        "avatarUrl": avatar,
        "formats": out_formats, "audioTracks": tracks, "manualCaptions": caps,
        "is_playlist": false, "entries": [],
    })
}

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

/// Map UI codec names to yt-dlp vcodec matchers. `^=` is a prefix match;
/// HEVC needs alternation (hev1/hev* and hvc1 both occur in the wild).
fn vcodec_filter(codec: &str) -> Option<&'static str> {
    match codec {
        "avc" => Some("[vcodec^=avc]"),
        "hevc" => Some("[vcodec~=^(hev|hvc)]"),
        "vp9" => Some("[vcodec^=vp09]"),
        "av1" => Some("[vcodec^=av01]"),
        _ => None,
    }
}

fn quality_cap(quality: &serde_json::Value) -> String {
    if quality.as_str() == Some("best") {
        return String::new();
    }
    match quality
        .as_u64()
        .or_else(|| quality.as_str().and_then(|s| s.parse().ok()))
    {
        Some(q) => format!("[height<={q}]"),
        None => String::new(),
    }
}

/// Build the `-f` selector. Language matching uses the `^=` prefix operator:
/// YouTube tags dubs `en-US`/`es-419`, so exact `=` fails in the wild.
/// Every pinned track carries a `/bestaudio` fallback so a missing language
/// degrades instead of aborting the download.
fn build_format(
    quality: &serde_json::Value,
    container: &str,
    codec: &Option<String>,
    audio_langs: &[String],
) -> (String, bool) {
    if AUDIO_ONLY.contains(&container) {
        // One language per audio job (callers loop per track): pin it with
        // a `/bestaudio` fallback so a missing dub degrades instead of failing.
        let audio = match audio_langs.first() {
            Some(l) => format!("(bestaudio[language^={l}]/bestaudio)"),
            None => "bestaudio".to_string(),
        };
        return (format!("{audio}/best"), false);
    }
    let mut video = format!("bestvideo{}", quality_cap(quality));
    if let Some(c) = codec.as_deref().and_then(vcodec_filter) {
        video.push_str(c);
    }
    let audios: Vec<String> = if audio_langs.is_empty() {
        vec!["bestaudio".to_string()]
    } else {
        audio_langs
            .iter()
            .map(|l| format!("(bestaudio[language^={l}]/bestaudio)"))
            .collect()
    };
    let multi = audios.len() > 1;
    (format!("{}+{}/best", video, audios.join("+")), multi)
}

/// Subtitle args shared by the embed path and the captions-only path.
fn sub_args(langs: &[String], embed: bool) -> Vec<String> {
    let mut args = vec![
        "--write-subs".to_string(),
        "--sub-langs".to_string(),
        langs.join(","),
        "--sub-format".to_string(),
        "srt/best".to_string(),
    ];
    if embed {
        args.push("--embed-subs".to_string());
    }
    args
}

fn build_args(app: &AppHandle, spec: &DownloadSpec) -> Result<Vec<String>> {
    let (ffmpeg, _) = tools::resolve_tool(app, "ffmpeg")
        .ok_or_else(|| anyhow!("ffmpeg missing: run setup first"))?;
    let ffdir = ffmpeg
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if spec.captions_only {
        // Captions-only: no media stream, just sidecar subtitle files.
        let mut args = vec![
            "--newline".to_string(),
            "--no-warnings".to_string(),
            "--no-playlist".to_string(),
            "--socket-timeout".to_string(),
            "15".to_string(),
            "--retries".to_string(),
            "2".to_string(),
            "--ffmpeg-location".to_string(),
            ffdir,
            "-o".to_string(),
            format!("{}/%(title)s [%(id)s].%(ext)s", spec.out_dir),
            "--skip-download".to_string(),
        ];
        args.extend(sub_args(&spec.captions, false));
        if spec.overwrite {
            args.push("--force-overwrites".to_string());
        }
        args.push(spec.url.clone());
        return Ok(args);
    }
    let (format, multistreams) = build_format(
        &spec.quality,
        &spec.container,
        &spec.codec,
        &spec.audio_tracks,
    );
    let mut args = vec![
        "--newline".to_string(),
        "--no-warnings".to_string(),
        "--no-playlist".to_string(),
        "--socket-timeout".to_string(),
        "15".to_string(),
        "--retries".to_string(),
        "2".to_string(),
        "--ffmpeg-location".to_string(),
        ffdir,
        "-f".to_string(),
        format,
        "-o".to_string(),
        format!("{}/%(title)s [%(id)s].%(ext)s", spec.out_dir),
        "--print".to_string(),
        "after_move:filepath".to_string(),
    ];
    if multistreams {
        args.push("--audio-multistreams".to_string());
    }
    if AUDIO_ONLY.contains(&spec.container.as_str()) {
        args.extend([
            "-x".to_string(),
            "--audio-format".to_string(),
            spec.container.clone(),
            // Otherwise the source (usually webm) stays next to the extract.
            "--no-keep-video".to_string(),
        ]);
    } else {
        args.extend(["--merge-output-format".to_string(), spec.container.clone()]);
    }
    if !spec.captions.is_empty() {
        args.extend(sub_args(&spec.captions, true));
    }
    if spec.overwrite {
        args.push("--force-overwrites".to_string());
    }
    args.push(spec.url.clone());
    Ok(args)
}

pub async fn start_download(app: &AppHandle, spec: DownloadSpec) -> Result<String> {
    validate_url(&spec.url)?;
    std::fs::create_dir_all(&spec.out_dir).map_err(|e| anyhow!("bad folder: {e}"))?;
    remember_dir(&spec.out_dir).await;
    let job_id = format!("{:x}", randish());
    blog(format!(
        "download start job={job_id} url={} container={}",
        short_url(&spec.url),
        spec.container
    ));
    {
        let map = jobs();
        let mut guard = map.lock().await;
        guard.insert(
            job_id.clone(),
            JobHandle {
                view: JobView {
                    status: "queued".into(),
                    ..Default::default()
                },
                child_pid: None,
                #[cfg(windows)]
                job_object: None,
                cancelled: false,
            },
        );
    }
    set_status(
        app,
        &job_id,
        JobView {
            status: "queued".into(),
            ..Default::default()
        },
    )
    .await;
    let app2 = app.clone();
    let jid = job_id.clone();
    tauri::async_runtime::spawn(async move {
        run_with_retries(app2, jid, spec).await;
    });
    Ok(job_id)
}

fn randish() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    (t ^ (std::process::id() as u128)) as u64
}

async fn run_with_retries(app: AppHandle, job_id: String, spec: DownloadSpec) {
    for attempt in 0..=MAX_RETRIES {
        if is_cancelled(&job_id).await {
            return;
        }
        match run_once(&app, &job_id, &spec, attempt).await {
            Ok(done_path) => {
                let note = jobs()
                    .lock()
                    .await
                    .get(&job_id)
                    .and_then(|h| h.view.note.clone());
                let final_path = finalize_file(&spec, done_path).await;
                finish(
                    &app,
                    &job_id,
                    JobView {
                        status: "done".into(),
                        percent: 100.0,
                        title: spec.title.clone(),
                        filepath: final_path,
                        note,
                        ..Default::default()
                    },
                )
                .await;
                return;
            }
            Err(e) => {
                if is_cancelled(&job_id).await {
                    return;
                }
                if attempt == MAX_RETRIES {
                    finish(
                        &app,
                        &job_id,
                        JobView {
                            status: "error".into(),
                            title: spec.title.clone(),
                            error: Some(friendly_error(&e)),
                            ..Default::default()
                        },
                    )
                    .await;
                    return;
                }
                let wait = 2u64.pow(attempt) as u64;
                blog(format!(
                    "retry job={job_id} attempt={} wait={wait}s",
                    attempt + 1
                ));
                set_status(
                    &app,
                    &job_id,
                    JobView {
                        status: "retrying".into(),
                        error: Some(format!(
                            "stalled, retry {}/{} in {wait}s",
                            attempt + 1,
                            MAX_RETRIES
                        )),
                        ..Default::default()
                    },
                )
                .await;
                tokio::time::sleep(Duration::from_secs(wait)).await;
            }
        }
    }
}

async fn is_cancelled(job_id: &str) -> bool {
    jobs()
        .lock()
        .await
        .get(job_id)
        .map(|h| h.cancelled)
        .unwrap_or(true)
}

fn friendly_error(e: &anyhow::Error) -> String {
    let m = e.to_string().to_lowercase();
    for (needle, msg) in [
        ("private video", "This video is private."),
        ("video unavailable", "This video is unavailable or deleted."),
        ("age", "This video is age-restricted."),
        (
            "not available in your country",
            "This video is blocked in your region.",
        ),
        ("no video formats found", "No downloadable formats found."),
    ] {
        if m.contains(needle) {
            return msg.to_string();
        }
    }
    format!("Download failed: {e}")
}

async fn run_once(
    app: &AppHandle,
    job_id: &str,
    spec: &DownloadSpec,
    attempt: u32,
) -> Result<Option<String>> {
    let (ytdlp, _) = tools::resolve_tool(app, "yt-dlp")
        .ok_or_else(|| anyhow!("yt-dlp missing: run setup first"))?;
    let args = build_args(app, spec)?;
    set_status(
        app,
        job_id,
        JobView {
            status: if attempt == 0 {
                "downloading".into()
            } else {
                "retrying".into()
            },
            ..Default::default()
        },
    )
    .await;

    let mut cmd = tokio::process::Command::new(&ytdlp);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    unsafe {
        // Own session → the whole tree (yt-dlp + forked ffmpeg) dies on killpg.
        cmd.pre_exec(|| {
            nix::unistd::setsid()
                .map(|_| ())
                .map_err(std::io::Error::from)
        });
    }
    let mut child = cmd.spawn()?;
    let pid = child.id();
    blog(format!(
        "spawned job={job_id} pid={pid:?} attempt={attempt}"
    ));
    #[cfg(windows)]
    let job_object = assign_job_object(pid);
    {
        let map = jobs();
        let mut guard = map.lock().await;
        if let Some(h) = guard.get_mut(job_id) {
            h.child_pid = pid;
            #[cfg(windows)]
            {
                h.job_object = job_object;
            }
        }
    }

    let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
    let stderr = child.stderr.take().ok_or_else(|| anyhow!("no stderr"))?;
    // ffmpeg progress arrives on STDERR: drain it (never block the pipe),
    // timestamp it for the merge watchdog, and keep a tail so failures
    // quote yt-dlp's own diagnostics instead of dying silent.
    let err_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let tail_text = || {
        let err_tail = err_tail.clone();
        async move {
            let guard = err_tail.lock().await;
            let mut s: String = guard
                .iter()
                .rev()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join(" | ");
            if s.len() > 500 {
                s.truncate(500);
            }
            s
        }
    };
    // ffmpeg progress arrives on STDERR: drain it (never block the pipe),
    // timestamp it for the merge watchdog, and keep a tail so failures quote
    // yt-dlp's own diagnostics instead of dying silent.
    let last_io = Arc::new(Mutex::new(Instant::now()));
    {
        let last_io = last_io.clone();
        let err_tail = err_tail.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Some(l) = lines.next_line().await.unwrap_or(None) {
                *last_io.lock().await = Instant::now();
                let mut guard = err_tail.lock().await;
                guard.push(l);
                if guard.len() > 20 {
                    let excess = guard.len() - 20;
                    guard.drain(..excess);
                }
            }
        });
    }

    let mut reader = BufReader::new(stdout).lines();
    let mut last_out = Instant::now();
    let mut final_path: Option<String> = None;
    let mut merging = false;
    let mut logged_unparsed = false;
    loop {
        let line = tokio::time::timeout(Duration::from_secs(1), reader.next_line()).await;
        match line {
            Err(_) => {
                // 1s tick: watchdog check without blocking output.
                let quiet = last_out.elapsed() > IDLE_TIMEOUT;
                let merge_quiet = { *last_io.lock().await }.elapsed() > Duration::from_secs(120);
                if (quiet && !merging) || (merging && merge_quiet) {
                    blog(format!("watchdog kill job={job_id} merging={merging}"));
                    kill_tree(job_id).await;
                    let _ = child.wait().await;
                    return Err(anyhow!("stalled: no progress (merging heartbeat lost)"));
                }
                if is_cancelled(job_id).await {
                    kill_tree(job_id).await;
                    let _ = child.wait().await;
                    finish(
                        app,
                        job_id,
                        JobView {
                            status: "cancelled".into(),
                            ..Default::default()
                        },
                    )
                    .await;
                    return Err(anyhow!("cancelled"));
                }
                // Merging has no stdout cadence: heartbeat via ffmpeg stderr is
                // drained above; extend patience while the child lives.
                if merging {
                    match child.try_wait()? {
                        Some(_) => break,
                        None => continue,
                    }
                }
                continue;
            }
            Ok(Ok(None)) => break, // EOF
            Ok(Ok(Some(l))) => {
                last_out = Instant::now();
                let ev = parse_progress(&l).or_else(|| {
                    // Fallback: any percent in a [download] line counts, even
                    // when speed/ETA decorations differ by yt-dlp version.
                    if l.starts_with("[download]") {
                        if !logged_unparsed {
                            logged_unparsed = true;
                            blog(format!("unparsed progress job={job_id} line={l}"));
                        }
                        fallback_percent(&l).map(|p| (p, None, None))
                    } else {
                        None
                    }
                });
                if let Some(ev) = ev {
                    set_status(
                        app,
                        job_id,
                        JobView {
                            status: "downloading".into(),
                            percent: ev.0,
                            speed: ev.1,
                            eta: ev.2,
                            title: spec.title.clone(),
                            ..Default::default()
                        },
                    )
                    .await;
                } else if l.starts_with("[Merger]")
                    || l.starts_with("[EmbedSubtitle]")
                    || l.starts_with("[ExtractAudio]")
                {
                    merging = true;
                    set_status(
                        app,
                        job_id,
                        JobView {
                            status: "merging".into(),
                            percent: 100.0,
                            title: spec.title.clone(),
                            ..Default::default()
                        },
                    )
                    .await;
                } else if l.starts_with("ERROR") {
                    let tail = tail_text().await;
                    blog(format!("yt-dlp error job={job_id} line={l} tail={tail}"));
                    kill_tree(job_id).await;
                    let _ = child.wait().await;
                    return Err(anyhow!("{l} :: {tail}"));
                } else if is_skip_line(&l) {
                    set_status(
                        app,
                        job_id,
                        JobView {
                            status: "downloading".into(),
                            percent: 100.0,
                            title: spec.title.clone(),
                            note: Some("already on disk".to_string()),
                            ..Default::default()
                        },
                    )
                    .await;
                } else if !l.starts_with('[') && !l.trim().is_empty() {
                    // `--print after_move:filepath` emits the final path bare.
                    // Only absolute paths qualify: warnings must never win.
                    let t = l.trim();
                    let absolute = t.starts_with('/') || (t.len() > 2 && t.as_bytes()[1] == b':');
                    if absolute {
                        final_path = Some(t.to_string());
                    }
                }
            }
            Ok(Err(e)) => return Err(anyhow!("output read: {e}")),
        }
    }
    let status = child.wait().await?;
    if !status.success() {
        let tail = tail_text().await;
        blog(format!(
            "yt-dlp exit job={job_id} status={status} tail={tail}"
        ));
        return Err(anyhow!("yt-dlp exited with {status} :: {tail}"));
    }
    if let Some(ref p) = final_path {
        blog(format!("download done job={job_id} path={p}"));
    }
    Ok(final_path)
}

/// True for yt-dlp's idempotent skip line: `[download] <file> has already
/// been downloaded`. Zero network happened: surface as "already on disk".
fn is_skip_line(line: &str) -> bool {
    line.contains("has already been downloaded")
}

/// Fallback percent: first `N.N%` anywhere in the line. Used when the strict
/// parser misses a yt-dlp variant; speed/ETA stay unknown (client computes).
fn fallback_percent(line: &str) -> Option<f64> {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let mut j = i;
            while j < bytes.len() && (bytes[j].is_ascii_digit() || bytes[j] == b'.') {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'%' {
                if let Ok(p) = line[i..j].parse::<f64>() {
                    return Some(p);
                }
            }
            i = j;
        } else {
            i += 1;
        }
    }
    None
}

/// Parse `[download]  12.3% of ~  4.56MiB at  1.23MiB/s ETA 00:03`.
fn parse_progress(line: &str) -> Option<(f64, Option<String>, Option<String>)> {
    let rest = line.strip_prefix("[download]")?.trim();
    let mut parts = rest.split_whitespace();
    let pct = parts.next()?.strip_suffix('%')?.parse::<f64>().ok()?;
    let mut speed = None;
    let mut eta = None;
    let words: Vec<&str> = rest.split_whitespace().collect();
    for w in words.windows(2) {
        if w[0] == "at" {
            speed = Some(w[1].to_string());
        }
        if w[0] == "ETA" {
            eta = Some(w[1].to_string());
        }
    }
    Some((pct, speed, eta))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_line_parses() {
        let (pct, speed, eta) =
            parse_progress("[download]  12.3% of ~  4.56MiB at  1.23MiB/s ETA 00:03").unwrap();
        assert!((pct - 12.3).abs() < f64::EPSILON);
        assert_eq!(speed.as_deref(), Some("1.23MiB/s"));
        assert_eq!(eta.as_deref(), Some("00:03"));
    }

    #[test]
    fn progress_line_without_speed_parses() {
        let (pct, speed, eta) = parse_progress("[download]   0.0%").unwrap();
        assert_eq!(pct, 0.0);
        assert!(speed.is_none());
        assert!(eta.is_none());
    }

    #[test]
    fn non_progress_lines_rejected() {
        assert!(parse_progress("[Merger] Merging formats").is_none());
        assert!(parse_progress("ERROR: something broke").is_none());
        assert!(parse_progress("").is_none());
    }

    #[test]
    fn fallback_catches_variant_formats() {
        assert_eq!(fallback_percent("[download]  45.0% of 10MiB"), Some(45.0));
        assert_eq!(fallback_percent("[download] 100%"), Some(100.0));
        assert_eq!(fallback_percent("[Merger] Merging"), None);
        assert_eq!(fallback_percent("no numbers here"), None);
    }

    #[test]
    fn language_match_uses_prefix_with_fallback() {
        let (fmt, multi) =
            build_format(&serde_json::json!("720"), "mp4", &None, &["es".to_string()]);
        assert!(fmt.contains("bestaudio[language^=es]/bestaudio"), "{fmt}");
        assert!(!multi);
    }

    #[test]
    fn multi_audio_chains_with_flag() {
        let (fmt, multi) = build_format(
            &serde_json::json!("best"),
            "mkv",
            &None,
            &["en".to_string(), "de".to_string()],
        );
        assert!(
            fmt.contains("(bestaudio[language^=en]/bestaudio)+(bestaudio[language^=de]/bestaudio)"),
            "{fmt}"
        );
        assert!(multi);
    }

    #[test]
    fn codec_filter_maps_names() {
        let (fmt, _) = build_format(
            &serde_json::json!("1080"),
            "mp4",
            &Some("avc".to_string()),
            &[],
        );
        assert!(
            fmt.contains("bestvideo[height<=1080][vcodec^=avc]"),
            "{fmt}"
        );
        let (fmt, _) = build_format(
            &serde_json::json!("best"),
            "mp4",
            &Some("hevc".to_string()),
            &[],
        );
        assert!(fmt.contains("[vcodec~=^(hev|hvc)]"), "{fmt}");
        let (fmt, _) = build_format(&serde_json::json!("best"), "mp4", &None, &[]);
        assert!(fmt.contains("bestvideo+bestaudio/best"), "{fmt}");
    }

    #[test]
    fn audio_pins_single_language_with_fallback() {
        let (fmt, multi) = build_format(
            &serde_json::json!("best"),
            "mp3",
            &None,
            &["es".to_string()],
        );
        assert!(fmt.contains("bestaudio[language^=es]/bestaudio"), "{fmt}");
        assert!(!multi);
        let (fmt, _) = build_format(&serde_json::json!("best"), "mp3", &None, &[]);
        assert_eq!(fmt, "bestaudio/best");
    }

    #[test]
    fn sub_args_embed_vs_sidecar() {
        let langs = vec!["en".to_string(), "de".to_string()];
        let embed = sub_args(&langs, true);
        assert!(embed.contains(&"--embed-subs".to_string()));
        assert!(embed.contains(&"en,de".to_string()));
        let sidecar = sub_args(&langs, false);
        assert!(!sidecar.contains(&"--embed-subs".to_string()));
        assert!(sidecar.contains(&"--write-subs".to_string()));
        assert!(!sidecar.contains(&"--skip-download".to_string()));
    }

    #[test]
    fn skip_line_detected() {
        assert!(is_skip_line(
            "[download] Title [abc123].mp4 has already been downloaded"
        ));
        assert!(!is_skip_line("[download]  12.3% of ~ 4.56MiB"));
        assert!(!is_skip_line("ERROR: video unavailable"));
    }

    #[test]
    fn sanitize_strips_illegal_chars() {
        assert_eq!(sanitize_name("a/b\\c:d*e?\"f<g>h|i"), "a_b_c_d_e__f_g_h_i");
        assert_eq!(sanitize_name("  name.. "), "name");
    }

    #[test]
    fn codec_label_maps_names() {
        assert_eq!(codec_label(&Some("avc".to_string())), Some("AVC"));
        assert_eq!(codec_label(&Some("hevc".to_string())), Some("HEVC"));
        assert_eq!(codec_label(&None), None);
        assert_eq!(codec_label(&Some("auto".to_string())), None);
    }

    #[test]
    fn original_detected_via_format_note_marker() {
        let info = serde_json::json!({
            "id": "abc", "title": "t",
            "requested_formats": [],
            "formats": [
                { "language": "en", "format_note": "dubbed" },
                { "language": "de", "format_note": "Original soundtrack" },
            ],
        });
        let payload = build_resolve_payload(&info, None);
        let tracks = payload.get("audioTracks").unwrap().as_array().unwrap();
        assert_eq!(tracks.len(), 2);
        assert_eq!(
            tracks[1].get("is_original").unwrap(),
            &serde_json::json!(true)
        );
        assert_eq!(
            tracks[0].get("is_original").unwrap(),
            &serde_json::json!(false)
        );
    }

    #[test]
    fn original_falls_back_to_first_track() {
        let info = serde_json::json!({
            "id": "abc", "title": "t",
            "requested_formats": [],
            "formats": [
                { "language": "en" },
                { "language": "de" },
            ],
        });
        let payload = build_resolve_payload(&info, None);
        let tracks = payload.get("audioTracks").unwrap().as_array().unwrap();
        assert_eq!(
            tracks[0].get("is_original").unwrap(),
            &serde_json::json!(true)
        );
        assert_eq!(
            tracks[1].get("is_original").unwrap(),
            &serde_json::json!(false)
        );
    }
}

async fn kill_tree(job_id: &str) {
    let pid = jobs().lock().await.get(job_id).and_then(|h| h.child_pid);
    let Some(pid) = pid else { return };
    #[cfg(unix)]
    {
        use nix::sys::signal::{killpg, Signal};
        use nix::unistd::Pid;
        let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGKILL);
    }
    #[cfg(windows)]
    {
        let map = jobs();
        let guard = map.lock().await;
        if let Some(h) = guard.get(job_id) {
            if let Some(addr) = h.job_object {
                unsafe {
                    let handle = windows::Win32::Foundation::HANDLE(addr as *mut _);
                    let _ = windows::Win32::System::JobObjects::TerminateJobObject(handle, 1);
                }
            }
        }
    }
}

#[cfg(windows)]
fn assign_job_object(pid: Option<u32>) -> Option<usize> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_ALL_ACCESS};
    unsafe {
        let job: HANDLE = CreateJobObjectW(None, None).ok()?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of_val(&info) as u32,
        )
        .ok()?;
        let pid = pid?;
        let proc = OpenProcess(PROCESS_ALL_ACCESS, false, pid).ok()?;
        AssignProcessToJobObject(job, proc).ok()?;
        let _ = CloseHandle(proc);
        Some(job.0 as usize)
    }
}

fn known_dirs() -> Arc<Mutex<std::collections::HashSet<PathBuf>>> {
    use std::sync::OnceLock;
    static CELL: OnceLock<Arc<Mutex<std::collections::HashSet<PathBuf>>>> = OnceLock::new();
    CELL.get_or_init(|| Arc::new(Mutex::new(std::collections::HashSet::new())))
        .clone()
}

async fn remember_dir(dir: &str) {
    known_dirs().lock().await.insert(PathBuf::from(dir));
}

/// Move a downloaded file to the OS trash. Refuses paths outside known
/// download dirs (no broad fs scope needed).
pub async fn trash_file(path: &str) -> Result<()> {
    let p = PathBuf::from(path);
    let inside = known_dirs().lock().await.iter().any(|d| p.starts_with(d));
    if !inside {
        return Err(anyhow!("refusing to trash outside download folders"));
    }
    if !p.exists() {
        return Ok(()); // idempotent: already gone counts as removed
    }
    trash::delete(&p).map_err(|e| anyhow!("trash failed: {e}"))?;
    blog(format!("trashed path={}", p.display()));
    Ok(())
}

pub async fn cancel(app: &AppHandle, job_id: &str) -> Result<()> {
    blog(format!("cancel job={job_id}"));
    {
        let map = jobs();
        let mut guard = map.lock().await;
        if let Some(h) = guard.get_mut(job_id) {
            h.cancelled = true;
        }
    }
    kill_tree(job_id).await;
    finish(
        app,
        job_id,
        JobView {
            status: "cancelled".into(),
            ..Default::default()
        },
    )
    .await;
    Ok(())
}
