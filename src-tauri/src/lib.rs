pub mod binaries;
pub mod db;
pub mod downloader;
pub mod image_extractor;
pub mod logger;
pub mod metadata;
pub mod models;

use std::sync::Arc;
use tauri::{AppHandle, State};
use db::Database;
use downloader::ProcessManager;
use models::{
    AppSettings, BinariesStatus, DownloadRecord, LogEntry, TimeRange, VideoInfo,
};

pub struct AppState {
    pub db: Arc<Database>,
    pub process_mgr: Arc<ProcessManager>,
}

#[tauri::command]
fn check_binaries_status() -> BinariesStatus {
    binaries::check_binaries()
}

#[tauri::command]
async fn install_binary(app: AppHandle, binary_type: String) -> Result<bool, String> {
    binaries::download_binary_file(&app, &binary_type)
        .await
        .map(|_| true)
}

#[tauri::command]
async fn update_engine(app: AppHandle) -> Result<String, String> {
    binaries::update_ytdlp(&app).await
}

#[tauri::command]
async fn get_video_metadata(url: String) -> Result<VideoInfo, String> {
    metadata::fetch_video_metadata(&url).await
}

#[tauri::command]
async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    format_type: String,
    quality: String,
    title: Option<String>,
    thumbnail_url: Option<String>,
    author: Option<String>,
    duration_sec: Option<i64>,
    custom_name: Option<String>,
    output_folder: Option<String>,
    download_subtitles: bool,
    time_range: Option<TimeRange>,
    selected_indices: Option<Vec<usize>>,
    image_urls: Option<Vec<String>>,
) -> Result<String, String> {
    let task_id = format!("dl_{}_{}", chrono::Utc::now().timestamp_millis(), &uuid_short());
    let db = state.db.clone();
    let process_mgr = state.process_mgr.clone();

    let task_id_clone = task_id.clone();
    tokio::spawn(async move {
        let _ = downloader::run_download(
            app,
            db,
            process_mgr,
            task_id_clone,
            url,
            format_type,
            quality,
            title,
            thumbnail_url,
            author,
            duration_sec,
            custom_name,
            output_folder,
            download_subtitles,
            time_range,
            selected_indices,
            image_urls,
        )
        .await;
    });

    Ok(task_id)
}

#[tauri::command]
fn cancel_download(state: State<'_, AppState>, task_id: String) -> bool {
    state.process_mgr.cancel(&task_id)
}

#[tauri::command]
fn get_download_records(
    state: State<'_, AppState>,
    platform: Option<String>,
    format_type: Option<String>,
    search: Option<String>,
) -> Result<Vec<DownloadRecord>, String> {
    state.db.get_records(platform, format_type, search)
}

#[tauri::command]
fn delete_download_record(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.db.delete_record(&id).map(|_| true)
}

#[tauri::command]
fn open_in_explorer(path: String) -> bool {
    if path.is_empty() {
        return false;
    }
    let p = std::path::Path::new(&path);
    if p.is_file() {
        if let Some(parent) = p.parent() {
            let _ = open::that(parent);
            return true;
        }
    }
    open::that(&path).is_ok()
}

#[tauri::command]
fn open_media_file(path: String) -> bool {
    if path.is_empty() {
        return false;
    }
    open::that(&path).is_ok()
}

#[tauri::command]
fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.db.get_settings()
}

#[tauri::command]
fn save_app_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<bool, String> {
    state.db.save_settings(&settings).map(|_| true)
}

#[tauri::command]
fn get_recent_logs(
    state: State<'_, AppState>,
    limit: Option<u32>,
    level: Option<String>,
) -> Result<Vec<LogEntry>, String> {
    state.db.get_recent_logs(limit.unwrap_or(100), level.as_deref())
}

#[tauri::command]
fn clear_app_logs(state: State<'_, AppState>) -> Result<bool, String> {
    state.db.clear_logs().map(|_| true)
}

#[tauri::command]
fn open_logs_folder() -> bool {
    let logs_dir = logger::get_logs_dir();
    open_in_explorer(logs_dir.to_string_lossy().to_string())
}

fn uuid_short() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .subsec_nanos();
    format!("{:x}", nanos)
}

#[tauri::command]
fn get_clipboard_text(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().read_text().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_clipboard_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
async fn install_app_update_from_url(app: tauri::AppHandle, url: String) -> Result<bool, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    use tauri::Emitter;

    if url.is_empty() {
        return Err("Download URL is empty".to_string());
    }

    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join("xdownloader_setup_update.exe");

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let response = client
        .get(&url)
        .header("User-Agent", "xDownloader-Updater")
        .send()
        .await
        .map_err(|e| format!("Failed to download update from GitHub: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&installer_path)
        .await
        .map_err(|e| format!("Failed to create temporary installer file: {}", e))?;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Error downloading chunk: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Error writing chunk: {}", e))?;

        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let pct = ((downloaded as f64 / total_size as f64) * 100.0).min(100.0) as u32;
            let _ = app.emit("app-update-progress", pct);
        }
    }
    file.flush().await.map_err(|e| format!("Flush error: {}", e))?;
    drop(file);

    let _ = app.emit("app-update-progress", 100u32);

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let _ = Command::new(&installer_path).spawn();
        std::process::exit(0);
    }

    #[cfg(not(target_os = "windows"))]
    {
        open::that(&installer_path).map_err(|e| e.to_string())?;
        std::process::exit(0);
    }
}

pub fn run() {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        let app_id: Vec<u16> = OsStr::new("com.eggafx.xdownloader")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        extern "system" {
            fn SetCurrentProcessExplicitAppUserModelID(AppID: *const u16) -> i32;
        }

        unsafe {
            let _ = SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr());
        }
    }

    let db = match Database::new() {
        Ok(d) => Arc::new(d),
        Err(e) => {
            eprintln!("Failed to initialize database: {}", e);
            panic!("Database initialization failed: {}", e);
        }
    };

    let process_mgr = Arc::new(ProcessManager::new());
    let state = AppState { db, process_mgr };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            check_binaries_status,
            install_binary,
            update_engine,
            get_video_metadata,
            start_download,
            cancel_download,
            get_download_records,
            delete_download_record,
            open_in_explorer,
            open_media_file,
            get_app_settings,
            save_app_settings,
            get_recent_logs,
            clear_app_logs,
            open_logs_folder,
            get_clipboard_text,
            set_clipboard_text,
            install_app_update_from_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running xDownloader application");
}
