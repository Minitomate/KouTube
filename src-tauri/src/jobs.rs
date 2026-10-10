//! Download jobs: yt-dlp sidecar orchestration with tree-kill guarantees.
//!
//! Kill policy (do not weaken): cancelling or watchdog-firing kills the whole
//! process TREE — yt-dlp forks ffmpeg for merges, and killing only yt-dlp
//! orphans ffmpeg holding file locks. Unix: setsid at spawn + killpg.
//! Windows: Job Object with KILL_ON_JOB_CLOSE assigned right after spawn.

use anyhow::{anyhow, Result};
use std::collections::HashMap;
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
    pub container: String,
    pub quality: serde_json::Value,
    pub audio_track: Option<String>,
    pub captions: Vec<String>,
    pub out_dir: String,
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
}

struct JobHandle {
    view: JobView,
    // Unix: child started in its own session → killpg(child_pid).
    child_pid: Option<u32>,
    #[cfg(windows)]
    job_object: Option<windows::Win32::Foundation::HANDLE>,
    cancelled: bool,
}

type Jobs = Arc<Mutex<HashMap<String, JobHandle>>>;

fn jobs() -> Jobs {
    use std::sync::OnceLock;
    static CELL: OnceLock<Jobs> = OnceLock::new();
    CELL.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

fn emit_progress(app: &AppHandle, job_id: &str, view: &JobView) {
    let _ = app.emit(
        "dl://progress",
        serde_json::json!({
            "job_id": job_id, "status": view.status, "percent": view.percent,
            "speed": view.speed, "eta": view.eta, "title": view.title,
            "filepath": view.filepath, "error": view.error,
        }),
    );
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

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

fn is_playlist_url(url: &str) -> bool {
    url.contains("list=")
}

pub async fn resolve(app: &AppHandle, url: &str) -> Result<serde_json::Value> {
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
    let out = cmd.output().await?;
    if !out.status.success() {
        return Err(anyhow!("resolve failed"));
    }
    let info: serde_json::Value = serde_json::from_slice(&out.stdout)?;
    Ok(build_resolve_payload(&info))
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

/// Same shape as the old /api/resolve so the frontend normalizer is reused.
fn build_resolve_payload(info: &serde_json::Value) -> serde_json::Value {
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
    // Audio tracks grouped by language; first = original default.
    let mut seen_lang = std::collections::HashSet::new();
    let mut tracks = vec![];
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
        if seen_lang.insert(lang.clone()) {
            tracks.push(
                serde_json::json!({ "lang": lang, "label": lang, "is_default": tracks.is_empty() }),
            );
        }
    }
    serde_json::json!({
        "videoId": info.get("id"), "title": info.get("title").and_then(|v| v.as_str()).unwrap_or(""),
        "thumbnail": info.get("thumbnail"), "duration": info.get("duration"),
        "formats": out_formats, "audioTracks": tracks, "manualCaptions": caps,
        "is_playlist": false, "entries": [],
    })
}

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

const AUDIO_ONLY: [&str; 5] = ["mp3", "m4a", "opus", "wav", "flac"];

fn quality_format(
    quality: &serde_json::Value,
    container: &str,
    audio_lang: &Option<String>,
) -> String {
    if AUDIO_ONLY.contains(&container) {
        return "bestaudio/best".to_string();
    }
    let audio = match audio_lang {
        Some(l) => format!("bestaudio[language={l}]/bestaudio"),
        None => "bestaudio".to_string(),
    };
    match quality.as_str() {
        Some("best") => return format!("bestvideo+{audio}/best"),
        _ => {}
    }
    let q = quality
        .as_u64()
        .or_else(|| quality.as_str().and_then(|s| s.parse().ok()));
    match q {
        Some(q) => format!("bestvideo[height<={q}]+{audio}/best[height<={q}]/best"),
        None => format!("bestvideo+{audio}/best"),
    }
}

fn build_args(app: &AppHandle, spec: &DownloadSpec) -> Result<Vec<String>> {
    let (ffmpeg, _) = tools::resolve_tool(app, "ffmpeg")
        .ok_or_else(|| anyhow!("ffmpeg missing: run setup first"))?;
    let ffdir = ffmpeg
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
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
        quality_format(&spec.quality, &spec.container, &spec.audio_track),
        "-o".to_string(),
        format!("{}/%(title)s [%(id)s].%(ext)s", spec.out_dir),
        "--print".to_string(),
        "after_move:filepath".to_string(),
    ];
    if AUDIO_ONLY.contains(&spec.container.as_str()) {
        args.extend([
            "-x".to_string(),
            "--audio-format".to_string(),
            spec.container.clone(),
        ]);
    } else {
        args.extend(["--merge-output-format".to_string(), spec.container.clone()]);
    }
    if !spec.captions.is_empty() {
        args.extend([
            "--write-subs".to_string(),
            "--sub-langs".to_string(),
            spec.captions.join(","),
            "--sub-format".to_string(),
            "srt/best".to_string(),
            "--embed-subs".to_string(),
        ]);
    }
    args.push(spec.url.clone());
    Ok(args)
}

pub async fn start_download(app: &AppHandle, spec: DownloadSpec) -> Result<String> {
    validate_url(&spec.url)?;
    std::fs::create_dir_all(&spec.out_dir).map_err(|e| anyhow!("bad folder: {e}"))?;
    let job_id = format!("{:x}", randish());
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
        run_with_retries(&app2, &jid, &spec).await;
    });
    Ok(job_id)
}

