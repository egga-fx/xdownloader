# STACKS.md — xDownloader Technical Stack & Architecture

Dokumen ini mendefinisikan seluruh lapisan teknologi, dependensi eksternal, runtime, dan arsitektur eksekusi yang digunakan dalam **xDownloader**.

---

## 🏛️ System Topology & Architectural Overview

```mermaid
graph TD
    subgraph DesktopShell["Desktop Shell (Tauri v2 Core - Rust 2021)"]
        NATIVE_WIN["Native OS Window (Windows 10/11 x64)"]
        PLUGINS["Tauri Plugins\n(Opener, Dialog, Clipboard, Notification, Updater, Process)"]
    end

    subgraph FrontendLayer["Frontend Studio Layer (Vite 6 + React 19)"]
        REACT["React 19 + Strict TypeScript 5.7"]
        STYLING["TailwindCSS v4 (@tailwindcss/vite)\nMasagi Zinc Dark Theme"]
        ICONS["Lucide React + Custom Platform SVGs"]
        COMPONENTS["Modular UI Components\n(UrlInput, MetadataCard, VaultDrawer, Transcriber, Modals)"]
        IPC_CLIENT["Tauri IPC Client & Web Preview Fallback\n(src/lib/tauri-api.ts)"]
        NOTIF_BRIDGE["Native OS Notification Bridge\n(src/lib/notifications.ts)"]
    end

    subgraph BackendRustLayer["Backend Engine Layer (src-tauri)"]
        COMMANDS["Tauri IPC Commands (27 #[tauri::command] handlers)"]
        STATE["AppState (Arc<Database> + Arc<ProcessManager> + Arc<TranscriptionManager>)"]
        TOKIO["Tokio Async Runtime (Background tasks & stream readers)"]
        LOGGER["Structured Disk Logger Subsystem (src-tauri/src/logger.rs)"]
    end

    subgraph LocalStorageLayer["Local Persistence Layer"]
        RUSQLITE[("SQLite via rusqlite (WAL Mode)\nvault.db (AppData / Portable ./data/)")]
        SETTINGS["App Settings & Secrets Store (SQLite key-value)"]
        LOGS_DB["Task Logs Repository (task_logs table)"]
    end

    subgraph NativeMediaLayer["Managed Media Binaries & CLI Engine"]
        YTDLP["yt-dlp (Stream Downloader & Metadata JSON Dump)"]
        FFMPEG["FFmpeg (Audio Extraction & Stream Remuxing)"]
        IMAGE_EXT["Native Visual Scraper\n(Threads, Instagram, TikTok, Pinterest, X via reqwest)"]
        TRANSCRIBE_API["ElevenLabs Scribe v2 STT Engine\n(Chunked Audio Ingestion & Diarization)"]
    end

    DesktopShell --> FrontendLayer
    FrontendLayer -->|Tauri IPC invoke() & emit()| BackendRustLayer
    BackendRustLayer --> LocalStorageLayer
    BackendRustLayer --> NativeMediaLayer
```

---

## 📦 Detailed Stack Breakdown

### 1. Desktop Shell & Native Backend (Rust)
| Komponen | Teknologi | Versi | Peran & Keterangan |
| :--- | :--- | :--- | :--- |
| **Desktop Framework** | **Tauri v2** | `^2.0` | Menyediakan wrapper desktop native Windows berbobot ringan, tray icon, dan binding OS. |
| **Language** | **Rust** | `2021 Edition` | Memory-safe, zero-cost abstractions, zero runtime crash. |
| **Async Runtime** | **Tokio** | `^1.0` (Full) | Menjalankan download, stdout streaming, dan proses transcoding di background thread non-blocking. |
| **Database Driver** | **rusqlite** | `0.32` (bundled) | Driver SQLite embedded tanpa dependensi C eksternal; journaling WAL mode aktif. |
| **HTTP Client** | **reqwest** | `0.12` | Pengunduhan binary otomatis (`yt-dlp`/`ffmpeg`), stream probing, ekstraksi visual, dan ElevenLabs API client. |
| **Process Management**| **ProcessManager** | Internal | Tracking PID subprocess (`yt-dlp`, `ffmpeg`) dengan pembatalan instan (`taskkill /F /T /PID`) dan pause aman. |
| **AI Transcription** | **ElevenLabs Scribe v2** | Cloud REST | Speech-to-text akurasi tinggi dengan speaker diarization, word timings, dan ekspor subtitle (SRT, VTT, TXT). |
| **System Plugins** | Tauri Official Plugins | `^2.0` | `opener`, `dialog`, `clipboard-manager`, `notification`, `updater`, `process`. |

---

