# CODING_PREF.md — xDownloader Coding Standards & Preferences

Dokumen ini memuat standar penulisan kode (*coding conventions*), arsitektur layer, pola error handling, pengelolaan proses native, database conventions, keamanan secret, dan pedoman verifikasi yang berlaku di seluruh codebase **xDownloader**.

---

## 🏛️ Codebase Organization & Layering

```mermaid
graph TD
    subgraph Frontend["Frontend Studio Layer (src/)"]
        APP["src/App.tsx (Root Canvas, Tab Router, Queue & Concurrent Scheduler)"]
        COMPONENTS["src/components/ (Modals, Cards, Drawer, Inputs, Transcriber, Logs)"]
        TAURI_API["src/lib/tauri-api.ts (Typed IPC Wrapper & Web Preview Simulation)"]
        NOTIFS["src/lib/notifications.ts (Native Desktop Notification Helpers)"]
        UTILS["src/lib/utils.ts (Formatters, Filename Sanitizer, Platform Detector, cn)"]
        TYPES["src/types.ts (TypeScript Interfaces & Strict Types)"]
    end

    subgraph Backend["Tauri Native Backend (src-tauri/src/)"]
        LIB["lib.rs (AppState, Tauri Builder, 27 Command Registrations)"]
        MODELS["models.rs (Serde Data Models with CamelCase Parity)"]
        DOWNLOADER["downloader.rs (yt-dlp Runner, Resumable Engine, ProcessManager)"]
        TRANSCRIBER["transcriber.rs (ElevenLabs Scribe v2 STT, Diarization, SRT/VTT/TXT)"]
        BINARIES["binaries.rs (Binary Discovery, GitHub Auto-Download, yt-dlp -U)"]
        DB["db.rs (rusqlite SQLite Embedded Database with WAL Mode)"]
        METADATA["metadata.rs (Fast yt-dlp JSON Dump with 20s Timeout)"]
        IMAGE["image_extractor.rs (Scraper for Threads, IG, Pinterest, TikTok, X)"]
        LOGGER["logger.rs (Structured File Logging & Directory Resolver)"]
    end

    COMPONENTS --> APP
    APP --> TAURI_API
    APP --> NOTIFS
    TAURI_API -->|Tauri IPC invoke() & emit()| LIB
    LIB --> MODELS
    LIB --> DOWNLOADER
    LIB --> TRANSCRIBER
    LIB --> BINARIES
    LIB --> DB
    LIB --> METADATA
    LIB --> IMAGE
    LIB --> LOGGER
```

