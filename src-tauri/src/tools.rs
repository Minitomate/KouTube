//! Tool bootstrap: yt-dlp + ffmpeg + ffprobe without user installs.
//!
//! Resolution order per binary: packaged sidecar (triple-suffixed) →
//! app-data `bins/` (this bootstrapper) → system PATH (dev convenience).
//! A partial install (ffmpeg without ffprobe) counts as missing everything.

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

const YTDLP_RELEASES: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
const YTDLP_RELEASES_WIN: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const FFMPEG_RELEASES: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz";
const FFMPEG_RELEASES_WIN: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

/// Per-OS tool assets: (label, url, archive_kind). `archive_kind` is None for
/// raw binaries, Some("zip") / Some("tar.xz") for ffmpeg bundles.
fn tool_assets() -> Vec<(&'static str, String, Option<&'static str>)> {
    if cfg!(windows) {
        vec![
            ("yt-dlp", YTDLP_RELEASES_WIN.to_string(), None),
            ("ffmpeg", FFMPEG_RELEASES_WIN.to_string(), Some("zip")),
        ]
    } else {
        vec![
            ("yt-dlp", YTDLP_RELEASES.to_string(), None),
            ("ffmpeg", FFMPEG_RELEASES.to_string(), Some("tar.xz")),
        ]
    }
}

fn bins_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("no app data dir")?
        .join("bins");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn triple() -> &'static str {
    // Keep in sync with Tauri's -, matching src-tauri/binaries/*-<triple>.
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "x86_64-unknown-linux-gnu";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "aarch64-unknown-linux-gnu";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "x86_64-apple-darwin";
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "aarch64-apple-darwin";
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "x86_64-pc-windows-msvc";
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    return "aarch64-pc-windows-msvc";
    #[allow(unreachable_code)]
    return "unknown";
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn path_in_path(name: &str) -> Option<PathBuf> {
    let probe = exe(name);
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let cand = dir.join(&probe);
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}

/// Resolve one tool binary. Returns (path, managed_by_us).
pub fn resolve_tool(app: &AppHandle, name: &str) -> Option<(PathBuf, bool)> {
    // 1. Packaged sidecar next to the app binary.
    if let Ok(exe_dir) = std::env::current_exe().and_then(|p| {
        p.parent()
            .map(|d| d.to_path_buf())
            .ok_or_else(|| std::io::Error::other("no parent"))
    }) {
        for cand in [
            exe_dir.join(format!("{}-{}", name, triple())),
            exe_dir.join(exe(&format!("{}-{}", name, triple()))),
        ] {
            if cand.is_file() {
                return Some((cand, false));
            }
        }
    }
    // 2. Bootstrapped app-data bins.
    if let Ok(dir) = bins_dir(app) {
        let cand = dir.join(exe(name));
        if cand.is_file() {
            return Some((cand, true));
        }
    }
    // 3. System PATH (dev machines).
    path_in_path(name).map(|p| (p, false))
}

pub fn have_all_tools(app: &AppHandle) -> bool {
    let ffmpeg = resolve_tool(app, "ffmpeg").is_some();
    let ffprobe = resolve_tool(app, "ffprobe").is_some();
    let ytdlp = resolve_tool(app, "yt-dlp").is_some();
    // Partial ffmpeg installs break post-processing silently: all or nothing.
    ytdlp && ffmpeg && ffprobe
}

