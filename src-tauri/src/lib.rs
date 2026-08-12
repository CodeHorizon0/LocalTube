use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_store::StoreExt;
use tokio::sync::Semaphore;
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

fn thumbnail_semaphore() -> &'static Semaphore {
    static THUMBNAIL_SEMAPHORE: OnceLock<Semaphore> = OnceLock::new();
    THUMBNAIL_SEMAPHORE.get_or_init(|| Semaphore::new(4))
}

fn preview_semaphore() -> &'static Semaphore {
    static PREVIEW_SEMAPHORE: OnceLock<Semaphore> = OnceLock::new();
    PREVIEW_SEMAPHORE.get_or_init(|| Semaphore::new(2))
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

async fn get_video_info(video_path: &str) -> Result<(f64, Option<usize>), String> {
    let output = tokio::process::Command::new("ffprobe")
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v")
        .arg("-show_entries")
        .arg("stream=codec_name,disposition,width,height")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("json")
        .arg(video_path)
        .output()
        .await
        .map_err(|e| format!("ffprobe failed: {}", e))?;

    if !output.status.success() {
        return Err("ffprobe error".into());
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|_| "Invalid JSON from ffprobe".to_string())?;

    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let streams = value["streams"].as_array().ok_or("No streams array")?;
    let mut cover_stream_index = None;

    for (idx, stream) in streams.iter().enumerate() {
        let is_attached = stream["disposition"]["attached_pic"].as_u64().unwrap_or(0) == 1;
        let codec = stream["codec_name"].as_str().unwrap_or("");

        if is_attached || codec == "mjpeg" || codec == "png" || codec == "jpeg" || codec == "webp" || codec == "bmp" {
            cover_stream_index = Some(idx);
            break;
        }
    }

    Ok((duration, cover_stream_index))
}

async fn extract_cover_art(video_path: &str, index: usize) -> Result<Vec<u8>, String> {
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

    if !output.status.success() || output.stdout.is_empty() {
        return Err("Empty cover art".into());
    }
    Ok(output.stdout)
}

async fn extract_frame_at(video_path: &str, seek_time: f64) -> Result<Vec<u8>, String> {
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

    if !output.status.success() || output.stdout.is_empty() {
        return Err("Empty frame".into());
    }
    Ok(output.stdout)
}

async fn gen_thumb_data(video_path: &str) -> Result<Vec<u8>, String> {
    let (duration, cover_index) = get_video_info(video_path).await?;

    if let Some(index) = cover_index {
        if let Ok(data) = extract_cover_art(video_path, index).await {
            return Ok(data);
        }
    }

    if duration <= 0.0 {
        return Err("Video has no duration or no video stream".into());
    }

    let seek_time = if duration > 3.0 {
        3.0
    } else if duration > 1.0 {
        duration * 0.3
    } else {
        0.0
    };

    match extract_frame_at(video_path, seek_time).await {
        Ok(data) => Ok(data),
        Err(_) if seek_time != 0.0 => extract_frame_at(video_path, 0.0).await,
        Err(e) => Err(e),
    }
}

async fn gen_gif_data(video_path: &str) -> Result<Vec<u8>, String> {
    let (duration, _) = get_video_info(video_path).await?;
    if duration <= 0.0 {
        return Err("Video has no duration".into());
    }

    let max_duration = 10.0;
    let effective_duration = if duration < max_duration { duration } else { max_duration };
    let fps = 30.0;

    let output = tokio::process::Command::new("ffmpeg")
        .arg("-ss")
        .arg("0")
        .arg("-i")
        .arg(video_path)
        .arg("-t")
        .arg(effective_duration.to_string())
        .arg("-vf")
        .arg(format!(
            "fps={},scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
            fps
        ))
        .arg("-an")
        .arg("-f")
        .arg("gif")
        .arg("-")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .map_err(|e| format!("Failed to generate preview gif: {}", e))?;

    if !output.status.success() || output.stdout.is_empty() {
        return Err("Empty gif output".into());
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
async fn gen_thumb(
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

    let _permit = thumbnail_semaphore()
        .acquire()
        .await
        .map_err(|e| format!("Failed to acquire semaphore: {}", e))?;

    let image_data = gen_thumb_data(&video_path).await?;

    let cache_file_clone = cache_file.clone();
    let image_data_clone = image_data.clone();
    tokio::spawn(async move {
        let _ = fs::write(cache_file_clone, image_data_clone).await;
    });

    use base64::prelude::*;
    Ok(BASE64_STANDARD.encode(image_data))
}

#[tauri::command]
async fn gen_gif(
    app_handle: tauri::AppHandle,
    video_path: String,
) -> Result<String, String> {
    let cache_dir = get_cache_dir(&app_handle).await?;
    let hash = get_video_hash(&video_path).await?;
    let cache_file = cache_dir.join(format!("preview_{}.gif", hash));

    if let Ok(data) = fs::read(&cache_file).await {
        use base64::prelude::*;
        return Ok(BASE64_STANDARD.encode(data));
    }

    let _permit = preview_semaphore()
        .acquire()
        .await
        .map_err(|e| format!("Failed to acquire semaphore: {}", e))?;

    let gif_data = gen_gif_data(&video_path).await?;

    let cache_file_clone = cache_file.clone();
    let gif_data_clone = gif_data.clone();
    tokio::spawn(async move {
        let _ = fs::write(cache_file_clone, gif_data_clone).await;
    });

    use base64::prelude::*;
    Ok(BASE64_STANDARD.encode(gif_data))
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
            gen_thumb,
            gen_gif,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}