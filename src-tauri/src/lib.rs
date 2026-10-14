pub mod binaries;
pub mod db;
pub mod downloader;
pub mod image_extractor;
pub mod logger;
pub mod metadata;
pub mod models;
pub mod transcriber;

use std::sync::Arc;
use tauri::{AppHandle, State};
use db::Database;
use downloader::ProcessManager;
use models::{
    ActiveDownloadTask, AppSettings, BinariesStatus, DownloadRecord, LogEntry, MediaItem, TaskProgress, TimeRange,
    TranscriptionConfig, VideoInfo,
};

pub struct AppState {
    pub db: Arc<Database>,
    pub process_mgr: Arc<ProcessManager>,
    pub transcription_mgr: Arc<transcriber::TranscriptionManager>,
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
    media_items: Option<Vec<MediaItem>>,
) -> Result<String, String> {
    let task_id = format!("dl_{}_{}", chrono::Utc::now().timestamp_millis(), &uuid_short());
    let db = state.db.clone();
    let process_mgr = state.process_mgr.clone();

    let raw_stem = custom_name.as_deref().or(title.as_deref()).unwrap_or("media_download").to_string();
    let out_dir = match output_folder {
        Some(ref f) if !f.trim().is_empty() => std::path::PathBuf::from(f),
        _ => downloader::get_default_download_dir(),
    };

    let context = downloader::DownloadTaskContext {
        task_id: task_id.clone(),
        url: url.clone(),
        format_type: format_type.clone(),
        quality: quality.clone(),
        title: title.clone(),
        thumbnail_url: thumbnail_url.clone(),
        author: author.clone(),
        duration_sec,
        custom_name: custom_name.clone(),
        output_folder: output_folder.clone(),
        download_subtitles,
        time_range: time_range.clone(),
        selected_indices: selected_indices.clone(),
        image_urls: image_urls.clone(),
        media_items: media_items.clone(),
        out_dir: out_dir.clone(),
        raw_stem: raw_stem.clone(),
    };
    process_mgr.register_context(context);

    let task_id_clone = task_id.clone();
    let process_mgr_clone = process_mgr.clone();
    let app_spawn = app.clone();
    let db_spawn = db.clone();
    let url_fallback = url.clone();
    let title_fallback = title.clone();
    let format_type_fallback = format_type.clone();
    let quality_fallback = quality.clone();

    let task_handle = tokio::spawn(async move {
        let res = downloader::run_download(
            app_spawn.clone(),
            db_spawn.clone(),
            process_mgr_clone.clone(),
            task_id_clone.clone(),
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
            media_items,
        )
        .await;

        if let Err(err_msg) = res {
            let _ = db_spawn.update_record(&task_id_clone, "error", None, None, Some(&err_msg));
            let _ = db_spawn.log_event(
                &task_id_clone,
                "ERROR",
                "DOWNLOAD",
                &format!("Download supervisor caught error: {}", err_msg),
                None,
            );
            let mut err_task = process_mgr_clone
                .get_active_task_snapshot(&task_id_clone)
                .unwrap_or_else(|| ActiveDownloadTask {
                    task_id: task_id_clone.clone(),
                    url: url_fallback,
                    title: title_fallback.unwrap_or_else(|| "Media".to_string()),
                    platform: "media".to_string(),
                    format_type: format_type_fallback,
                    quality: quality_fallback,
                    status: "error".to_string(),
                    progress: TaskProgress {
                        percent: 0.0,
                        speed_str: "Failed".to_string(),
                        eta_str: "--:--".to_string(),
                        downloaded_bytes: None,
                        total_bytes: None,
                    },
                    error: Some(err_msg.clone()),
                });
            err_task.status = "error".to_string();
            err_task.error = Some(err_msg.clone());
            process_mgr_clone.update_active_task_snapshot(&err_task);
            let _ = tauri::Emitter::emit(&app_spawn, "download-progress", &err_task);
        }

        process_mgr_clone.remove(&task_id_clone);
    });

    process_mgr.register_native(task_id.clone(), task_handle.abort_handle(), out_dir, raw_stem);

    Ok(task_id)
}

