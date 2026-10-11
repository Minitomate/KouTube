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
    video_id: Option<String>,
    container: String,
    quality: serde_json::Value,
    codec: Option<String>,
    audio_tracks: Vec<String>,
    captions: Vec<String>,
    out_dir: String,
    title: Option<String>,
    overwrite: bool,
    split_kinds: bool,
) -> Result<String, String> {
    jobs::start_download(
        &app,
        jobs::DownloadSpec {
            url,
            video_id,
            container,
            quality,
            codec,
            audio_tracks,
            captions,
            out_dir,
            title,
            overwrite,
            split_kinds,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn existing_outputs(out_dir: String, video_id: String) -> Vec<String> {
    jobs::existing_outputs(&out_dir, &video_id).await
}

#[tauri::command]
async fn cancel_download(app: AppHandle, job_id: String) -> Result<(), String> {
    jobs::cancel(&app, &job_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn trash_file(path: String) -> Result<(), String> {
    jobs::trash_file(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_recent_logs() -> Vec<String> {
    jobs::recent_logs().await
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            resolve,
            ensure_tools,
            start_download,
            cancel_download,
            trash_file,
            existing_outputs,
            get_recent_logs
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
