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
const FFMPEG_RELEASES: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz";

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
    for dir in std::env::var_os("PATH")
        .into_iter()
        .flat_map(|p| std::env::split_paths(&p))
    {
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
    let mut stream = res.bytes_stream();
    let mut file = tokio::fs::File::create(dest).await?;
    let mut loaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("body")?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
        loaded += chunk.len() as u64;
        let _ = app.emit(
            "tools://progress",
            serde_json::json!({
                "tool": label, "loaded": loaded, "total": total, "status": "working",
            }),
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = tokio::fs::metadata(dest).await?.permissions();
        perms.set_mode(0o755);
        tokio::fs::set_permissions(dest, perms).await?;
    }
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
        download_to(app, YTDLP_RELEASES, &dir.join(exe("yt-dlp")), "yt-dlp").await?;
        bootstrapped = true;
    }
    let need_ff = resolve_tool(app, "ffmpeg").is_none() || resolve_tool(app, "ffprobe").is_none();
    if need_ff {
        let tarball = dir.join("ffmpeg.tar.xz");
        download_to(app, FFMPEG_RELEASES, &tarball, "ffmpeg").await?;
        extract_ffmpeg(&tarball, &dir)?;
        let _ = std::fs::remove_file(&tarball);
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

fn extract_ffmpeg(tarball: &Path, dir: &Path) -> Result<()> {
    // BtbN tarball: ffmpeg-master-latest-linux64-gpl/bin/{ffmpeg,ffprobe}.
    // Shell out to system tar (always present next to a browser runtime);
    // keeps heavy decompression deps out of the binary.
    let out = std::process::Command::new("tar")
        .args(["-xJf"])
        .arg(tarball)
        .args(["-C", &dir.to_string_lossy()])
        .output()
        .context("untar")?;
    if !out.status.success() {
        return Err(anyhow!("untar failed"));
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            for bin in ["ffmpeg", "ffprobe"] {
                let src = entry.path().join("bin").join(exe(bin));
                if src.is_file() {
                    std::fs::rename(&src, dir.join(exe(bin)))?;
                }
            }
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
    Ok(())
}
