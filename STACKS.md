# STACKS.md — xDownloader Technical Stack & Architecture

Dokumen ini mendefinisikan seluruh lapisan teknologi, dependensi eksternal, runtime, dan arsitektur eksekusi yang digunakan dalam **xDownloader**.

---

## 🏛️ System Topology & Architectural Overview

```mermaid
graph TD
    subgraph DesktopShell["Desktop Shell (Tauri v2 Core - Rust 2021)"]
        NATIVE_WIN["Native OS Window (Windows 10/11 x64)"]
        PLUGINS["Tauri Plugins\n(Opener, Dialog, Clipboard, Updater, Process)"]
    end

    subgraph FrontendLayer["Frontend Studio Layer (Vite 6 + React 19)"]
        REACT["React 19 + Strict TypeScript 5.7"]
        STYLING["TailwindCSS v4 (@tailwindcss/vite)\nMasagi Zinc Dark Theme"]
        ICONS["Lucide React + Custom Platform SVGs"]
        COMPONENTS["Modular UI Components\n(UrlInput, MetadataCard, VaultDrawer, Modals)"]
        IPC_CLIENT["Tauri IPC Client & Web Preview Fallback\n(src/lib/tauri-api.ts)"]
    end

    subgraph BackendRustLayer["Backend Engine Layer (src-tauri)"]
        COMMANDS["Tauri IPC Commands (15 #[tauri::command] handlers)"]
        STATE["AppState (Arc<Database> + Arc<ProcessManager>)"]
        TOKIO["Tokio Async Runtime (Background tasks & stream readers)"]
    end

    subgraph LocalStorageLayer["Local Persistence Layer"]
        RUSQLITE[("SQLite via rusqlite (WAL Mode)\nvault.db (AppData / Portable ./data/)")]
        SETTINGS["App Settings Key-Value Store"]
    end

    subgraph NativeMediaLayer["Managed Media Binaries & CLI Engine"]
        YTDLP["yt-dlp (Stream Downloader & Metadata JSON Dump)"]
        FFMPEG["FFmpeg (Exact Video Trimming & Multi-Segment Splitting)"]
        FFPROBE["FFprobe (Format & Codec Validation)"]
        IMAGE_EXT["Native Image Extractor\n(Pinterest, Instagram, X, TikTok via reqwest)"]
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
| **Async Runtime** | **Tokio** | `^1.0` (Full) | Menjalankan download, stdout streaming, dan proses FFmpeg di background thread non-blocking. |
| **Database Driver** | **rusqlite** | `0.32` (bundled) | Driver SQLite embedded tanpa dependensi C eksternal; journaling WAL mode aktif. |
| **HTTP Client** | **reqwest** | `0.12` | Pengunduhan binary otomatis (`yt-dlp`/`ffmpeg`), stream probing, dan ekstraksi gambar. |
| **Process Management** | **ProcessManager** | Internal | Tracking PID subprocess (`yt-dlp`, `ffmpeg`) dengan pembatalan instan (`taskkill /F /T /PID`). |
| **System Plugins** | Tauri Official Plugins | `^2.0` | `opener`, `dialog`, `clipboard-manager`, `updater`, `process`. |

---

### 2. Frontend Studio Layer (TypeScript & React)
| Komponen | Teknologi | Versi | Peran & Keterangan |
| :--- | :--- | :--- | :--- |
| **Bundler / Tooling**| **Vite** | `^6.1.0` | Dev server berkecepatan tinggi (:1420) dan bundler produksi berbasis Rollup/ESBuild. |
| **UI Framework** | **React** | `^19.0.0` | Render engine antarmuka studio modern. |
| **Type System** | **TypeScript** | `^5.7.3` | Strict type checking (`"strict": true`), zero `any`. |
| **CSS & Utility** | **TailwindCSS v4** | `^4.0.9` | Styling utility performa tinggi dengan engine `@tailwindcss/vite` & CSS variables native. |
| **Class Merging** | **clsx** + **tailwind-merge** | `^2.1` / `^3.0` | Helper `cn(...)` untuk conditional class composition yang aman tanpa konflik style. |
| **Iconography** | **Lucide React** | `^1.16.0` | Ikon antarmuka universal, ditambah custom platform icons (`src/lib/icons.tsx`). |
| **IPC Bridge** | `@tauri-apps/api` | `^2.2.0` | Komunikasi typed IPC (`invoke`, `listen`, `convertFileSrc`) dengan graceful Web Preview fallback. |

---

### 3. Media Processing & Extraction Engine
| Komponen | Sumber / Binary | Detail Implementasi |
| :--- | :--- | :--- |
| **yt-dlp** | Managed Binary (`yt-dlp.exe`) | Ekstraksi metadata JSON (`--dump-json`), pengunduhan stream video (YouTube, TikTok, Instagram, X/Twitter, Pinterest), pemilihan resolusi (4K hingga 360p), konversi audio (MP3, M4A, WAV, FLAC), dan download subtitel (SRT, VTT). |
| **FFmpeg** | Managed Binary (`ffmpeg.exe`) | Pemotongan frame presisi (*exact trimming* via `-ss` / `-to`), pemecahan video (*multi-part splitting*), remuxing audio-video, dan ekstraksi thumbnail. |
| **FFprobe** | Managed Binary (`ffprobe.exe`) | Pengecekan durasi media, format container, dan stream codec. |
| **Image Extractor**| Native Rust Module | Ekstraktor visual kustom untuk gambar resolusi penuh dari Pinterest (`i.pinimg.com`), Instagram, X (Twitter), dan TikTok photo slide. |

---

### 4. Storage & Persistence Architecture
- **Engine**: SQLite 3 (dikompilasi langsung via `rusqlite` bundled).
- **Journal Mode**: `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`.
- **Database Resolution Hierarchy**:
  1. **Portable Mode**: Jika folder `./data/` atau file `./data/vault.db` tersedia di samping executable atau direktori kerja aktif, database menggunakan path lokal tersebut.
  2. **Standard Mode**: Direktori standar sistem operasi `%APPDATA%/xdownloader/vault.db` (Windows) atau `~/.config/xdownloader/vault.db` (Linux/macOS).
- **Tabel Utama**:
  - `downloads`: Menyimpan riwayat unduhan, thumbnail, path lokal, format, ukuran file, status, error, dan rentang pemotongan waktu (`time_range`).
  - `settings`: Key-value store untuk konfigurasi aplikasi (folder output default, resolusi default, auto clipboard detection, check updates).

---

### 5. Binaries Discovery & Auto-Setup
xDownloader mencari binary eksternal dengan urutan prioritas:
1. **App Binary Directory**: `./bin/` (lokal di samping executable) atau `%APPDATA%/xdownloader/bin/`.
2. **Beside Executable**: Folder yang sama dengan binary `xdownloader.exe`.
3. **System PATH**: Direktori global sistem melalui pencarian `PATH`.

Jika binary belum terpasang, sistem menyediakan **One-Click Auto Setup** yang mengunduh rilis resmi langsung dari GitHub Releases secara aman dan terverifikasi.

---

## ⚙️ Build & Development Commands Reference

| Perintah | Toolchain | Fungsi |
| :--- | :--- | :--- |
| `bun run dev` | Vite | Menjalankan frontend Web Preview pada `http://localhost:1420` |
| `bun run build` | TypeScript + Vite | Validasi tipe (`tsc`) dan build bundle produksi ke folder `dist/` |
| `bun run tauri:dev` | Tauri CLI + Cargo | Menjalankan aplikasi desktop native xDownloader dalam mode debug |
| `bun run tauri:build` | Tauri CLI + Cargo | Mengompilasi installer produksi Windows (`.exe` NSIS installer) |
| `cargo check` (di `src-tauri`) | Rust Cargo | Pemeriksaan sintaks dan validasi tipe Rust backend |
| `cargo test --lib` (di `src-tauri`) | Rust Cargo | Menjalankan seluruh unit test suite backend Rust |

---

*xDownloader Stacks Reference v1.0.0 — Updated 2026-09-17*
