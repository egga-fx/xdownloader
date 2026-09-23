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
    AppSettings, BinariesStatus, DownloadRecord, LogEntry, SplitLocalRequest, SplitStreamRequest, TimeRange,
    TrimStreamRequest, TrimVideoRequest, VideoInfo,
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
async fn split_local_video(
    app: AppHandle,
    state: State<'_, AppState>,
    req: SplitLocalRequest,
) -> Result<Vec<String>, String> {
    downloader::split_local_video(app, state.db.clone(), req).await
}

#[tauri::command]
async fn split_stream_video(
    app: AppHandle,
    state: State<'_, AppState>,
    req: SplitStreamRequest,
) -> Result<Vec<String>, String> {
    downloader::split_stream_video(app, state.db.clone(), state.process_mgr.clone(), req).await
}

#[tauri::command]
async fn trim_local_video(
    app: AppHandle,
    state: State<'_, AppState>,
    req: TrimVideoRequest,
) -> Result<String, String> {
    downloader::trim_local_video_exact(app, state.db.clone(), req).await
}

#[tauri::command]
async fn trim_stream_video(
    app: AppHandle,
    state: State<'_, AppState>,
    req: TrimStreamRequest,
) -> Result<String, String> {
    downloader::trim_stream_video_exact(app, state.db.clone(), state.process_mgr.clone(), req).await
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

pub fn run() {
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
            split_local_video,
            split_stream_video,
            trim_local_video,
            trim_stream_video,
            get_recent_logs,
            clear_app_logs,
            open_logs_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running xDownloader application");
}
