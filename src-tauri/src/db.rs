use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use crate::models::{AppSettings, DownloadRecord};

pub struct Database {
    conn: Mutex<Connection>,
    #[allow(dead_code)]
    db_path: PathBuf,
}

pub fn get_database_path() -> PathBuf {
    // 1. Portable mode: if ./data exists next to the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let portable_data = parent.join("data");
            if portable_data.exists() {
                return portable_data.join("vault.db");
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let portable_data = cwd.join("data");
        if portable_data.exists() {
            return portable_data.join("vault.db");
        }
    }

    // 2. Standard AppData directory (%APPDATA%/xdownloader/vault.db)
    if let Some(config_dir) = dirs::config_dir() {
        let app_dir = config_dir.join("xdownloader");
        let _ = fs::create_dir_all(&app_dir);
        return app_dir.join("vault.db");
    }

    PathBuf::from("vault.db")
}

impl Database {
    pub fn new() -> Result<Self, String> {
        let db_path = get_database_path();
        if let Some(parent) = db_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database at {:?}: {}", db_path, e))?;

        // Enable SQLite WAL mode
        let _ = conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");

        // Create tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                url TEXT NOT NULL,
                title TEXT NOT NULL,
                author TEXT NOT NULL DEFAULT '',
                duration_sec INTEGER NOT NULL DEFAULT 0,
                thumbnail_url TEXT NOT NULL DEFAULT '',
                format_type TEXT NOT NULL,
                quality TEXT NOT NULL,
                file_path TEXT NOT NULL DEFAULT '',
                file_size_bytes INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL
            );",
            [],
        )
        .map_err(|e| format!("Failed to create downloads table: {}", e))?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
            [],
        )
        .map_err(|e| format!("Failed to create settings table: {}", e))?;

        // Auto-migration: ensure time_range columns exist for partial clips
        let _ = conn.execute("ALTER TABLE downloads ADD COLUMN time_range_start TEXT;", []);
        let _ = conn.execute("ALTER TABLE downloads ADD COLUMN time_range_end TEXT;", []);

        Ok(Self {
            conn: Mutex::new(conn),
            db_path,
        })
    }

    pub fn add_record(&self, record: &DownloadRecord) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex lock poisoned")?;
        let tr_start = record.time_range.as_ref().map(|tr| tr.start.clone());
        let tr_end = record.time_range.as_ref().map(|tr| tr.end.clone());
        conn.execute(
            "INSERT OR REPLACE INTO downloads (
                id, platform, url, title, author, duration_sec, thumbnail_url,
                format_type, quality, file_path, file_size_bytes, status, error, created_at,
                time_range_start, time_range_end
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                record.id,
                record.platform,
                record.url,
                record.title,
                record.author,
                record.duration_sec,
                record.thumbnail_url,
                record.format_type,
                record.quality,
                record.file_path,
                record.file_size_bytes,
                record.status,
                record.error,
                record.created_at,
                tr_start,
                tr_end,
            ],
        )
        .map_err(|e| format!("Failed to insert record: {}", e))?;
        Ok(())
    }

    pub fn update_record(
        &self,
        id: &str,
        status: &str,
        file_path: Option<&str>,
        file_size_bytes: Option<i64>,
        error: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex lock poisoned")?;
        if let (Some(path), Some(size)) = (file_path, file_size_bytes) {
            conn.execute(
                "UPDATE downloads SET status = ?1, file_path = ?2, file_size_bytes = ?3, error = ?4 WHERE id = ?5",
                params![status, path, size, error, id],
            )
        } else {
            conn.execute(
                "UPDATE downloads SET status = ?1, error = ?2 WHERE id = ?3",
                params![status, error, id],
            )
        }
        .map_err(|e| format!("Failed to update record: {}", e))?;
        Ok(())
    }

    pub fn get_records(
        &self,
        platform: Option<String>,
        format_type: Option<String>,
        search: Option<String>,
    ) -> Result<Vec<DownloadRecord>, String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex lock poisoned")?;

        let mut query = String::from("SELECT id, platform, url, title, author, duration_sec, thumbnail_url, format_type, quality, file_path, file_size_bytes, status, error, created_at, time_range_start, time_range_end FROM downloads WHERE 1=1");
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(p) = platform {
            if p != "all" {
                query.push_str(" AND platform = ?");
                params_vec.push(Box::new(p));
            }
        }
        if let Some(f) = format_type {
            if f != "all" {
                query.push_str(" AND format_type = ?");
                params_vec.push(Box::new(f));
            }
        }
        if let Some(s) = search {
            if !s.trim().is_empty() {
                query.push_str(" AND (title LIKE ? OR author LIKE ?)");
                let pattern = format!("%{}%", s.trim());
                params_vec.push(Box::new(pattern.clone()));
                params_vec.push(Box::new(pattern));
            }
        }

        query.push_str(" ORDER BY created_at DESC");

        let mut stmt = conn.prepare(&query).map_err(|e| format!("SQL prepare error: {}", e))?;
        let rusqlite_params: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

        let rows = stmt
            .query_map(rusqlite_params.as_slice(), |row| {
                let file_path: String = row.get(9)?;
                let exists = if !file_path.is_empty() {
                    Path::new(&file_path).exists()
                } else {
                    false
                };

                let tr_start: Option<String> = row.get(14).ok();
                let tr_end: Option<String> = row.get(15).ok();
                let time_range = match (tr_start, tr_end) {
                    (Some(s), Some(e)) if !s.trim().is_empty() || !e.trim().is_empty() => {
                        Some(crate::models::TimeRange { start: s, end: e })
                    }
                    _ => None,
                };

                Ok(DownloadRecord {
                    id: row.get(0)?,
                    platform: row.get(1)?,
                    url: row.get(2)?,
                    title: row.get(3)?,
                    author: row.get(4)?,
                    duration_sec: row.get(5)?,
                    thumbnail_url: row.get(6)?,
                    format_type: row.get(7)?,
                    quality: row.get(8)?,
                    file_path,
                    file_size_bytes: row.get(10)?,
                    status: row.get(11)?,
                    error: row.get(12)?,
                    created_at: row.get(13)?,
                    time_range,
                    exists,
                })
            })
            .map_err(|e| format!("Query map error: {}", e))?;

        let records: Vec<_> = rows.flatten().collect();

        Ok(records)
    }

    pub fn delete_record(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex lock poisoned")?;

        // Retrieve file path to unlink physical media file if it exists
        let mut stmt = conn
            .prepare("SELECT file_path FROM downloads WHERE id = ?1")
            .map_err(|e| format!("SQL prepare error: {}", e))?;

        let file_path: Option<String> = stmt
            .query_row(params![id], |row| row.get(0))
            .ok();

        if let Some(path_str) = file_path {
            if !path_str.is_empty() {
                let path = Path::new(&path_str);
                if path.exists() {
                    let _ = fs::remove_file(path);
                }
            }
        }

        // Delete from SQLite
        conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete record from DB: {}", e))?;

        Ok(())
    }

    pub fn get_settings(&self) -> Result<AppSettings, String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex lock poisoned")?;
        let mut stmt = conn
            .prepare("SELECT value FROM settings WHERE key = 'app_settings'")
            .map_err(|e| format!("SQL prepare error: {}", e))?;

        let val: Option<String> = stmt.query_row([], |row| row.get(0)).ok();
        if let Some(json_str) = val {
            if let Ok(mut settings) = serde_json::from_str::<AppSettings>(&json_str) {
                if settings.output_folder.trim().is_empty() {
                    settings.output_folder = crate::downloader::get_default_download_dir()
                        .to_string_lossy()
                        .to_string();
                }
                return Ok(settings);
            }
        }

        Ok(AppSettings {
            output_folder: crate::downloader::get_default_download_dir()
                .to_string_lossy()
                .to_string(),
            ..Default::default()
        })
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database mutex lock poisoned")?;
        let json_str = serde_json::to_string(settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;

        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('app_settings', ?1)",
            params![json_str],
        )
        .map_err(|e| format!("Failed to save settings: {}", e))?;

        Ok(())
    }
}
