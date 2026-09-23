use std::path::PathBuf;
use std::process::Command;
use std::fs;
use tauri::{AppHandle, Emitter};
use crate::models::BinariesStatus;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn get_app_bin_dir() -> PathBuf {
    // 1. Portable mode: if ./bin or ./data exists next to the exe or current dir
    if let Ok(cwd) = std::env::current_dir() {
        let local_bin = cwd.join("bin");
        if local_bin.exists() {
            return local_bin;
        }
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let local_bin = parent.join("bin");
            if local_bin.exists() {
                return local_bin;
            }
        }
    }

    // 2. Standard AppData directory (%APPDATA%/xdownloader/bin)
    if let Some(config_dir) = dirs::config_dir() {
        let app_bin = config_dir.join("xdownloader").join("bin");
        let _ = fs::create_dir_all(&app_bin);
        return app_bin;
    }

    PathBuf::from("./bin")
}

pub fn find_binary(binary_name: &str) -> Option<PathBuf> {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let full_name = format!("{}{}", binary_name, ext);

    // 1. Check in app bin directory
    let bin_dir = get_app_bin_dir();
    let candidate = bin_dir.join(&full_name);
    if candidate.exists() {
        return Some(candidate);
    }

    // 2. Check next to executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let candidate = parent.join(&full_name);
            if candidate.exists() {
                return Some(candidate);
            }
            let sub_bin = parent.join("bin").join(&full_name);
            if sub_bin.exists() {
                return Some(sub_bin);
            }
        }
    }

    // 3. Check in system PATH with full absolute path resolution
    #[cfg(target_os = "windows")]
    {
        let mut where_cmd = Command::new("where.exe");
        where_cmd.creation_flags(CREATE_NO_WINDOW);
        where_cmd.arg(binary_name);
        if let Ok(out) = where_cmd.output() {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        let pb = PathBuf::from(trimmed);
                        if pb.exists() {
                            return Some(pb);
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut which_cmd = Command::new("which");
        which_cmd.arg(binary_name);
        if let Ok(out) = which_cmd.output() {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if let Some(first_line) = stdout.lines().next() {
                    let pb = PathBuf::from(first_line.trim());
                    if pb.exists() {
                        return Some(pb);
                    }
                }
            }
        }
    }

    // Fallback: test execution with --version
    let mut cmd = Command::new(binary_name);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.arg("--version");
    if cmd.output().is_ok() {
        return Some(PathBuf::from(binary_name));
    }

    None
}

pub fn find_js_runtime() -> Option<(String, PathBuf)> {
    // 1. Check Node.js
    if let Some(p) = find_binary("node") {
        return Some(("node".to_string(), p));
    }
    #[cfg(target_os = "windows")]
    {
        let standard_paths = [
            PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
            PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
        ];
        for sp in standard_paths {
            if sp.exists() {
                return Some(("node".to_string(), sp));
            }
        }
        if let Some(local_app) = dirs::data_local_dir() {
            let p = local_app.join("Programs").join("node").join("node.exe");
            if p.exists() {
                return Some(("node".to_string(), p));
            }
        }
    }

    // 2. Check Bun
    if let Some(p) = find_binary("bun") {
        return Some(("bun".to_string(), p));
    }
    if let Some(home) = dirs::home_dir() {
        let bun_p = home.join(".bun").join("bin").join(if cfg!(windows) { "bun.exe" } else { "bun" });
        if bun_p.exists() {
            return Some(("bun".to_string(), bun_p));
        }
    }

    // 3. Check Deno
    if let Some(p) = find_binary("deno") {
        return Some(("deno".to_string(), p));
    }
    if let Some(home) = dirs::home_dir() {
        let deno_p = home.join(".deno").join("bin").join(if cfg!(windows) { "deno.exe" } else { "deno" });
        if deno_p.exists() {
            return Some(("deno".to_string(), deno_p));
        }
    }

    None
}

