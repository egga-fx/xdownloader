# CODING_PREF.md — xDownloader Coding Standards & Preferences

Dokumen ini memuat standar penulisan kode (*coding conventions*), arsitektur layer, pola error handling, pengelolaan proses native, database conventions, dan pedoman verifikasi yang berlaku di seluruh codebase **xDownloader**.

---

## 🏛️ Codebase Organization & Layering

```mermaid
graph TD
    subgraph Frontend["Frontend Layer (src/)"]
        APP["src/App.tsx (Root Canvas & State Orchestrator)"]
        COMPONENTS["src/components/ (Modals, Cards, Drawer, Inputs)"]
        TAURI_API["src/lib/tauri-api.ts (IPC Wrapper & Web Preview Simulation)"]
        UTILS["src/lib/utils.ts (Formatters, Platform Detector, cn)"]
        TYPES["src/types.ts (TypeScript Interfaces & Types)"]
    end

    subgraph Backend["Tauri Native Backend (src-tauri/src/)"]
        LIB["lib.rs (AppState, Tauri Builder, Command Registration)"]
        MODELS["models.rs (Serde Data Models with CamelCase Parity)"]
        DOWNLOADER["downloader.rs (yt-dlp Runner, FFmpeg Split/Trim, ProcessManager)"]
        BINARIES["binaries.rs (Binary Discovery, GitHub Auto-Download, Updater)"]
        DB["db.rs (rusqlite SQLite Embedded Database with WAL Mode)"]
        METADATA["metadata.rs (Fast yt-dlp JSON Dump with 20s Timeout)"]
        IMAGE["image_extractor.rs (Direct Visual Scraper for IG, X, Pinterest, TikTok)"]
    end

    COMPONENTS --> APP
    APP --> TAURI_API
    TAURI_API -->|Tauri IPC invoke() & emit()| LIB
    LIB --> MODELS
    LIB --> DOWNLOADER
    LIB --> BINARIES
    LIB --> DB
    LIB --> METADATA
    LIB --> IMAGE
```

### Struktur Folder Utama
```text
xdownloader/
├── src/                      # Frontend Studio (Vite + React 19 + TypeScript)
│   ├── components/           # Reusable Studio UI Components
│   │   ├── AboutModal.tsx            # App information & update dialog
│   │   ├── BinarySetupModal.tsx      # One-click yt-dlp & ffmpeg setup
│   │   ├── DeleteConfirmDialog.tsx   # Safe delete confirmation
│   │   ├── Header.tsx                # Studio top bar & status dots
│   │   ├── MediaPreviewModal.tsx     # In-app media player
│   │   ├── MediaVaultDrawer.tsx      # Slide-over local media vault
│   │   ├── MetadataPreviewCard.tsx   # Live thumbnail & time range selector
│   │   ├── SettingsModal.tsx         # Preferences & engine updater
│   │   ├── UrlInputSection.tsx       # Smart clipboard, URL input & action dock
│   │   ├── VaultHistoryGrid.tsx      # Visual card grid view
│   │   ├── VaultHistoryTable.tsx     # Compact data table view
│   │   ├── VideoSplitterModal.tsx    # Multi-segment video splitter
│   │   └── VideoTrimmerModal.tsx     # Exact frame video trimmer
│   ├── lib/                  # Utilities, Icons, & IPC Bridge
│   │   ├── icons.tsx                 # Custom SVG platform & format icons
│   │   ├── tauri-api.ts              # Typed Tauri IPC client & mock simulation
│   │   └── utils.ts                  # cn, platform detect, formatters
│   ├── App.tsx               # Main application controller
│   ├── index.css             # TailwindCSS v4 imports & Masagi Zinc theme
│   ├── main.tsx              # React DOM entry point
│   └── types.ts              # Frontend TypeScript interfaces
├── src-tauri/                # Backend Core (Rust 2021 + Tauri v2)
│   ├── src/
│   │   ├── binaries.rs               # Binary locator & auto-installer
│   │   ├── db.rs                     # SQLite repository (rusqlite)
│   │   ├── downloader.rs             # yt-dlp & FFmpeg execution engine
│   │   ├── image_extractor.rs        # Custom multi-platform image scraper
│   │   ├── lib.rs                    # Tauri commands & AppState
│   │   ├── main.rs                   # Desktop binary entry point
│   │   ├── metadata.rs               # Fast yt-dlp metadata probe
│   │   └── models.rs                 # Rust Serde structs
│   ├── Cargo.toml            # Rust dependencies & crate config
│   └── tauri.conf.json       # Tauri v2 window & plugin configuration
├── package.json              # Frontend scripts & NPM dependencies
├── tsconfig.json             # Strict TypeScript configuration
└── vite.config.ts            # Vite 6 configuration (@tailwindcss/vite)
```

---

## 🎯 TypeScript & Language Standards

1. **Strict Type Safety**:
   - `tsconfig.json` dikonfigurasi dengan `"strict": true`, `"noUnusedLocals": true`, dan `"noUnusedParameters": true`.
   - **Dilarang menggunakan `any`**. Jika tipe data dari luar belum dipastikan, gunakan `unknown` dengan type guards atau schema assertion.
