//! Play downloaded media with the OS default handler.
//!
//! The JS `open_path` command is scope-gated by static capability patterns,
//! which cannot cover a user-chosen download folder (USB sticks, D:\, /tmp).
//! This command validates in Rust instead: the path must exist, carry a
//! media/caption extension this app produces, and live under the configured
//! download root — then opens it with no scope involved.

use tauri::AppHandle;

/// Extensions this app ever writes next to a download.
const PLAYABLE_EXTS: [&str; 10] = [
    "mp4", "webm", "mkv", "m4a", "mp3", "opus", "wav", "flac", "srt", "vtt",
];

/// Pure check: exists + known extension + inside the download root.
/// Both sides canonicalized so symlinks cannot escape the root.
fn validate_play_path(
    root: &std::path::Path,
    path: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    if !path.is_file() {
        return Err(format!("file not found: {}", path.display()));
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !PLAYABLE_EXTS.contains(&ext.as_str()) {
        return Err(format!("not a playable file: {}", path.display()));
    }
    let root = root
        .canonicalize()
        .map_err(|e| format!("cannot resolve download folder: {e}"))?;
    let canon = path
        .canonicalize()
        .map_err(|e| format!("cannot resolve {}: {e}", path.display()))?;
    if !canon.starts_with(&root) {
        return Err("file is outside the download folder".to_string());
    }
    Ok(canon)
}

/// Download root from the settings store (same file the frontend saves).
fn download_root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store("settings.json")
        .map_err(|e| format!("cannot read settings: {e}"))?;
    let out_dir = store
        .get("settings")
        .and_then(|v| v.get("outDir")?.as_str().map(str::to_string))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "no download folder set — pick one in Settings".to_string())?;
    let root = std::path::PathBuf::from(&out_dir);
    if !root.is_dir() {
        return Err("download folder is missing — pick one in Settings".to_string());
    }
    Ok(root)
}

#[tauri::command]
pub async fn play_file(app: AppHandle, path: String) -> Result<(), String> {
    let root = download_root(&app)?;
    let target = validate_play_path(&root, std::path::Path::new(&path))?;
    // The desktop opener plugin only handles URLs on Android: route the file
    // through our FileProvider instead (system chooser/player).
    #[cfg(target_os = "android")]
    {
        return crate::android_engine::open_file(&target.to_string_lossy())
            .map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "android"))]
    tauri_plugin_opener::open_path(&target, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_root(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("koutube-play-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_media_inside_root() {
        let root = tmp_root("ok");
        let f = root.join("Movie [best].mp4");
        fs::write(&f, b"x").unwrap();
        let got = validate_play_path(&root, &f).unwrap();
        assert_eq!(got, f.canonicalize().unwrap());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_missing_unknown_and_outside() {
        let root = tmp_root("no");
        assert!(validate_play_path(&root, &root.join("gone.mp4")).is_err());
        let txt = root.join("notes.txt");
        fs::write(&txt, b"x").unwrap();
        assert!(validate_play_path(&root, &txt).is_err());
        let outside = std::env::temp_dir().join(format!(
            "koutube-play-test-{}-outside.mp4",
            std::process::id()
        ));
        fs::write(&outside, b"x").unwrap();
        assert!(validate_play_path(&root, &outside).is_err());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_file(&outside);
    }
}
