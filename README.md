# 📥 xDownloader — Fast, Multi-Platform Desktop Media Studio Downloader

[![Status: Production Ready](https://img.shields.io/badge/Status-Production_v1.0.0-emerald?style=flat-square)](https://github.com/egga-fx/xdownloader)
[![Platform](https://img.shields.io/badge/Platform-Windows_x64-blue?style=flat-square)](https://github.com/egga-fx/xdownloader)
[![Desktop Shell](https://img.shields.io/badge/Shell-Tauri_v2-black?style=flat-square&logo=tauri)](https://tauri.app/)
[![Frontend](https://img.shields.io/badge/Frontend-Vite_6_%7C_React_19_%7C_Tailwind_v4-blueviolet?style=flat-square)](https://vitejs.dev/)
[![Backend Engine](https://img.shields.io/badge/Backend-Rust_2021_%7C_Tokio-orange?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![Database](https://img.shields.io/badge/Database-SQLite_(rusqlite_WAL)-lightblue?style=flat-square&logo=sqlite)](https://sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)

**xDownloader** adalah aplikasi studio desktop berkinerja tinggi (*high-performance media studio downloader & processor*) yang dirancang khusus untuk mengunduh, mengekstrak, memotong (*trimming*), dan memecah (*splitting*) media dari berbagai platform sosial dan web modern secara instan, aman, dan 100% lokal di mesin pengguna.

---

## 🎯 Ringkasan Eksekutif & Nilai Utama

xDownloader dibangun untuk mengatasi keterbatasan alat download web berbasis cloud yang lambat, dipenuhi iklan berbahaya, membatasi resolusi, atau berisiko membocorkan data pengguna.

1. **Local-First & Privasi Mutlak**:
   - Seluruh pemrosesan stream video, ekstraksi audio, dan pemotongan berlangsung 100% lokal di komputer pengguna. Tidak ada data media atau metadata yang dikirimkan ke server pihak ketiga.
2. **Kinerja Tinggi Native Desktop (Tauri v2 + Rust)**:
   - Konsumsi memori RAM minimal (<60 MB saat idle) dibandingkan software berbasis Electron.
   - Pemanfaatan *Tokio async runtime* dan `ProcessManager` native untuk pemantauan unduhan multi-thread berkecepatan tinggi tanpa membebani thread antarmuka (zero UI lag).
3. **Studio Media Tools Terintegrasi**:
   - Tidak hanya sekadar pengunduh (*downloader*), xDownloader dilengkapi dengan **Exact Video Trimmer** (pemotong durasi presisi milidetik) dan **Multi-Segment Video Splitter** (pemecah video otomatis per 30/60 detik untuk konten TikTok, Instagram Reels, dan YouTube Shorts).
4. **Desain Pro-Grade *Masagi Zinc Dark Precision***:
   - Antarmuka modern berdensitas informasi tinggi menggunakan TailwindCSS v4, aksen aurora kinetik, dan palet warna hitam pekat yang nyaman untuk kerja studio intensif.

---

## 🚀 Fitur-Fitur Utama

| Modul Fitur | Deskripsi Fungsional |
| :--- | :--- |
| 🌐 **Universal Media Ingest** | Mendukung **YouTube** (Video, Shorts, Livestream VOD, Subtitel), **TikTok** (Video tanpa watermark & foto carousel), **Instagram** (Reels, Posts, Stories), **X / Twitter** (Video, GIF, Foto HD), **Pinterest** (Video & Foto CDN original), dan tautan langsung media web (`.mp4`, `.mp3`, `.m3u8`). |
| 🎚️ **Format & Quality Matrix** | Pilihan resolusi video fleksibel dari **4K (2160p)**, 1440p, 1080p, 720p, hingga 360p. Ekstraksi audio murni ke format **MP3 (320kbps)**, **M4A**, **WAV Lossless**, atau **FLAC**. Subtitel otomatis dalam format **SRT** dan **VTT**. |
| ✂️ **In-App Video Trimmer** | Pemotongan durasi video presisi berbasis FFmpeg native. Mendukung file lokal maupun pemotongan langsung dari URL stream online dengan preview visual interaktif. |
| 🪓 **Multi-Segment Video Splitter** | Memecah video panjang menjadi beberapa segmen berdasarkan durasi tetap (misal: tiap 60 detik), jumlah bagian merata (*equal parts*), atau rentang kustom dengan opsi pembuatan subfolder otomatis. |
| 🗄️ **Embedded Media Vault** | Riwayat unduhan lokal berbasis SQLite embedded (`rusqlite` mode WAL). Dilengkapi tampilan **Grid View** dan **Table View**, pencarian instan, filter platform, pemutar media bawaan (*In-App Preview*), dan reveal di Windows Explorer. |
| 📋 **Smart Clipboard Listener** | Mendeteksi tautan video yang disalin ke clipboard secara otomatis dan menampilkan banner kontekstual *"Paste & Fetch"* dalam satu klik. |
| 🛡️ **Zero-Zombie Process Safety** | Backend `ProcessManager` mencatat PID setiap subprocess `yt-dlp` dan `ffmpeg`. Tombol pembatalan mematikan seluruh process tree seketika (`taskkill /F /T /PID`), menjamin zero background process leak. |
| ⚙️ **One-Click Engine Auto-Setup** | Pemeriksaan otomatis keberadaan binary `yt-dlp` dan `ffmpeg`. Tersedia tombol auto-install langsung dari GitHub Releases resmi serta tombol engine updater in-app (`yt-dlp -U`). |

---

## 🏛️ Arsitektur & Teknologi

```text
┌─────────────────────────────────────────────────────────────┐
│                 Desktop Shell (Tauri v2)                    │
│     Native Windows Window • Tray Icon • System Dialogs      │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Typed IPC via invoke & emit)
┌──────────────────────────────▼──────────────────────────────┐
│           Frontend Layer (Vite 6 + React 19)                │
│    TypeScript (Strict) • TailwindCSS v4 • Lucide React      │
│    Masagi Zinc Dark Theme • In-App Media Preview Player     │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│           Backend Core Layer (src-tauri / Rust)             │
│    Tokio Async Runtime • ProcessManager (PID Tracking)      │
│    rusqlite SQLite (WAL Mode) • Reqwest Image Scraper       │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
┌──────────────▼─────────────┐ ┌──────────────▼───────────────┐
│ Managed CLI Binaries       │ │ Local Persistence Layer     │
│ yt-dlp (Stream & Metadata) │ │ vault.db (SQLite Embedded)  │
│ ffmpeg (Trim & Split)      │ │ Portable ./data/ or AppData │
└────────────────────────────┘ └─────────────────────────────┘
```

---

## 💻 Panduan Pengembangan & Cara Menjalankan

### 1. Prasyarat Sistem
- **Node/Bun Runtime**: [Bun v1.2+](https://bun.sh/) (disarankan) atau Node.js 20+.
- **Rust Toolchain**: [Rust & Cargo](https://www.rust-lang.org/) (edisi 2021).
- **OS**: Windows 10/11 x64.
- *(Opsional)* Binary `yt-dlp` dan `ffmpeg` di PATH sistem, atau gunakan tombol **One-Click Setup** di dalam aplikasi.

### 2. Instalasi Dependensi
```bash
# Clone repositori
git clone https://github.com/egga-fx/xdownloader.git
cd tools/xdownloader

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
```bash
# 1. Typecheck TypeScript (Frontend)
bun x tsc --noEmit

# 2. Build Bundle Vite (Frontend)
bun run build

# 3. Pemeriksaan Sintaks & Borrow Checker Rust (Backend)
cd src-tauri
cargo check

# 4. Menjalankan Unit Tests Rust (Extractor & Utils)
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
├── src/                      # Frontend Studio (React 19 + TypeScript + Tailwind v4)
│   ├── components/           # Reusable Studio UI (Header, UrlInput, Vault, Modals)
│   ├── lib/                  # Utilities (tauri-api.ts, utils.ts, icons.tsx)
│   ├── App.tsx               # Root State Controller
│   ├── index.css             # Masagi Zinc Dark Theme Tokens
│   └── types.ts              # TypeScript Data Contracts
├── src-tauri/                # Backend Desktop Native (Rust 2021)
│   ├── src/
│   │   ├── binaries.rs       # Binary locator & GitHub auto-installer
│   │   ├── db.rs             # rusqlite SQLite repository (WAL mode)
│   │   ├── downloader.rs     # yt-dlp runner, FFmpeg trim/split, ProcessManager
│   │   ├── image_extractor.rs# Multi-platform high-res photo scraper
│   │   ├── lib.rs            # Tauri command dispatcher & AppState
│   │   ├── metadata.rs       # Fast yt-dlp metadata JSON probe
│   │   └── models.rs         # Serde shared data structures
│   ├── Cargo.toml            # Rust dependencies & metadata
│   └── tauri.conf.json       # Window layout, updater, & plugin config
├── CODING_PREF.md            # Standar penulisan kode & konvensi proyek
├── DESIGN.md                 # Desain visual, palet warna, & tata letak UI
├── FEATURES.md               # Katalog lengkap fitur & pipeline media
├── GEMINI.md                 # Aturan Co-Leader & agentic workflow
├── STACKS.md                 # Rincian dependensi & topologi arsitektur
├── package.json              # Script build frontend & dependensi npm
├── tsconfig.json             # Konfigurasi TypeScript strict
└── vite.config.ts            # Konfigurasi bundler Vite
```

---

## 📚 Hubungan Dokumentasi Proyek

Untuk memahami standar spesifik dan rincian arsitektur lebih lanjut, silakan merujuk ke dokumen pelengkap:
- [STACKS.md](./STACKS.md) — Rincian lapisan teknologi, library, dan topologi runtime.
- [FEATURES.md](./FEATURES.md) — Spesifikasi teknis setiap fitur media dan format matrix.
- [DESIGN.md](./DESIGN.md) — Panduan visual, token warna TailwindCSS v4, dan layout studio.
- [CODING_PREF.md](./CODING_PREF.md) — Standar penulisan kode, IPC contracts, dan process safety.
- [GEMINI.md](./GEMINI.md) — Protokol operasional dan panduan AI pair-programming Masagi.

---

## 📄 Lisensi

Proyek ini didistribusikan di bawah lisensi terbuka **MIT License**. Silakan baca file [LICENSE](./LICENSE) untuk ketentuan lengkapnya.

---

*xDownloader Studio v1.0.0 — Crafted for High-Performance Desktop Media Processing.*