fn randish() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    t ^ (std::process::id() as u128)
}

async fn run_with_retries(app: &AppHandle, job_id: &str, spec: &DownloadSpec) {
    for attempt in 0..=MAX_RETRIES {
        if is_cancelled(job_id).await {
            return;
        }
        match run_once(app, job_id, spec, attempt).await {
            Ok(done_path) => {
                set_status(
                    app,
                    job_id,
                    JobView {
                        status: "done".into(),
                        percent: 100.0,
                        filepath: done_path,
                        ..Default::default()
                    },
                )
                .await;
                return;
            }
            Err(e) => {
                if is_cancelled(job_id).await {
                    return;
                }
                if attempt == MAX_RETRIES {
                    set_status(
                        app,
                        job_id,
                        JobView {
                            status: "error".into(),
                            error: Some(friendly_error(&e)),
                            ..Default::default()
                        },
                    )
                    .await;
                    return;
                }
                let wait = 2u64.pow(attempt) as u64;
                set_status(
                    app,
                    job_id,
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
    // ffmpeg progress arrives on STDERR; drain it so the pipe never blocks.
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while lines.next_line().await.unwrap_or(None).is_some() {}
    });

    let mut reader = BufReader::new(stdout).lines();
    let mut last_out = Instant::now();
    let mut final_path: Option<String> = None;
    let mut merging = false;
    loop {
        let line = tokio::time::timeout(Duration::from_secs(1), reader.next_line()).await;
        match line {
            Err(_) => {
                // 1s tick: watchdog check without blocking output.
                if last_out.elapsed() > IDLE_TIMEOUT && !merging {
                    kill_tree(job_id).await;
                    let _ = child.wait().await;
                    return Err(anyhow!("stalled: no progress for 30s"));
                }
                if is_cancelled(job_id).await {
                    kill_tree(job_id).await;
                    let _ = child.wait().await;
                    set_status(
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
                if let Some(ev) = parse_progress(&l) {
                    set_status(
                        app,
                        job_id,
                        JobView {
                            status: "downloading".into(),
                            percent: ev.0,
                            speed: ev.1,
                            eta: ev.2,
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
                            ..Default::default()
                        },
                    )
                    .await;
                } else if l.starts_with("ERROR") {
                    kill_tree(job_id).await;
                    let _ = child.wait().await;
                    return Err(anyhow!("{l}"));
                } else if !l.starts_with('[') && !l.trim().is_empty() {
                    // `--print after_move:filepath` emits the final path bare.
                    final_path = Some(l.trim().to_string());
                }
            }
            Ok(Err(e)) => return Err(anyhow!("output read: {e}")),
        }
    }
    let status = child.wait().await?;
    if !status.success() {
        return Err(anyhow!("yt-dlp exited with {status}"));
    }
    Ok(final_path)
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
            if let Some(job) = h.job_object {
                unsafe {
                    use windows::Win32::System::JobObjects::TerminateJobObject;
                    let _ = TerminateJobObject(job, 1);
                }
            }
        }
    }
}

#[cfg(windows)]
fn assign_job_object(pid: Option<u32>) -> Option<windows::Win32::Foundation::HANDLE> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::JobObjects::*;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_ALL_ACCESS};
    unsafe {
        let job = CreateJobObjectW(None, None).ok()?;
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
        Some(job)
    }
}

pub async fn cancel(app: &AppHandle, job_id: &str) -> Result<()> {
    {
        let map = jobs();
        let mut guard = map.lock().await;
        if let Some(h) = guard.get_mut(job_id) {
            h.cancelled = true;
        }
    }
    kill_tree(job_id).await;
    set_status(
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