2. **Type Parity antara Rust dan TypeScript**:
   - Setiap struct di `src-tauri/src/models.rs` dengan `#[serde(rename_all = "camelCase")]` **WAJIB** memiliki pasangan tipe interface 1:1 di `src/types.ts`.
   - Contoh:
     ```rust
     // Rust (models.rs)
     #[derive(Debug, Clone, Serialize, Deserialize)]
     #[serde(rename_all = "camelCase")]
     pub struct DownloadRecord {
         pub id: String,
         pub platform: String,
         pub url: String,
         pub duration_sec: i64,
         pub file_size_bytes: i64,
     }
     ```
     ```typescript
     // TypeScript (types.ts)
     export interface DownloadRecord {
       id: string;
       platform: DownloaderPlatform;
       url: string;
       durationSec: number;
       fileSizeBytes: number;
     }
     ```

---

## 🛡️ Tauri IPC Command Conventions

1. **Typed Tauri Invocations**:
   - Semua pemanggilan `invoke` dari `@tauri-apps/api/core` wajib dibungkus dalam fungsi typed di `src/lib/tauri-api.ts` dengan menyertakan generic type:
     ```typescript
     // Benar:
     export async function getDownloadRecords(): Promise<DownloadRecord[]> {
       return await invoke<DownloadRecord[]>("get_download_records");
     }
     
     // Salah (Untyped):
     const records = await invoke("get_download_records");
     ```
2. **Web Preview Resilience**:
   - Setiap fungsi di `src/lib/tauri-api.ts` wajib memeriksa `isTauriEnvironment()`. Jika aplikasi berjalan di browser web, sediakan fallback mock simulation agar tim frontend dapat melakukan preview dan styling tanpa menjalankan proses Tauri desktop.
3. **Rust Command Error Contract**:
   - Semua `#[tauri::command]` di Rust wajib mengembalikan `Result<T, String>` untuk operasi yang dapat gagal (I/O, database, network):
     ```rust
     #[tauri::command]
     async fn get_video_metadata(url: String) -> Result<VideoInfo, String> {
         metadata::fetch_video_metadata(&url).await
     }
     ```

---

## ⚡ Native Process Safety & ProcessManager

1. **Anti-Zombie Process Protocol**:
   - Setiap child process (`yt-dlp`, `ffmpeg`) yang dieksekusi secara asinkron wajib didaftarkan ke `ProcessManager` bersama task ID uniknya:
     ```rust
     if let Some(child_id) = child.id() {
         process_mgr.register(task_id.clone(), child_id);
     }
     ```
   - Saat proses selesai atau dibatalkan, PID wajib dihapus (`process_mgr.remove(&task_id)`).
2. **Safe Argument Vector Passing**:
   - **Dilarang keras** menggabungkan parameter pengguna ke dalam shell string mentah (`cmd /c "yt-dlp " + url`).
   - Gunakan selalu vector argument `.arg()` atau `.args([...])` pada `Command::new()` untuk mencegah *Command Injection Vulnerability*:
     ```rust
     cmd.arg("--dump-json")
        .arg("--no-playlist")
        .arg(url);
     ```
3. **Headless Windows Flag**:
   - Seluruh subprocess pada Windows wajib menggunakan flag `CREATE_NO_WINDOW`:
     ```rust
     #[cfg(target_os = "windows")]
     use std::os::windows::process::CommandExt;
     const CREATE_NO_WINDOW: u32 = 0x08000000;
     
     cmd.creation_flags(CREATE_NO_WINDOW);
     ```

---

## 🗄️ Database Access Conventions (`rusqlite`)

1. **Prepared Statements**:
   - Selalu gunakan prepared statements untuk seluruh query data:
     ```rust
     let mut stmt = conn.prepare("SELECT id, platform, url FROM downloads WHERE id = ?1")?;
     ```
2. **WAL Journaling**:
   - Database diinisialisasi dengan mode WAL (*Write-Ahead Logging*) untuk mendukung concurrency tinggi tanpa database locks:
     ```rust
     conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
     ```
3. **Thread Safety**:
   - Akses SQLite di Rust dilindungi dengan `Arc<Database>` dan `Mutex<Connection>` untuk mencegah race condition lintas tokio background tasks.

---

## 🧪 Testing & Verification Matrix

| Scope | Perintah | Kriteria Kelulusan |
| :--- | :--- | :--- |
| **Frontend Type Checking** | `bun x tsc --noEmit` | 0 error TypeScript |
| **Frontend Production Build**| `bun run build` | Sukses menghasilkan bundle `dist/` |
| **Backend Rust Syntax** | `cargo check` (di `src-tauri`) | 0 warning kritis & 0 error kompilasi |
| **Backend Rust Unit Tests** | `cargo test --lib` (di `src-tauri`)| Seluruh test extractor & unit test lolos |
| **Desktop Development Run** | `bun run tauri:dev` | Desktop window berjalan tanpa runtime panic |

---

## 📌 Change Checklist Before Completion

- [ ] Kode TypeScript bebas dari `any` dan lolos `bun x tsc --noEmit`.
- [ ] Setiap perubahan model di `models.rs` telah disinkronkan ke `types.ts`.
- [ ] Subprocess `yt-dlp` atau `ffmpeg` baru telah didaftarkan ke `ProcessManager`.
- [ ] Pemanggilan CLI binary menggunakan safe `.arg()` vector, bukan raw shell string.
- [ ] Komponen UI baru menggunakan TailwindCSS v4 utility classes dengan helper `cn(...)`.
- [ ] Event listener Tauri (`listen()`) memiliki fungsi cleanup `unlisten()` di React `useEffect`.
- [ ] Backend Rust lolos verifikasi `cargo check` dan `cargo test --lib`.
- [ ] Frontend berhasil di-build dengan `bun run build`.

---

*xDownloader Coding Preferences Reference v1.0.0 — Updated 2026-09-17*
