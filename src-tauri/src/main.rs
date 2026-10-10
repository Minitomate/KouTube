//! KouTube desktop core: yt-dlp/ffmpeg sidecar orchestration.
//!
//! Design notes (from production war stories, applied here, not rediscovered):
//! - yt-dlp forks ffmpeg for merges: cancel/watchdog kills the whole process
//!   TREE (Unix process groups, Windows Job Objects), never just the child.
//! - ffmpeg progress arrives on STDERR, yt-dlp progress on STDOUT.
//! - `queue://updated` canonical snapshots are the only status source of truth;
//!   per-chunk `dl://progress` events only move bars.

mod jobs;
mod tools;

use tauri::{AppHandle, Emitter};

#[tauri::command]
async fn resolve(app: AppHandle, url: String) -> Result<serde_json::Value, String> {
    jobs::resolve(&app, &url).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn ensure_tools(app: AppHandle) -> Result<serde_json::Value, String> {
    tools::ensure_tools(&app).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_download(
    app: AppHandle,
    url: String,
    container: String,
    quality: serde_json::Value,
    audio_track: Option<String>,
    captions: Vec<String>,
    out_dir: String,
    title: Option<String>,
) -> Result<String, String> {
    jobs::start_download(
        &app,
        jobs::DownloadSpec {
            url,
            container,
            quality,
            audio_track,
            captions,
            out_dir,
            title,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cancel_download(app: AppHandle, job_id: String) -> Result<(), String> {
    jobs::cancel(&app, &job_id).await.map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            resolve,
            ensure_tools,
            start_download,
            cancel_download
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Best-effort: warm the tool check so first download is instant.
                let _ = tools::ensure_tools(&handle).await;
                let _ = handle.emit("tools://ready", serde_json::json!({}));
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