#[tauri::command]
async fn pause_download(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
) -> Result<bool, String> {
    let _ = state.db.set_task_status(&task_id, "paused");
    let _ = state.db.log_event(&task_id, "INFO", "DOWNLOAD", "Download paused by user", None);

    let paused = state.process_mgr.pause(&task_id);

    if let Some(mut task) = state.process_mgr.get_active_task_snapshot(&task_id) {
        task.status = "paused".to_string();
        task.progress.speed_str = "Paused".to_string();
        task.progress.eta_str = String::new();
        state.process_mgr.update_active_task_snapshot(&task);
        let _ = tauri::Emitter::emit(&app, "download-progress", &task);
    }

    Ok(paused)
}

#[tauri::command]
async fn resume_download(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
) -> Result<bool, String> {
    let ctx = match state.process_mgr.get_context(&task_id) {
        Some(c) => c,
        None => {
            if let Ok(Some(rec)) = state.db.get_record_by_id(&task_id) {
                let raw_stem = downloader::sanitize_filename(&rec.title);
                let out_dir = downloader::get_default_download_dir();
                downloader::DownloadTaskContext {
                    task_id: task_id.clone(),
                    url: rec.url,
                    format_type: rec.format_type,
                    quality: rec.quality,
                    title: Some(rec.title),
                    thumbnail_url: Some(rec.thumbnail_url),
                    author: Some(rec.author),
                    duration_sec: Some(rec.duration_sec),
                    custom_name: None,
                    output_folder: None,
                    download_subtitles: false,
                    time_range: rec.time_range,
                    selected_indices: None,
                    image_urls: None,
                    media_items: None,
                    out_dir,
                    raw_stem,
                }
            } else {
                return Err(format!("Task context for '{}' not found", task_id));
            }
        }
    };

    let _ = state.db.set_task_status(&task_id, "downloading");
    let _ = state.db.log_event(&task_id, "INFO", "DOWNLOAD", "Resuming download...", None);
    state.process_mgr.unmark_paused(&task_id);

    if let Some(mut task) = state.process_mgr.get_active_task_snapshot(&task_id) {
        task.status = "downloading".to_string();
        task.progress.speed_str = "Resuming...".to_string();
        state.process_mgr.update_active_task_snapshot(&task);
        let _ = tauri::Emitter::emit(&app, "download-progress", &task);
    }

    let app_clone = app.clone();
    let db_clone = state.db.clone();
    let process_mgr_clone = state.process_mgr.clone();
    let task_id_clone = task_id.clone();
    let ctx_clone = ctx.clone();

    let task_handle = tokio::spawn(async move {
        let res = downloader::run_download(
            app_clone.clone(),
            db_clone.clone(),
            process_mgr_clone.clone(),
            task_id_clone.clone(),
            ctx_clone.url.clone(),
            ctx_clone.format_type.clone(),
            ctx_clone.quality.clone(),
            ctx_clone.title.clone(),
            ctx_clone.thumbnail_url,
            ctx_clone.author,
            ctx_clone.duration_sec,
            ctx_clone.custom_name,
            ctx_clone.output_folder,
            ctx_clone.download_subtitles,
            ctx_clone.time_range,
            ctx_clone.selected_indices,
            ctx_clone.image_urls,
            ctx_clone.media_items,
        )
        .await;

        if let Err(err_msg) = res {
            let _ = db_clone.update_record(&task_id_clone, "error", None, None, Some(&err_msg));
            let _ = db_clone.log_event(
                &task_id_clone,
                "ERROR",
                "DOWNLOAD",
                &format!("Resume download supervisor caught error: {}", err_msg),
                None,
            );
            let mut err_task = process_mgr_clone
                .get_active_task_snapshot(&task_id_clone)
                .unwrap_or_else(|| ActiveDownloadTask {
                    task_id: task_id_clone.clone(),
                    url: ctx_clone.url.clone(),
                    title: ctx_clone.title.clone().unwrap_or_else(|| "Media".to_string()),
                    platform: "media".to_string(),
                    format_type: ctx_clone.format_type.clone(),
                    quality: ctx_clone.quality.clone(),
                    status: "error".to_string(),
                    progress: TaskProgress {
                        percent: 0.0,
                        speed_str: "Failed".to_string(),
                        eta_str: "--:--".to_string(),
                        downloaded_bytes: None,
                        total_bytes: None,
                    },
                    error: Some(err_msg.clone()),
                });
            err_task.status = "error".to_string();
            err_task.error = Some(err_msg.clone());
            process_mgr_clone.update_active_task_snapshot(&err_task);
            let _ = tauri::Emitter::emit(&app_clone, "download-progress", &err_task);
        }

        process_mgr_clone.remove(&task_id_clone);
    });

    state.process_mgr.register_native(task_id, task_handle.abort_handle(), ctx.out_dir, ctx.raw_stem);
    Ok(true)
}

