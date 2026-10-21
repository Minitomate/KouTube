//! KouTube core: yt-dlp/ffmpeg sidecar orchestration.
//!
//! Design notes (from production war stories, applied here, not rediscovered):
//! - yt-dlp forks ffmpeg for merges: cancel/watchdog kills the whole process
//!   TREE (Unix process groups, Windows Job Objects), never just the child.
//! - ffmpeg progress arrives on STDERR, yt-dlp progress on STDOUT.
//! - `queue://updated` canonical snapshots are the only status source of truth;
//!   per-chunk `dl://progress` events only move bars.

#[cfg(target_os = "android")]
mod android_engine;
mod jobs;
mod media;
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
    audio_codec: Option<String>,
    audio_quality: Option<String>,
    captions_format: String,
    captions_only: bool,
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
            audio_codec,
            audio_quality,
            captions_format,
            captions_only,
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

/// Save user-picked text (debug log): the path always comes from the save
/// dialog, so the destination is user-consented by construction. Android's
/// save dialog returns a `content://` URI, which needs ContentResolver.
#[tauri::command]
async fn save_text_file(path: String, contents: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        return crate::android_engine::write_uri(&path, &contents).map_err(|e| e.to_string());
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AndroidStorageInfo {
    granted: bool,
    public_dir: String,
    app_dir: String,
}

/// Permission state + the two roots the storage picker offers.
#[tauri::command]
async fn android_storage_info() -> Result<AndroidStorageInfo, String> {
    #[cfg(target_os = "android")]
    {
        let status = crate::android_engine::storage_status().map_err(|e| e.to_string())?;
        Ok(AndroidStorageInfo {
            granted: status == 0,
            public_dir: crate::android_engine::public_download_dir()
                .map_err(|e| e.to_string())?,
            app_dir: crate::android_engine::app_download_dir().map_err(|e| e.to_string())?,
        })
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("Android only".into())
    }
}

/// Open the system All-files-access screen (or the legacy runtime prompt).
#[tauri::command]
async fn android_request_storage() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        crate::android_engine::request_storage().map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("Android only".into())
    }
}

#[derive(serde::Serialize)]
struct DirListing {
    path: String,
    dirs: Vec<String>,
}

/// List subdirectories for the in-app folder browser. Shared storage only.
#[tauri::command]
async fn android_list_dirs(path: String) -> Result<DirListing, String> {
    let canon = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !canon.starts_with("/storage") {
        return Err("outside shared storage".into());
    }
    let mut dirs = Vec::new();
    let entries = std::fs::read_dir(&canon).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            dirs.push(p.to_string_lossy().into_owned());
        }
    }
    dirs.sort();
    Ok(DirListing {
        path: canon.to_string_lossy().into_owned(),
        dirs,
    })
}

/// Create + write-probe a folder before saving it as the download root.
#[tauri::command]
async fn check_out_dir(path: String) -> Result<String, String> {
    let dir = std::path::PathBuf::from(&path);
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create folder: {e}"))?;
    let canon = dir.canonicalize().map_err(|e| format!("cannot resolve folder: {e}"))?;
    let probe = canon.join(".koutube-write-test");
    std::fs::write(&probe, b"ok").map_err(|e| format!("cannot write here: {e}"))?;
    let _ = std::fs::remove_file(&probe);
    Ok(canon.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
struct AndroidEngineInfo {
    version: String,
    error: String,
}

/// Installed download-engine version + last startup update error.
#[tauri::command]
async fn android_engine_info() -> Result<AndroidEngineInfo, String> {
    #[cfg(target_os = "android")]
    {
        Ok(AndroidEngineInfo {
            version: crate::android_engine::engine_version().map_err(|e| e.to_string())?,
            error: crate::android_engine::engine_error().map_err(|e| e.to_string())?,
        })
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("Android only".into())
    }
}

/// Manual yt-dlp update; refused while jobs are in flight.
#[tauri::command]
async fn android_update_engine() -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        if jobs::has_active().await {
            return Err("Finish or cancel downloads first.".into());
        }
        tauri::async_runtime::spawn_blocking(crate::android_engine::update_engine)
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("Android only".into())
    }
}

/// Dev-only: open the webview devtools (debug context-menu entry).
/// Always registered; release builds refuse, so there is zero prod surface.
#[tauri::command]
async fn open_devtools(app: AppHandle) -> Result<(), String> {
    #[cfg(all(desktop, debug_assertions))]
    {
        use tauri::Manager;
        app.get_webview_window("main")
            .ok_or_else(|| "main window not found".to_string())?
            .open_devtools();
        return Ok(());
    }
    #[cfg(not(all(desktop, debug_assertions)))]
    {
        let _ = app;
        Err("devtools are only available in desktop debug builds".to_string())
    }
}

/// Android fallback download root: the app-specific external Downloads dir
/// (`getExternalFilesDir(DIRECTORY_DOWNLOADS)`), writable with no permission.
/// The storage picker normally sets a public/custom folder instead.
#[tauri::command]
async fn default_out_dir(app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let dir = app.path().download_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir.to_string_lossy().into_owned())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("desktop uses the folder picker".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build());
    // Updater and process-control have no mobile support.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .invoke_handler(tauri::generate_handler![
            resolve,
            ensure_tools,
            start_download,
            cancel_download,
            trash_file,
            existing_outputs,
            get_recent_logs,
            save_text_file,
            android_storage_info,
            android_request_storage,
            android_list_dirs,
            check_out_dir,
            android_engine_info,
            android_update_engine,
            media::play_file,
            default_out_dir,
            open_devtools
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
