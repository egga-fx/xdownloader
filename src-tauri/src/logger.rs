use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use chrono::Local;

static LOG_MUTEX: Mutex<()> = Mutex::new(());

const MAX_LOG_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB

pub fn get_logs_dir() -> PathBuf {
    // 1. Portable mode: if ./data exists or ./logs exists
    if let Ok(cwd) = std::env::current_dir() {
        let portable_logs = cwd.join("logs");
        if cwd.join("data").exists() || portable_logs.exists() {
            let _ = fs::create_dir_all(&portable_logs);
            return portable_logs;
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let portable_logs = parent.join("logs");
            if parent.join("data").exists() || portable_logs.exists() {
                let _ = fs::create_dir_all(&portable_logs);
                return portable_logs;
            }
        }
    }

    // 2. Standard AppData directory (%APPDATA%/xdownloader/logs)
    if let Some(config_dir) = dirs::config_dir() {
        let app_logs = config_dir.join("xdownloader").join("logs");
        let _ = fs::create_dir_all(&app_logs);
        return app_logs;
    }

    let default_logs = PathBuf::from("logs");
    let _ = fs::create_dir_all(&default_logs);
    default_logs
}

pub fn get_log_file_path() -> PathBuf {
    get_logs_dir().join("app.log")
}

pub fn write_file_log(level: &str, category: &str, task_id: &str, message: &str) {
    let _guard = match LOG_MUTEX.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    let log_path = get_log_file_path();

    // Check for log file rotation (> 10MB)
    if let Ok(metadata) = fs::metadata(&log_path) {
        if metadata.len() >= MAX_LOG_SIZE_BYTES {
            let rotated_path = get_logs_dir().join("app.log.1");
            let _ = fs::rename(&log_path, rotated_path);
        }
    }

    let now_str = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let task_tag = if task_id.is_empty() {
        "-".to_string()
    } else {
        task_id.to_string()
    };

    let formatted_line = format!(
        "[{}] [{:<5}] [{:<8}] [{}] {}\n",
        now_str,
        level.to_uppercase(),
        category.to_uppercase(),
        task_tag,
        message.trim()
    );

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = file.write_all(formatted_line.as_bytes());
    }
}

pub fn read_recent_file_logs(limit: usize) -> Vec<String> {
    let log_path = get_log_file_path();
    if !log_path.exists() {
        return Vec::new();
    }

    if let Ok(file) = File::open(&log_path) {
        let reader = BufReader::new(file);
        let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();
        let total = lines.len();
        if total <= limit {
            lines
        } else {
            lines[total - limit..].to_vec()
        }
    } else {
        Vec::new()
    }
}