async fn download_to(app: &AppHandle, url: &str, dest: &Path, label: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let res = client.get(url).send().await.context("fetch")?;
    if !res.status().is_success() {
        return Err(anyhow!("{} download: HTTP {}", label, res.status()));
    }
    let total = res.content_length();
    // Atomic: stream to temp, rename only on complete non-empty success, so a
    // crashed first run can never leave a "healthy-looking" half binary.
    let tmp = dest.with_extension("part");
    let mut stream = res.bytes_stream();
    let mut file = tokio::fs::File::create(&tmp).await?;
    let mut loaded: u64 = 0;
    loop {
        let next = tokio::time::timeout(std::time::Duration::from_secs(60), stream.next()).await;
        let chunk = match next {
            Err(_) => {
                drop(file);
                let _ = tokio::fs::remove_file(&tmp).await;
                return Err(anyhow!("{label} download stalled (60s without bytes)"));
            }
            Ok(None) => break,
            Ok(Some(chunk)) => chunk.context("body")?,
        };
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
        loaded += chunk.len() as u64;
        let _ = app.emit(
            "tools://progress",
            serde_json::json!({
                "tool": label, "loaded": loaded, "total": total, "status": "working",
            }),
        );
    }
    drop(file);
    if loaded == 0 {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(anyhow!("{label} download is empty"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = tokio::fs::metadata(&tmp).await?.permissions();
        perms.set_mode(0o755);
        tokio::fs::set_permissions(&tmp, perms).await?;
    }
    tokio::fs::rename(&tmp, dest).await?;
    let _ = app.emit(
        "tools://progress",
        serde_json::json!({
            "tool": label, "loaded": loaded, "total": total, "status": "done",
        }),
    );
    Ok(())
}

/// Ensure yt-dlp + ffmpeg + ffprobe exist, downloading missing ones.
/// Returns `{ tools: { yt-dlp, ffmpeg, ffprobe }, bootstrapped: bool }`.
pub async fn ensure_tools(app: &AppHandle) -> Result<serde_json::Value> {
    if have_all_tools(app) {
        return Ok(status(app));
    }
    let dir = bins_dir(app)?;
    let mut bootstrapped = false;
    if resolve_tool(app, "yt-dlp").is_none() {
        let (_, url, _) = tool_assets()
            .into_iter()
            .find(|(l, _, _)| *l == "yt-dlp")
            .unwrap();
        download_to(app, &url, &dir.join(exe("yt-dlp")), "yt-dlp").await?;
        bootstrapped = true;
    }
    let need_ff = resolve_tool(app, "ffmpeg").is_none() || resolve_tool(app, "ffprobe").is_none();
    if need_ff {
        let (_, url, kind) = tool_assets()
            .into_iter()
            .find(|(l, _, _)| *l == "ffmpeg")
            .unwrap();
        let archive = dir.join(format!("ffmpeg-bundle.{}", kind.unwrap_or("bin")));
        download_to(app, &url, &archive, "ffmpeg").await?;
        extract_ffmpeg(&archive, &dir)?;
        let _ = std::fs::remove_file(&archive);
        bootstrapped = true;
    }
    if !have_all_tools(app) {
        return Err(anyhow!("tools still missing after bootstrap"));
    }
    let mut out = status(app);
    out["bootstrapped"] = serde_json::json!(bootstrapped);
    Ok(out)
}

fn status(app: &AppHandle) -> serde_json::Value {
    serde_json::json!({
        "tools": {
            "yt-dlp": resolve_tool(app, "yt-dlp").map(|(p, _)| p.to_string_lossy().to_string()),
            "ffmpeg": resolve_tool(app, "ffmpeg").map(|(p, _)| p.to_string_lossy().to_string()),
            "ffprobe": resolve_tool(app, "ffprobe").map(|(p, _)| p.to_string_lossy().to_string()),
        },
        "bootstrapped": false,
    })
}

/// Extract an ffmpeg bundle (BtbN layouts: `<root>/bin/{ffmpeg,ffprobe}`).
/// Pure-Rust decoders: no system tar/unzip required on any OS.
fn extract_ffmpeg(archive: &Path, dir: &Path) -> Result<()> {
    let name = archive.to_string_lossy();
    if name.ends_with(".zip") {
        let file = std::fs::File::open(archive)?;
        let mut zip = zip::ZipArchive::new(file)?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i)?;
            let Some(fname) = entry
                .enclosed_name()
                .and_then(|p| p.file_name().map(|s| s.to_string_lossy().to_string()))
            else {
                continue;
            };
            if fname == "ffmpeg"
                || fname == "ffmpeg.exe"
                || fname == "ffprobe"
                || fname == "ffprobe.exe"
            {
                let mut out = std::fs::File::create(dir.join(exe(fname.trim_end_matches(".exe"))))?;
                std::io::copy(&mut entry, &mut out)?;
            }
        }
    } else if name.ends_with(".tar.xz") {
        let file = std::fs::File::open(archive)?;
        let xz = xz2::read::XzDecoder::new(file);
        let mut tar = tar::Archive::new(xz);
        for entry in tar.entries()? {
            let mut entry = entry?;
            let path = entry.path()?.to_path_buf();
            let Some(fname) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if fname == "ffmpeg" || fname == "ffprobe" {
                entry.unpack(dir.join(fname))?;
            }
        }
    } else {
        return Err(anyhow!("unknown bundle format: {name}"));
    }
    #[cfg(unix)]
    for bin in ["ffmpeg", "ffprobe"] {
        let p = dir.join(bin);
        if p.is_file() {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&p)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&p, perms)?;
        }
    }
    Ok(())
}