pub fn check_binaries() -> BinariesStatus {
    let bin_dir = get_app_bin_dir();
    let ytdlp_path = find_binary("yt-dlp");
    let ffmpeg_path = find_binary("ffmpeg");

    let (ytdlp_installed, ytdlp_version) = match &ytdlp_path {
        Some(path) => {
            let mut cmd = Command::new(path);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.arg("--version");
            if let Ok(out) = cmd.output() {
                if out.status.success() {
                    (true, String::from_utf8_lossy(&out.stdout).trim().to_string())
                } else {
                    (false, String::new())
                }
            } else {
                (false, String::new())
            }
        }
        None => (false, String::new()),
    };

    let (ffmpeg_installed, ffmpeg_version) = match &ffmpeg_path {
        Some(path) => {
            let mut cmd = Command::new(path);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.arg("-version");
            if let Ok(out) = cmd.output() {
                if out.status.success() {
                    let version_line = String::from_utf8_lossy(&out.stdout)
                        .lines()
                        .next()
                        .unwrap_or("")
                        .to_string();
                    (true, version_line)
                } else {
                    (false, String::new())
                }
            } else {
                (false, String::new())
            }
        }
        None => (false, String::new()),
    };

    BinariesStatus {
        ytdlp_installed,
        ytdlp_version,
        ytdlp_path: ytdlp_path.map(|p| p.to_string_lossy().to_string()),
        ffmpeg_installed,
        ffmpeg_version,
        ffmpeg_path: ffmpeg_path.map(|p| p.to_string_lossy().to_string()),
        bin_dir: bin_dir.to_string_lossy().to_string(),
    }
}

pub async fn download_binary_file(
    app: &AppHandle,
    binary_type: &str,
) -> Result<String, String> {
    let bin_dir = get_app_bin_dir();
    let _ = fs::create_dir_all(&bin_dir);

    let (url, target_filename) = if binary_type == "ytdlp" {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
            "yt-dlp.exe",
        )
    } else if binary_type == "ffmpeg" {
        // Essential static ffmpeg executable download URL for Windows
        (
            "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip",
            "ffmpeg.zip",
        )
    } else {
        return Err("Unknown binary type".to_string());
    };

    let target_path = bin_dir.join(target_filename);

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to GitHub releases: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with HTTP status {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;

    let mut file = fs::File::create(&target_path)
        .map_err(|e| format!("Failed to create file {:?}: {}", target_path, e))?;

    use std::io::Write;
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Error during streaming: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write chunk: {}", e))?;

        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let percent = (downloaded as f64 / total_size as f64) * 100.0;
            let _ = app.emit(
                "binary-download-progress",
                serde_json::json!({
                    "binaryType": binary_type,
                    "percent": percent
                }),
            );
        }
    }

    // If ffmpeg was downloaded as a zip archive, extract ffmpeg.exe and ffprobe.exe
    if binary_type == "ffmpeg" {
        let zip_file = fs::File::open(&target_path)
            .map_err(|e| format!("Failed to open downloaded ffmpeg zip: {}", e))?;
        let mut archive = zip::ZipArchive::new(zip_file)
            .map_err(|e| format!("Failed to read ffmpeg zip archive: {}", e))?;

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)
                .map_err(|e| format!("Failed to read file from zip: {}", e))?;
            let name = entry.name().to_lowercase();
            if name.ends_with("ffmpeg.exe") {
                let mut out = fs::File::create(bin_dir.join("ffmpeg.exe"))
                    .map_err(|e| format!("Failed to extract ffmpeg.exe: {}", e))?;
                std::io::copy(&mut entry, &mut out)
                    .map_err(|e| format!("Failed to write ffmpeg.exe: {}", e))?;
            } else if name.ends_with("ffprobe.exe") {
                let mut out = fs::File::create(bin_dir.join("ffprobe.exe"))
                    .map_err(|e| format!("Failed to extract ffprobe.exe: {}", e))?;
                std::io::copy(&mut entry, &mut out)
                    .map_err(|e| format!("Failed to write ffprobe.exe: {}", e))?;
            }
        }
        // Clean up temporary zip file
        let _ = fs::remove_file(&target_path);
    }

    Ok(target_path.to_string_lossy().to_string())
}

pub async fn update_ytdlp(app: &AppHandle) -> Result<String, String> {
    // 1. Try native yt-dlp -U if already installed
    if let Some(ytdlp_path) = find_binary("yt-dlp") {
        let mut cmd = Command::new(&ytdlp_path);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.arg("-U");

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let msg = if !stdout.is_empty() {
                    stdout
                } else {
                    "yt-dlp updated successfully".to_string()
                };
                return Ok(msg);
            }
        }
    }

    // 2. Fallback: Download latest prebuilt binary directly into bin/
    download_binary_file(app, "ytdlp").await?;
    let status = check_binaries();
    Ok(format!("yt-dlp updated to {}", status.ytdlp_version))
}