### Struktur Folder Utama
```text
xdownloader/
├── .agents/workflows/        # Proyek workflows (/fix, /diff-review, /ai-spec-first-audit, dll.)
├── src/                      # Frontend Studio (Vite 6 + React 19 + TypeScript)
│   ├── components/           # Reusable Studio UI Components
│   │   ├── AboutModal.tsx            # App information & engine status dialog
│   │   ├── ActiveTranscriptionBanner.tsx # Top bar persistent transcription progress
│   │   ├── BinarySetupModal.tsx      # One-click yt-dlp & ffmpeg setup dialog
│   │   ├── CarouselSelectionModal.tsx # Multi-item selector for carousels
│   │   ├── CarouselThumbnailStack.tsx # Visual stacked preview for multi-images
│   │   ├── DeleteConfirmDialog.tsx   # Safe delete confirmation dialog
│   │   ├── Header.tsx                # Studio top bar, stats & status dots
│   │   ├── LogViewerModal.tsx        # In-app real-time application log viewer
│   │   ├── MarkdownRenderer.tsx      # Zero-dependency release notes markdown renderer
│   │   ├── MediaPreviewModal.tsx     # In-app media player (audio/video/image)
│   │   ├── MediaVaultDrawer.tsx      # Slide-over local media vault
│   │   ├── MetadataPreviewCard.tsx   # Live thumbnail, time range, format selector
│   │   ├── SettingsModal.tsx         # User preferences, naming format, STT config
│   │   ├── TranscriptStudioModal.tsx # Interactive AI transcription player & editor
│   │   ├── UpdateModal.tsx           # In-app updater modal with changelog viewer
│   │   ├── UrlInputSection.tsx       # Smart clipboard, URL input & action dock
│   │   ├── VaultHistoryGrid.tsx      # Visual card grid view for vault
│   │   ├── VaultHistoryTable.tsx     # Compact data table view for vault
│   │   └── VaultItemActions.tsx      # Dropdown action menu for vault items
│   ├── lib/                  # Utilities, Icons, & IPC Bridge
│   │   ├── icons.tsx                 # Custom SVG platform & format icons
│   │   ├── notifications.ts          # Desktop OS notification bridge
│   │   ├── tauri-api.ts              # Typed Tauri IPC client & mock simulation
│   │   └── utils.ts                  # cn, platform detect, formatters, filename builder
│   ├── App.tsx               # Main application controller
│   ├── index.css             # TailwindCSS v4 imports & Masagi Zinc theme
│   ├── main.tsx              # React DOM entry point
│   └── types.ts              # Frontend TypeScript interfaces
├── src-tauri/                # Backend Core (Rust 2021 + Tauri v2)
│   ├── src/
│   │   ├── binaries.rs               # Binary locator & auto-installer
│   │   ├── db.rs                     # SQLite repository (rusqlite WAL mode)
│   │   ├── downloader.rs             # yt-dlp runner, pause/resume, ProcessManager
│   │   ├── image_extractor.rs        # Threads, IG, Pinterest, TikTok photo scraper
│   │   ├── lib.rs                    # Tauri commands & AppState dispatcher
│   │   ├── logger.rs                 # Structured disk logger subsystem
│   │   ├── main.rs                   # Desktop binary entry point
│   │   ├── metadata.rs               # Fast yt-dlp metadata probe
│   │   ├── models.rs                 # Rust Serde structs
│   │   └── transcriber.rs            # ElevenLabs Scribe v2 speech-to-text engine
│   ├── Cargo.toml            # Rust dependencies & crate config
│   └── tauri.conf.json       # Tauri v2 window, plugins & updater config
├── tests/                    # Vitest/Bun test suite
│   ├── notifications.test.ts # Notification helper unit tests
│   ├── tauri-api.test.ts     # Mock simulation & API wrapper tests
│   └── utils.test.ts         # Filename builder & formatter unit tests
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
   - Meliputi: `DownloadRecord`, `TaskProgress`, `ActiveDownloadTask`, `MediaItem`, `VideoInfo`, `BinariesStatus`, `AppSettings`, `AppUpdateInfo`, `LogEntry`, `TranscriptionConfig`, `TranscriptionProgress`, dan `TimeRange`.
3. **UI Language Rule**:
   - Seluruh teks UI, dialog, pesan toast, OS notifications, placeholder, dan label tombol **WAJIB menggunakan Bahasa Inggris**. Bahasa Indonesia hanya boleh ada di file markdown dokumentasi internal dan komentar kode (`//`).

---

## 🛡️ Tauri IPC Command Conventions

1. **Typed Invocations**:
   - Semua pemanggilan `invoke` dari `@tauri-apps/api/core` wajib dibungkus dalam fungsi typed di `src/lib/tauri-api.ts` dengan generic type parameter:
     ```typescript
     export async function getDownloadRecords(params?: {
       platform?: string;
       formatType?: string;
       search?: string;
     }): Promise<DownloadRecord[]> {
       return await invoke<DownloadRecord[]>("get_download_records", params || {});
     }
     ```
2. **Web Preview Resilience**:
   - Setiap fungsi di `src/lib/tauri-api.ts` wajib mempertahankan pengecekan `isTauriEnvironment()`. Jika aplikasi berjalan di browser web, sediakan fallback mock simulation agar tim frontend dapat melakukan preview, styling, dan visual testing tanpa backend desktop.
3. **Rust Command Error Contract**:
   - Semua `#[tauri::command]` di Rust wajib mengembalikan `Result<T, String>` untuk operasi yang dapat gagal (I/O, database, network, API eksternal).
4. **Secret Isolation (Zero API Key Leakage)**:
   - Secret seperti ElevenLabs API key tidak boleh dikirimkan balik ke frontend dalam model publik (`TranscriptionConfig`).
   - Frontend hanya menerima `keyStatus` (`missing` | `saved` | `invalid`) dan `apiKeyHint` tersamar (misal: `••••XYZ9`).

---

## ⚡ Native Process Safety & Resumable Downloads

1. **Anti-Zombie Process Management (`ProcessManager`)**:
   - Setiap subprocess (`yt-dlp`, `ffmpeg`) yang dieksekusi wajib didaftarkan ke `ProcessManager` bersama task ID unik, PID, direktori output, dan file stem.
   - Seluruh subprocess pada Windows wajib menggunakan flag `CREATE_NO_WINDOW` (`0x08000000`).
2. **Pause vs Cancel Semantics**:
   - **Pause (`pause_download`)**: Mematikan proses CLI aktif (`taskkill /F /T /PID`), menandai status task sebagai `paused`, tetapi **mempertahankan** file stream parsial (`.part`, `.ytdl`) untuk mendukung kelanjutan download (HTTP Range resumption).
   - **Cancel (`cancel_download`)**: Mematikan proses CLI aktif dan segera membersihkan file sementara yang belum tuntas via `cleanup_task_artifacts`.
   - **Critical B02 Protection**: Fungsi `cleanup_task_artifacts` dilarang keras menghapus file output utama yang telah selesai diunduh yang memiliki kesamaan stem nama.