## 2. Frontend Studio Layer (TypeScript & React)
| Komponen | Teknologi | Versi | Peran & Keterangan |
| :--- | :--- | :--- | :--- |
| **Bundler / Tooling**| **Vite** | `^6.1.0` | Dev server berkecepatan tinggi (:1420) dan bundler produksi berbasis Rollup/ESBuild. |
| **UI Framework** | **React** | `^19.0.0` | Render engine antarmuka studio modern berbasis concurrent features. |
| **Type System** | **TypeScript** | `^5.7.3` | Strict type checking (`"strict": true`), zero `any`. |
| **CSS & Utility** | **TailwindCSS v4** | `^4.0.9` | Styling utility performa tinggi dengan engine `@tailwindcss/vite` & CSS variables native. |
| **Class Merging** | **clsx** + **tailwind-merge** | `^2.1` / `^3.0` | Helper `cn(...)` untuk conditional class composition yang aman tanpa konflik style. |
| **Iconography** | **Lucide React** | `^1.16.0` | Ikon antarmuka universal, ditambah custom platform icons (`src/lib/icons.tsx`). |
| **IPC Bridge** | `@tauri-apps/api` | `^2.2.0` | Komunikasi typed IPC (`invoke`, `listen`, `convertFileSrc`) dengan graceful Web Preview fallback. |
| **Markdown Engine** | **MarkdownRenderer** | Zero-Dep | Renderer kustom mandiri untuk changelog update dan catatan rilis tanpa library eksternal. |

---

## 3. Media Processing & Extraction Engine
| Komponen | Sumber / Binary | Detail Implementasi |
| :--- | :--- | :--- |
| **yt-dlp** | Managed Binary (`yt-dlp.exe`) | Ekstraksi metadata JSON (`--dump-json`), pengunduhan stream video (YouTube, TikTok, Instagram, X/Twitter, Pinterest), pemilihan resolusi (4K hingga 360p), konversi audio (MP3, M4A, WAV, FLAC), dan download subtitel (SRT, VTT). Template format dilindungi dengan escaping `%%`. |
| **FFmpeg** | Managed Binary (`ffmpeg.exe`) | Ekstraksi stream audio untuk AI transcription, remuxing audio-video, konversi container, dan thumbnail generation. |
| **Image & Carousel Extractor**| Native Rust Module (`image_extractor.rs`) | Ekstraktor visual kustom untuk multi-gambar dan multi-video dari Meta Threads, Instagram Carousel, Pinterest, TikTok photo slide, dan X (Twitter). |
| **AI Speech-to-Text** | `transcriber.rs` | Orkestrator konversi audio ke teks via ElevenLabs Scribe v2. Dilengkapi audio event tagging, custom max characters per line, dan timestamp alignment. |

---

## 4. Storage & Persistence Architecture
- **Engine**: SQLite 3 (dikompilasi langsung via `rusqlite` bundled).
- **Journal Mode**: `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`.
- **Database Resolution Hierarchy**:
  1. **Portable Mode**: Jika folder `./data/` atau file `./data/vault.db` tersedia di samping executable atau direktori kerja aktif, database menggunakan path lokal tersebut.
  2. **Standard Mode**: Direktori standar sistem operasi `%APPDATA%/xdownloader/vault.db` (Windows) atau `~/.config/xdownloader/vault.db` (Linux/macOS).
- **Tabel Utama**:
  - `downloads`: Menyimpan riwayat unduhan, thumbnail, path lokal, format, ukuran file, status, error, dan rentang pemotongan waktu (`time_range`).
  - `settings`: Key-value store untuk konfigurasi aplikasi (output folder, format penamaan file, konkurensi unduhan, auto clipboard detection).
  - `task_logs`: Penyimpanan riwayat log event per task ID untuk debugging dan audit performa.
- **Auto-Reconciliation**:
  - Task yang terputus mendadak karena shutdown sistem otomatis dialihkan dari status `downloading` ke `paused` dengan catatan `"Interrupted on previous session"`.

---

## 5. Binaries Discovery & Auto-Setup
xDownloader mencari binary eksternal dengan urutan prioritas:
1. **App Binary Directory**: `./bin/` (lokal di samping executable) atau `%APPDATA%/xdownloader/bin/`.
2. **Beside Executable**: Folder yang sama dengan binary `xdownloader.exe`.
3. **System PATH**: Direktori global sistem melalui pencarian `PATH`.

Jika binary belum terpasang, sistem menyediakan **One-Click Auto Setup** yang mengunduh rilis resmi langsung dari GitHub Releases secara aman serta tombol **Update Engine** (`yt-dlp -U`) di Settings.

---

## ⚙️ Build & Development Commands Reference

| Perintah | Toolchain | Fungsi |
| :--- | :--- | :--- |
| `bun test` | Vitest / Bun | Menjalankan seluruh test suite unit frontend (`tests/`) |
| `bun run dev` | Vite | Menjalankan frontend Web Preview pada `http://localhost:1420` |
| `bun run build` | TypeScript + Vite | Validasi tipe (`tsc`) dan build bundle produksi ke folder `dist/` |
| `bun run tauri:dev` | Tauri CLI + Cargo | Menjalankan aplikasi desktop native xDownloader dalam mode debug |
| `bun run tauri:build` | Tauri CLI + Cargo | Mengompilasi installer produksi Windows (`.exe` NSIS installer) |
| `cargo check` (di `src-tauri`) | Rust Cargo | Pemeriksaan sintaks dan validasi tipe Rust backend |
| `cargo test --lib` (di `src-tauri`) | Rust Cargo | Menjalankan seluruh unit test suite backend Rust |

---

*xDownloader Stacks Reference v1.2.3 — Updated 2026-10-24*
