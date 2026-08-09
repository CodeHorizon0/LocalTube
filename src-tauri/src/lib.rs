use std::path::{Path, PathBuf};
use std::process::Stdio;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_store::StoreExt;
use tokio::task::spawn_blocking;
use walkdir::WalkDir;
use sha2::{Sha256, Digest};
use tokio::fs;

#[derive(Serialize, Deserialize)]
pub struct VideoFile {
    pub path: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct StartupStatus {
    pub library_path: Option<String>,
    pub ffmpeg_available: bool,
    pub error: Option<String>,
}

fn check_ffmpeg() -> bool {
    std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

async fn get_cache_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails");
    fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| e.to_string())?;
    Ok(cache_dir)
}

async fn get_video_hash(video_path: &str) -> Result<String, String> {
    let meta = fs::metadata(video_path)
        .await
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    let modified = meta
        .modified()
        .map_err(|e| format!("Failed to get modified time: {}", e))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Invalid time: {}", e))?
        .as_secs();
    let size = meta.len();
    let input = format!("{}{}{}", video_path, modified, size);
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    Ok(hex::encode(hasher.finalize()))
}

async fn extract_cover_art(video_path: &str) -> Result<Option<Vec<u8>>, String> {
    let output = tokio::process::Command::new("ffprobe")
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v")
        .arg("-show_entries")
        .arg("stream=codec_name,disposition,width,height")
        .arg("-of")
        .arg("json")
        .arg(video_path)
        .output()
        .await
        .map_err(|e| format!("ffprobe failed: {}", e))?;

    if !output.status.success() {
        return Ok(None);
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|_| "Invalid JSON from ffprobe".to_string())?;

    let streams = value["streams"].as_array().ok_or("No streams array")?;
    let mut cover_stream_index = None;

    for (idx, stream) in streams.iter().enumerate() {
        let is_attached = stream["disposition"]["attached_pic"].as_u64().unwrap_or(0) == 1;
        let codec = stream["codec_name"].as_str().unwrap_or("");

        if is_attached || codec == "mjpeg" || codec == "png" {
            cover_stream_index = Some(idx);
            break;
        }
    }

    if let Some(index) = cover_stream_index {
        let output = tokio::process::Command::new("ffmpeg")
            .arg("-i")
            .arg(video_path)
            .arg("-map")
            .arg(format!("0:v:{}", index))
            .arg("-vframes")
            .arg("1")
            .arg("-f")
            .arg("image2pipe")
            .arg("-vcodec")
            .arg("mjpeg")
            .arg("-")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await
            .map_err(|e| format!("Failed to extract cover art: {}", e))?;

        if output.status.success() && !output.stdout.is_empty() {
            return Ok(Some(output.stdout));
        }
    }

    Ok(None)
}

async fn generate_thumbnail_data(video_path: &str) -> Result<Vec<u8>, String> {
    if let Some(cover_data) = extract_cover_art(video_path).await? {
        return Ok(cover_data);
    }

    let duration = get_duration(video_path).await?;
    let seek_time = if duration > 3.0 { 3.0 } else if duration > 1.0 { duration * 0.3 } else { 0.0 };

    let output = tokio::process::Command::new("ffmpeg")
        .arg("-ss")
        .arg(seek_time.to_string())
        .arg("-i")
        .arg(video_path)
        .arg("-vframes")
        .arg("1")
        .arg("-vf")
        .arg("scale=320:-1")
        .arg("-f")
        .arg("image2pipe")
        .arg("-vcodec")
        .arg("mjpeg")
        .arg("-")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        return Err("ffmpeg exited with error".into());
    }
    if output.stdout.is_empty() {
        return Err("Empty output from ffmpeg".into());
    }
    Ok(output.stdout)
}

#[tauri::command]
async fn get_startup_status(app_handle: tauri::AppHandle) -> Result<StartupStatus, String> {
    let store = app_handle
        .store("settings.json")
        .map_err(|e| e.to_string())?;
    let library_path: Option<String> = store
        .get("library_path")
        .and_then(|v| serde_json::from_value(v).ok());

    let ffmpeg_available = spawn_blocking(check_ffmpeg)
        .await
        .map_err(|e| e.to_string())?;

    Ok(StartupStatus {
        library_path,
        ffmpeg_available,
        error: if !ffmpeg_available {
            Some("FFmpeg not found in PATH".into())
        } else {
            None
        },
    })
}

#[tauri::command]
async fn set_library_path(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    let store = app_handle
        .store("settings.json")
        .map_err(|e| e.to_string())?;
    store.set("library_path".to_string(), serde_json::Value::String(path));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn scan_videos(
    _app_handle: tauri::AppHandle,
    base_path: String,
    extensions: Vec<String>,
) -> Result<Vec<VideoFile>, String> {
    let extensions_lower: Vec<String> = extensions
        .into_iter()
        .map(|s| s.to_lowercase())
        .collect();

    let result = spawn_blocking(move || {
        let root = Path::new(&base_path);
        if !root.exists() || !root.is_dir() {
            return Err("Path is not a directory".to_string());
        }

        let mut videos = Vec::new();
        for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if extensions_lower.contains(&ext_str) {
                    videos.push(VideoFile {
                        path: path.to_string_lossy().into_owned(),
                        name: path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned(),
                    });
                }
            }
        }
        Ok(videos)
    })
    .await
    .map_err(|e| e.to_string())?;
    result
}

#[tauri::command]
async fn generate_thumbnail(
    app_handle: tauri::AppHandle,
    video_path: String,
) -> Result<String, String> {
    let cache_dir = get_cache_dir(&app_handle).await?;
    let hash = get_video_hash(&video_path).await?;
    let cache_file = cache_dir.join(format!("{}.jpg", hash));

    if let Ok(data) = fs::read(&cache_file).await {
        use base64::prelude::*;
        return Ok(BASE64_STANDARD.encode(data));
    }

    let image_data = generate_thumbnail_data(&video_path).await?;

    let cache_file_clone = cache_file.clone();
    let image_data_clone = image_data.clone();
    tokio::spawn(async move {
        let _ = fs::write(cache_file_clone, image_data_clone).await;
    });

    use base64::prelude::*;
    Ok(BASE64_STANDARD.encode(image_data))
}

async fn get_duration(video_path: &str) -> Result<f64, String> {
    let output = tokio::process::Command::new("ffprobe")
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=1")
        .arg(video_path)
        .output()
        .await
        .map_err(|e| format!("ffprobe failed: {}", e))?;

    if !output.status.success() {
        return Err("ffprobe error".into());
    }
    let dur_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    dur_str
        .parse::<f64>()
        .map_err(|_| "Invalid duration".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_startup_status,
            set_library_path,
            scan_videos,
            generate_thumbnail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}