3. **yt-dlp Output Template Escaping**:
   - Karakter `%` dalam judul atau template yt-dlp wajib di-escape menjadi `%%` (`escape_ytdlp_template`) untuk mencegah panic interpolasi format yt-dlp pada Windows.
4. **Safe Argument Vector Passing**:
   - **Dilarang keras** menggabungkan parameter pengguna ke dalam shell string mentah (`cmd /c "yt-dlp " + url`).
   - Gunakan selalu vector argument `.arg()` atau `.args([...])` pada `Command::new()`.

---

## 🗄️ Database Access Conventions (`rusqlite`)

1. **Prepared Statements & WAL Mode**:
   - Selalu gunakan prepared statements untuk seluruh query data guna mencegah SQL injection.
   - Database diinisialisasi dengan mode WAL (*Write-Ahead Logging*) dan `synchronous = NORMAL` untuk throughput tinggi tanpa database lock.
2. **Indexing**:
   - Tabel `downloads` memiliki indeks pada `created_at DESC` dan `status`.
   - Tabel `task_logs` memiliki indeks pada `task_id` untuk lookup instan di Log Viewer.
3. **Startup Reconciliation**:
   - Saat database dibuka pertama kali setelah restart, task berstatus `downloading` otomatis direkonsiliasi menjadi `paused` dengan keterangan `"Interrupted on previous session"` agar user dapat melanjutkan unduhan secara mandiri.
4. **Self-Healing Metadata**:
   - Query `get_download_records` otomatis memulihkan thumbnail lokal yang hilang (`generate_local_thumbnail`) dan menyesuaikan judul item jika nama file aktual di disk telah berubah.

---

## 📝 Filename Standardization Conventions

1. **Format Naming Options**:
   - `title_author` (Default): `$title-$author.$ext`
   - `author_title`: `$author-$title.$ext`
   - `title_only`: `$title.$ext`
2. **Author Deduplication**:
   - Jika judul video sudah memuat nama uploader/author (atau author sudah memuat judul), suffix author otomatis tidak digandakan.
3. **Platform-Specific Cleansing**:
   - **YouTube**: Menghapus prefiks `@` dari uploader ID.
   - **TikTok / Threads**: Menghapus emoji liar dan memotong deskripsi panjang pada batas kata di bawah 80 karakter.
   - **Windows Sanitizer**: Karakter terlarang (`< > : " / \ | ? *`) dan kontrol karakter ASCII diganti dengan strip `-`.

---

## 🧪 Testing & Verification Matrix

| Scope | Perintah | Kriteria Kelulusan |
| :--- | :--- | :--- |
| **Frontend Unit Tests** | `bun test` | 100% test passing (0 failed) |
| **Frontend Type Checking** | `bun x tsc --noEmit` | 0 error TypeScript |
| **Frontend Production Build** | `bun run build` | Sukses menghasilkan bundle `dist/` |
| **Backend Rust Syntax** | `cargo check` (di `src-tauri`) | 0 warning kritis & 0 error kompilasi |
| **Backend Rust Unit Tests** | `cargo test --lib` (di `src-tauri`) | Seluruh 84+ unit test lolos (green) |
| **Desktop Development Run** | `bun run tauri:dev` | Desktop window berjalan tanpa runtime panic |

---

## 📌 Change Checklist Before Turn Completion

- [ ] Kode TypeScript bebas dari `any` dan lolos `bun x tsc --noEmit`.
- [ ] Seluruh unit test lolos via `bun test` dan `cargo test --lib`.
- [ ] Semua teks UI dan notifikasi menggunakan Bahasa Inggris standar.
- [ ] Setiap perubahan struct di `models.rs` telah disinkronkan ke `types.ts`.
- [ ] Subprocess `yt-dlp` atau `ffmpeg` baru telah didaftarkan ke `ProcessManager`.
- [ ] Pemanggilan CLI binary menggunakan safe `.arg()` vector dan escape template `%%`.
- [ ] Secret API key tidak pernah dibocorkan ke log, konsol, atau model publik.
- [ ] Event listener Tauri (`listen()`) memiliki fungsi cleanup `unlisten()` di React `useEffect`.
- [ ] Frontend berhasil di-build tanpa warning kritis via `bun run build`.

---

*xDownloader Coding Preferences Reference v1.2.2 — Updated 2026-10-23*