#[tauri::command]
fn cancel_download(state: State<'_, AppState>, task_id: String) -> bool {
    let _ = state.db.set_task_status(&task_id, "cancelled");
    state.process_mgr.cancel(&task_id)
}

#[tauri::command]
fn get_download_records(
    state: State<'_, AppState>,
    platform: Option<String>,
    format_type: Option<String>,
    search: Option<String>,
) -> Result<Vec<DownloadRecord>, String> {
    let mut records = state.db.get_records(platform, format_type, search)?;

    for rec in records.iter_mut() {
        if rec.status == "completed" && rec.exists && !rec.file_path.is_empty() {
            let p = std::path::Path::new(&rec.file_path);
            if p.exists() {
                // 1. Auto-heal missing thumbnail or dead local thumbnail
                let needs_thumb = rec.thumbnail_url.trim().is_empty()
                    || (!rec.thumbnail_url.starts_with("http") && !std::path::Path::new(&rec.thumbnail_url).exists());

                if needs_thumb {
                    if let Some(thumb) = downloader::generate_local_thumbnail(p, &rec.id) {
                        let _ = state.db.update_record_thumbnail(&rec.id, &thumb);
                        rec.thumbnail_url = thumb;
                    }
                }

                // 2. Auto-heal title if still a raw fallback URL or generic "Media"
                if rec.title.starts_with("http") || rec.title == "Media" || rec.title.trim().is_empty() {
                    if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                        let _ = state.db.update_record_title(&rec.id, stem);
                        rec.title = stem.to_string();
                    }
                }
            }
        }
    }

    Ok(records)
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
fn save_app_settings(state: State<'_, AppState>, settings: serde_json::Value) -> Result<bool, String> {
    let mut current = state.db.get_settings().unwrap_or_default();

    if let Some(folder) = settings.get("outputFolder").and_then(|v| v.as_str()) {
        let trimmed = folder.trim();
        if !trimmed.is_empty() {
            current.output_folder = trimmed.to_string();
        }
    }
    if let Some(vq) = settings.get("defaultVideoQuality").and_then(|v| v.as_str()) {
        if !vq.trim().is_empty() {
            current.default_video_quality = vq.to_string();
        }
    }
    if let Some(aq) = settings.get("defaultAudioQuality").and_then(|v| v.as_str()) {
        if !aq.trim().is_empty() {
            current.default_audio_quality = aq.to_string();
        }
    }
    if let Some(clip) = settings.get("autoClipboardDetect").and_then(|v| v.as_bool()) {
        current.auto_clipboard_detect = clip;
    }
    if let Some(subs) = settings.get("downloadSubtitles").and_then(|v| v.as_bool()) {
        current.download_subtitles = subs;
    }
    if let Some(upd) = settings.get("checkUpdatesOnStartup").and_then(|v| v.as_bool()) {
        current.check_updates_on_startup = upd;
    }
    if let Some(notif) = settings.get("desktopNotifications").and_then(|v| v.as_bool()) {
        current.desktop_notifications = notif;
    }

    state.db.save_settings(&current).map(|_| true)
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
fn get_transcription_config(state: State<'_, AppState>) -> Result<TranscriptionConfig, String> {
    transcriber::load_config(&state.db).map(|c| c.to_public())
}

/// `api_key`: `None` keeps the stored key, `Some("")` clears it, `Some(k)` replaces it.
/// Returns the updated UI-safe config (never contains the key).
#[tauri::command]
fn save_transcription_config(
    state: State<'_, AppState>,
    config: TranscriptionConfig,
    api_key: Option<String>,
) -> Result<TranscriptionConfig, String> {
    let mut stored = transcriber::load_config(&state.db)?;
    stored.apply_save(&config, api_key.as_deref())?;
    transcriber::save_config(&state.db, &stored)?;
    Ok(stored.to_public())
}

/// `Ok(true)` valid, `Ok(false)` rejected (status becomes `invalid`), `Err` inconclusive.
#[tauri::command]
async fn test_transcription_key(state: State<'_, AppState>) -> Result<bool, String> {
    let db = state.db.clone();
    transcriber::test_api_key(&db).await
}

#[tauri::command]
async fn start_transcription(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    language_code: Option<String>,
    custom_name: Option<String>,
    output_folder: Option<String>,
    time_range: Option<TimeRange>,
) -> Result<String, String> {
    let task_id = format!("tr_{}_{}", chrono::Utc::now().timestamp_millis(), uuid_short());
    let db = state.db.clone();
    let process_mgr = state.process_mgr.clone();
    let transcription_mgr = state.transcription_mgr.clone();

    // Guard: Verify key is configured before doing any async work
    let cfg = transcriber::load_config(&db)?;
    cfg.ensure_ready()?;

    let task_id_clone = task_id.clone();
    let app_clone = app.clone();
    let task_mgr_for_cleanup = transcription_mgr.clone();
    let task_id_for_cleanup = task_id.clone();

    let join_handle = tokio::spawn(async move {
        let _ = transcriber::run_transcription(
            app_clone,
            db,
            process_mgr,
            transcription_mgr,
            task_id_clone,
            url,
            language_code,
            custom_name,
            output_folder,
            time_range,
        )
        .await;
        task_mgr_for_cleanup.remove(&task_id_for_cleanup);
    });

    state.transcription_mgr.register(task_id.clone(), join_handle.abort_handle());
    Ok(task_id)
}

#[tauri::command]
fn cancel_transcription(state: State<'_, AppState>, task_id: String) -> bool {
    let audio_task_id = format!("{}_audio", task_id);
    let _ = state.process_mgr.cancel(&audio_task_id);
    let _ = state.process_mgr.cancel(&task_id);
    state.transcription_mgr.cancel(&task_id)
}

#[tauri::command]
fn open_logs_folder() -> bool {
    let logs_dir = logger::get_logs_dir();
    open_in_explorer(logs_dir.to_string_lossy().to_string())
}

pub fn uuid_short() -> String {
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

#[tauri::command]
async fn check_for_app_update(app: tauri::AppHandle) -> Result<models::AppUpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let url = "https://api.github.com/repos/egga-fx/xdownloader/releases/latest";
    let resp = client
        .get(url)
        .header("User-Agent", format!("xDownloader-Desktop/{}", current_version))
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Failed to connect to GitHub releases API: {}", e))?;

    if !resp.status().is_success() {
        return Ok(models::AppUpdateInfo {
            available: false,
            current_version,
            version: None,
            body: None,
            date: None,
            download_url: None,
            release_url: Some("https://github.com/egga-fx/xdownloader/releases/latest".to_string()),
        });
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse release response: {}", e))?;

    let tag = data
        .get("tag_name")
        .or_else(|| data.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let clean_remote = tag.trim_start_matches('v').trim();
    let is_newer = is_version_newer_semver(clean_remote, &current_version);

    let mut download_url = None;
    if let Some(assets) = data.get("assets").and_then(|a| a.as_array()) {
        for asset in assets {
            if let Some(name) = asset.get("name").and_then(|n| n.as_str()) {
                if name.to_lowercase().ends_with(".exe") {
                    if let Some(url) = asset.get("browser_download_url").and_then(|u| u.as_str()) {
                        download_url = Some(url.to_string());
                        break;
                    }
                }
            }
        }
    }

    let release_url = data
        .get("html_url")
        .and_then(|u| u.as_str())
        .map(|s| s.to_string())
        .or_else(|| Some("https://github.com/egga-fx/xdownloader/releases/latest".to_string()));

    let body = data.get("body").and_then(|b| b.as_str()).map(|s| s.to_string());
    let date = data.get("published_at").and_then(|d| d.as_str()).map(|s| s.to_string());

    Ok(models::AppUpdateInfo {
        available: is_newer,
        current_version,
        version: Some(clean_remote.to_string()),
        body,
        date,
        download_url,
        release_url,
    })
}

fn is_version_newer_semver(remote: &str, current: &str) -> bool {
    let clean = |s: &str| -> Vec<u32> {
        s.trim_start_matches('v')
            .trim()
            .split('.')
            .map(|p| p.parse::<u32>().unwrap_or(0))
            .collect()
    };
    let v_rem = clean(remote);
    let v_cur = clean(current);
    for i in 0..std::cmp::max(v_rem.len(), v_cur.len()) {
        let r = *v_rem.get(i).unwrap_or(&0);
        let c = *v_cur.get(i).unwrap_or(&0);
        if r > c {
            return true;
        }
        if r < c {
            return false;
        }
    }
    false
}

#[tauri::command]
async fn start_transcription_for_file(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    language_code: Option<String>,
    custom_name: Option<String>,
    output_folder: Option<String>,
) -> Result<String, String> {
    let task_id = format!("tr_file_{}_{}", chrono::Utc::now().timestamp_millis(), uuid_short());
    let db = state.db.clone();
    let process_mgr = state.process_mgr.clone();
    let transcription_mgr = state.transcription_mgr.clone();

    // Guard: Verify key is configured before doing any async work
    let cfg = transcriber::load_config(&db)?;
    cfg.ensure_ready()?;

    let task_id_clone = task_id.clone();
    let app_clone = app.clone();
    let task_mgr_for_cleanup = transcription_mgr.clone();
    let task_id_for_cleanup = task_id.clone();

    let join_handle = tokio::spawn(async move {
        let _ = transcriber::run_file_transcription(
            app_clone,
            db,
            process_mgr,
            task_id_clone,
            file_path,
            language_code,
            custom_name,
            output_folder,
        )
        .await;
        task_mgr_for_cleanup.remove(&task_id_for_cleanup);
    });

    state.transcription_mgr.register(task_id.clone(), join_handle.abort_handle());
    Ok(task_id)
}

#[tauri::command]
async fn read_subtitle_file(file_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Err("Subtitle file does not exist".to_string());
    }
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("Failed to read subtitle file: {}", e))
}

#[tauri::command]
async fn save_subtitle_file(file_path: String, content: String) -> Result<bool, String> {
    let path = std::path::Path::new(&file_path);
    if let Some(parent) = path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    tokio::fs::write(path, content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write subtitle file: {}", e))?;
    Ok(true)
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
    let transcription_mgr = Arc::new(transcriber::TranscriptionManager::new());
    let state = AppState {
        db,
        process_mgr,
        transcription_mgr,
    };

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
            pause_download,
            resume_download,
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
            check_for_app_update,
            install_app_update_from_url,
            get_transcription_config,
            save_transcription_config,
            test_transcription_key,
            start_transcription,
            start_transcription_for_file,
            cancel_transcription,
            read_subtitle_file,
            save_subtitle_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running xDownloader application");
}
