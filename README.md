# 📥 xDownloader — Fast, Multi-Platform Desktop Media Studio & AI Transcription

[![Status: Production Ready](https://img.shields.io/badge/Status-Production_v1.2.3-emerald?style=flat-square)](https://github.com/egga-fx/xdownloader)
[![Platform](https://img.shields.io/badge/Platform-Windows_x64-blue?style=flat-square)](https://github.com/egga-fx/xdownloader)
[![Desktop Shell](https://img.shields.io/badge/Shell-Tauri_v2-black?style=flat-square&logo=tauri)](https://tauri.app/)
[![Frontend](https://img.shields.io/badge/Frontend-Vite_6_%7C_React_19_%7C_Tailwind_v4-blueviolet?style=flat-square)](https://vitejs.dev/)
[![Backend Engine](https://img.shields.io/badge/Backend-Rust_2021_%7C_Tokio-orange?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![Database](https://img.shields.io/badge/Database-SQLite_(rusqlite_WAL)-lightblue?style=flat-square&logo=sqlite)](https://sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)

**xDownloader** adalah aplikasi desktop media studio dan transkripsi berkinerja tinggi (*high-performance desktop media downloader & AI speech studio*) yang dirancang khusus untuk mengunduh, mengekstrak multi-media carousel, melakukan transkripsi berbasis AI dengan diarization, serta mengelola koleksi media secara instan, aman, dan 100% terkontrol di mesin pengguna.

---

## 🎯 Ringkasan Eksekutif & Nilai Utama

xDownloader dibangun untuk mengatasi keterbatasan alat download berbasis web pihak ketiga yang lambat, membatasi bitrate/resolusi, dipenuhi iklan berisiko, atau membocorkan privasi pengguna.

1. **Local-First & Keamanan Mutlak**:
   - Seluruh pemrosesan stream media dan database riwayat berjalan lokal di komputer pengguna. Tidak ada data unduhan, riwayat tautan, atau rekaman audio yang dikirimkan ke server proxy pihak ketiga yang tidak tepercaya.
2. **Kinerja Tinggi Native Desktop (Tauri v2 + Rust)**:
   - Konsumsi memori RAM minimal (<60 MB saat idle) dibandingkan aplikasi serupa berbasis Electron.
   - Pemanfaatan *Tokio async runtime* dan `ProcessManager` native untuk pemantauan unduhan multi-thread dengan proteksi zero-zombie process.
3. **AI Speech-to-Text & Subtitle Studio Terintegrasi**:
   - Terintegrasi dengan **ElevenLabs Scribe v2** untuk transkripsi audio/video berkualitas tinggi, identifikasi pembicara (*speaker diarization*), penandaan audio event, dan ekspor instan ke format subtitle **SRT**, **VTT**, atau **TXT**.
4. **Resumable Downloads & Proteksi Interupsi**:
   - Mendukung fitur **Pause / Resume** unduhan dengan preservasi part stream (`.part` / `.ytdl`). Jika aplikasi tertutup mendadak, sistem otomatis merekonsiliasi task ke status `paused` sehingga unduhan dapat dilanjutkan tanpa mengulang dari 0%.
5. **Desain Pro-Grade *Masagi Zinc Dark Precision***:
   - Antarmuka berdensitas informasi tinggi menggunakan TailwindCSS v4, palet hitam pekat zinc `#09090b` / `#121215`, aksen aurora kinetik, dan kepatuhan penuh terhadap standar antarmuka bahasa Inggris.

---

## 🚀 Fitur-Fitur Utama

| Modul Fitur | Deskripsi Fungsional |
| :--- | :--- |
| 🌐 **Universal Media Ingest** | Mendukung **YouTube** (Video 4K/1080p, Shorts, Livestream VOD, Audio), **TikTok** (Video HD tanpa watermark & carousel foto), **Instagram** (Reels, Posts, Carousel), **Meta Threads** (Multi-video & foto resolusi penuh), **X / Twitter** (Video MP4 & foto HD), **Pinterest** (Video CDN & original image), serta tautan langsung file web (`.mp4`, `.mp3`, `.m3u8`). |
| 🎙️ **AI Transcript Studio** | Transkripsi audio/video lokal maupun online ke teks menggunakan ElevenLabs Scribe v2. Menghasilkan subtitle berskala frame presisi, speaker diarization ("Speaker 1", "Speaker 2"), penandaan audio event (applause, laughter), serta in-app interactive subtitle editor. |
| ⏯️ **Resumable Downloads** | Kemampuan pause dan resume unduhan aktif secara mulus. File parsial dipertahankan dan proses CLI dihentikan secara bersih tanpa kebocoran thread background. |
| 🖼️ **Multi-Media Carousel Picker** | Mendeteksi postingan carousel (Threads, Instagram, TikTok). Dilengkapi modal pemilih visual (`CarouselSelectionModal`) dan pratinjau thumbnail bertumpuk (`CarouselThumbnailStack`) untuk mengunduh sebagian atau seluruh slide sekaligus. |
| 🎚️ **Format & Quality Matrix** | Pilihan resolusi video fleksibel dari **4K (2160p)**, 1440p, 1080p, 720p, hingga 360p. Ekstraksi audio murni ke format **MP3 (320kbps)**, **M4A**, **WAV Lossless**, atau **FLAC**. Subtitel otomatis dalam format **SRT** dan **VTT**. |
| 📝 **Smart Filename Formatting** | Format penamaan file output yang dapat dikonfigurasi: `$title-$author` (default), `$author-$title`, atau `$title only`, dengan deduplikasi author otomatis dan sanitasi karakter ilegal Windows. |
| 🗄️ **Embedded Media Vault** | Riwayat unduhan lokal berbasis SQLite embedded (`rusqlite` mode WAL). Dilengkapi tampilan **Grid View** dan **Table View**, filter format/platform, pemutar media bawaan (*In-App Preview*), auto-healing thumbnail lokal, dan tombol reveal di Windows Explorer. |
| 📋 **Smart Clipboard Listener** | Mendeteksi tautan video/media yang disalin ke clipboard secara otomatis dan menampilkan banner kontekstual *"Paste & Fetch"* dalam satu klik. |
| 🔔 **Desktop Notifications** | Notifikasi OS native saat unduhan selesai, gagal, atau transkripsi rampung menggunakan `@tauri-apps/plugin-notification`. |
| 📜 **Structured Real-Time Logging** | Sistem pencatatan log event terstruktur ke disk dan SQLite dengan **Log Viewer Modal** di dalam aplikasi untuk diagnosis instan. |
| 🔄 **In-App Self-Update Engine** | Pengecekan otomatis update rilis GitHub resmi, pratinjau changelog berformat markdown murni (`MarkdownRenderer.tsx`), dan eksekusi instalasi mandiri. |
| ⚙️ **One-Click Engine Auto-Setup** | Pemeriksaan otomatis keberadaan binary `yt-dlp` dan `ffmpeg` dengan opsi unduh otomatis dari GitHub Releases resmi serta tombol engine updater in-app (`yt-dlp -U`). |

---

## 🏛️ Arsitektur & Topologi Sistem

```text
┌─────────────────────────────────────────────────────────────┐
│                 Desktop Shell (Tauri v2)                    │
│   Native Windows Window • System Tray • Desktop Notifications│
│   Dialogs • Clipboard Listener • GitHub Auto-Updater        │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Typed IPC via invoke & emit)
┌──────────────────────────────▼──────────────────────────────┐
│           Frontend Layer (Vite 6 + React 19)                │
│    TypeScript (Strict) • TailwindCSS v4 • Lucide React      │
│    Masagi Zinc Dark Theme • In-App Media Player & Editor     │
│    Carousel Selector • Log Viewer • Transcript Studio       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│           Backend Core Layer (src-tauri / Rust)             │
│    Tokio Async Runtime • ProcessManager (PID & Pause Track) │
│    rusqlite SQLite (WAL Mode) • Structured Logger (logger.rs)│
│    ElevenLabs Scribe v2 Client (transcriber.rs)             │
│    Multi-Platform Scraper (image_extractor.rs)              │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
┌──────────────▼─────────────┐ ┌──────────────▼───────────────┐
│ Managed CLI Binaries       │ │ Local Persistence Layer     │
│ yt-dlp (Stream & Metadata) │ │ vault.db (SQLite Embedded)  │
│ ffmpeg (Audio & Remux)     │ │ AppData / Portable ./data/  │
│ reqwest (Direct CDN/API)   │ │ App Settings & Task Logs    │
└────────────────────────────┘ └─────────────────────────────┘
```

---

## 💻 Panduan Pengembangan & Cara Menjalankan

### 1. Prasyarat Sistem
- **Node/Bun Runtime**: [Bun v1.2+](https://bun.sh/) (sangat disarankan) atau Node.js 20+.
- **Rust Toolchain**: [Rust & Cargo](https://www.rust-lang.org/) (edisi 2021 stabil).
- **Sistem Operasi**: Windows 10/11 x64.
- *(Opsional)* Binary `yt-dlp` dan `ffmpeg` di PATH sistem, atau gunakan tombol **One-Click Auto Setup** di dalam aplikasi.

### 2. Instalasi Dependensi
```bash
# Clone repositori
git clone https://github.com/egga-fx/xdownloader.git
cd xdownloader

# Instal dependensi frontend
bun install
```

### 3. Menjalankan Mode Pengembangan

#### A. Web Preview Mode (Pengembangan UI Cepat)
Menjalankan antarmuka studio di browser web pada `http://localhost:1420` dengan simulasi download interaktif:
```bash
bun run dev
```

#### B. Native Desktop Mode (Full Tauri Desktop Shell)
Menjalankan aplikasi desktop Windows native lengkap dengan koneksi Rust backend, SQLite, dan subprocess binary:
```bash
bun run tauri:dev
```

### 4. Pengujian & Validasi Kualitas Kode
Pastikan seluruh lapisan pengujian lulus sebelum membuat perubahan atau rilis:
```bash
# 1. Menjalankan Unit Tests Frontend (Tests Suite)
bun test

# 2. Typecheck TypeScript (Strict Frontend)
bun x tsc --noEmit

# 3. Build Bundle Produksi Frontend (Vite)
bun run build

# 4. Pemeriksaan Sintaks & Borrow Checker Rust (Backend)
cd src-tauri
cargo check

# 5. Menjalankan Unit Tests Rust (Downloader, Transcriber, Extractor)
cargo test --lib
```

### 5. Kompilasi Installer Produksi
Untuk menghasilkan file installer `.exe` native Windows yang siap didistribusikan:
```bash
bun run tauri:build
```
Hasil installer akan tersedia di direktori `src-tauri/target/release/bundle/nsis/`.

---

## 📂 Struktur Direktori Proyek

```text
xdownloader/
├── .agents/workflows/        # SOP dan alur kerja AI agentic (/fix, /ai-spec-first-audit, dll.)
├── src/                      # Frontend Studio (React 19 + TypeScript + Tailwind v4)
│   ├── components/           # Komponen Studio UI
│   │   ├── AboutModal.tsx            # Info aplikasi & status binary
│   │   ├── ActiveTranscriptionBanner.tsx # Indikator progress transkripsi aktif
│   │   ├── BinarySetupModal.tsx      # One-click downloader setup
│   │   ├── CarouselSelectionModal.tsx# Pemilih item carousel gambar/video
│   │   ├── CarouselThumbnailStack.tsx# Pratinjau thumbnail bertumpuk
│   │   ├── DeleteConfirmDialog.tsx   # Dialog konfirmasi hapus aman
│   │   ├── Header.tsx                # Status top bar & navigasi
│   │   ├── LogViewerModal.tsx        # In-app log viewer & visual inspector
│   │   ├── MarkdownRenderer.tsx      # Zero-dep release notes renderer
│   │   ├── MediaPreviewModal.tsx     # In-app player preview audio/video/foto
│   │   ├── MediaVaultDrawer.tsx      # Drawer slide-over riwayat media
│   │   ├── MetadataPreviewCard.tsx   # Live probe card & format selector
│   │   ├── SettingsModal.tsx         # Preferensi, naming, STT API key
│   │   ├── TranscriptStudioModal.tsx # In-app subtitle editor & transcript player
│   │   ├── UpdateModal.tsx           # In-app updater modal & changelog viewer
│   │   ├── UrlInputSection.tsx       # Smart input bar & clipboard banner
│   │   ├── VaultHistoryGrid.tsx      # Visual grid view riwayat unduhan
│   │   ├── VaultHistoryTable.tsx     # Tabel data padat riwayat unduhan
│   │   └── VaultItemActions.tsx      # Menu aksi dropdown item riwayat
│   ├── lib/                  # Utilities & Jembatan Native
│   │   ├── icons.tsx                 # Ikon platform & format SVG
│   │   ├── notifications.ts          # Integrasi notifikasi native desktop
│   │   ├── tauri-api.ts              # Typed client IPC & browser mock
│   │   └── utils.ts                  # Helper cn, formatter, penamaan file
│   ├── App.tsx               # Orchestrator state utama studio
│   ├── index.css             # Masagi Zinc Dark design system tokens
│   └── types.ts              # Kontrak data TypeScript 1:1 Rust
├── src-tauri/                # Backend Desktop Native (Rust 2021)
│   ├── src/
│   │   ├── binaries.rs       # Manajemen binary eksternal & auto-setup
│   │   ├── db.rs             # Repository SQLite rusqlite (WAL mode)
│   │   ├── downloader.rs     # yt-dlp supervisor, pause/resume, ProcessManager
│   │   ├── image_extractor.rs# Extractor foto/carousel Threads, IG, TikTok, X
│   │   ├── lib.rs            # Command dispatcher (27 IPC handlers) & AppState
│   │   ├── logger.rs         # Logging subsystem terstruktur ke disk
│   │   ├── metadata.rs       # yt-dlp metadata probe cepat
│   │   ├── models.rs         # Data structures Serde camelCase
│   │   └── transcriber.rs    # ElevenLabs Scribe v2 STT engine & diarization
│   ├── Cargo.toml            # Dependensi Rust crate
│   └── tauri.conf.json       # Konfigurasi jendela & plugin Tauri v2
├── tests/                    # Vitest/Bun unit testing suite
│   ├── notifications.test.ts # Tes logika notifikasi desktop
│   ├── tauri-api.test.ts     # Tes simulasi browser IPC
│   └── utils.test.ts         # Tes penamaan file & sanitasi string
├── AGENTS.md                 # Aturan operasional & workflow agen
├── CODING_PREF.md            # Standar penulisan kode & process safety
├── DESIGN.md                 # Panduan visual & desain Masagi Zinc Dark
├── FEATURES.md               # Katalog teknis seluruh modul media
├── GEMINI.md                 # Panduan Co-Leader Masagi & debate triggers
├── STACKS.md                 # Topologi dependensi & arsitektur komprehensif
├── package.json              # Script npm & dependensi frontend
├── tsconfig.json             # Konfigurasi strict TypeScript
└── vite.config.ts            # Konfigurasi bundler Vite
```

---

## 📚 Hubungan Dokumentasi Proyek

Untuk memahami standar spesifik dan rincian arsitektur lebih lanjut, silakan merujuk ke dokumen pelengkap:
- [STACKS.md](./STACKS.md) — Rincian lapisan teknologi, 27 perintah IPC, library, dan topologi runtime.
- [FEATURES.md](./FEATURES.md) — Spesifikasi teknis setiap fitur media, format matrix, dan pipeline transkripsi.
- [DESIGN.md](./DESIGN.md) — Panduan visual, token warna TailwindCSS v4, dan layout studio.
- [CODING_PREF.md](./CODING_PREF.md) — Standar penulisan kode, IPC contracts, keamanan API key, dan process safety.
- [GEMINI.md](./GEMINI.md) — Protokol operasional Masagi, debate triggers, dan agentic workflow.
- [AGENTS.md](./AGENTS.md) — Aturan ringkas panduan AI pair-programming, English UI rule, dan checklist verifikasi.

---

## 📄 Lisensi

Proyek ini didistribusikan di bawah lisensi terbuka **MIT License**. Silakan baca file [LICENSE](./LICENSE) untuk ketentuan lengkapnya.

---

*xDownloader Studio v1.2.3 — High-Performance Desktop Media Studio & AI Transcription.*
