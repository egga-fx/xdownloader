# xDownloader — Standalone Multi-Platform Desktop Media Studio

<p align="center">
  <a href="https://github.com/egga-fx/xdownloader/releases"><img src="https://img.shields.io/github/v/release/egga-fx/xdownloader?style=flat-square&color=3b82f6" alt="Release Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-10b981.svg?style=flat-square" alt="License MIT"></a>
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Tauri-v2-24c8db?style=flat-square&logo=tauri&logoColor=white" alt="Tauri v2"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black" alt="React 19"></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS v4"></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20x64-0078d4?style=flat-square&logo=windows&logoColor=white" alt="Platform Windows">
</p>

<p align="center">
  <b>xDownloader</b> is a high-speed, lightweight desktop media studio built with <b>Tauri v2</b>, <b>React 19</b>, <b>Vite</b>, <b>Tailwind CSS v4</b>, and a native <b>Rust Core IPC</b>. 100% self-contained, offline-capable, and designed for content creators and editors.
</p>

---

## ⚡ Key Features

- 🎯 **Multi-Platform Universal Extraction**: Seamlessly extracts high-resolution video and audio from YouTube (Videos, Shorts, Playlists), TikTok, Instagram (Reels, Posts), X / Twitter, Pinterest, and direct MP4/WebM URLs.
- ✂️ **Built-in Video Splitter & Shorts Cutter**:
  - Multi-part chunk generator (e.g. 60s for YouTube Shorts / TikTok, custom durations, or manual timecodes).
  - Stream-based fast split directly from online media URLs without downloading the whole video first.
  - Local lossless split powered by native FFmpeg stream copying.
- 📋 **Zero-Layer Smart Clipboard Integration**: Automatic clipboard monitoring with animated detection badges and a 1-click *"Download from Clipboard"* quick action.
- 🗄️ **SQLite WAL Media Vault**:
  - Dual view modes: **Compact Table View** and **Media Card Grid View**.
  - Track download status, file sizes, author info, and exact disk paths.
  - In-app media player modal for quick verification.
  - Smart physical file verification (shows "NOT FOUND" badge if a file was moved or deleted externally).
- 🔧 **In-App Self-Healing Binary Installer**: Automatically checks for `yt-dlp` and `ffmpeg` in `./bin` or system `PATH`. If missing, installs the latest official binaries with a single click.
- 🔄 **Cryptographic In-App Auto Updater**: Minisign-signed automatic updates directly from GitHub Releases via Tauri v2 updater plugin.
- 🎨 **Masagi Zinc Dark Theme**: Premium, clutter-free dark aesthetic with glassmorphic accents, fluid transitions, and zero visual noise.

---

## 📥 Download & Installation

Visit the [**Latest Releases**](https://github.com/egga-fx/xdownloader/releases/latest) page to grab the standalone Windows installer:

| Platform | Format | Installer File |
| :--- | :--- | :--- |
| **Windows 10/11 (64-bit)** | NSIS Installer | `xDownloader_<version>_x64-setup.exe` |

*Portable execution mode: Run the executable or extract it into any directory with a `./bin` and `./data` folder for 100% portable usage.*

---

## 🚀 Getting Started (Development)

### Prerequisites
- [Bun](https://bun.sh/) (or Node.js 20+)
- [Rust Toolchain](https://www.rust-lang.org/tools/install) (stable `x86_64-pc-windows-msvc`)
- Visual Studio C++ Build Tools (Windows)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/egga-fx/xdownloader.git
cd xdownloader
bun install
```

### 2. Run in Web Browser Dev Mode
Quick UI and layout debugging without native Rust runtime:
```bash
bun run dev
```

### 3. Run in Full Tauri v2 Desktop Mode
Runs the live native window with hot-reloading for both React and Rust:
```bash
bun run tauri dev
```

### 4. Build Production Desktop Executable
Compiles the optimized Rust backend and packages the standalone NSIS installer in `src-tauri/target/release/bundle/nsis/`:
```bash
bun run tauri:build
```

---

## 📂 Project Architecture

```
xdownloader/
├── .github/workflows/
│   └── release.yml            # Automated GitHub Actions build & release pipeline
├── package.json               # React 19, Vite, Tailwind v4, Tauri v2 plugins
├── vite.config.ts             # Vite configuration with Tauri port binding (1420)
├── index.html                 # App shell with Plus Jakarta Sans typography
├── src/
│   ├── index.css              # Masagi Zinc Dark design tokens & Tailwind v4
│   ├── types.ts               # Core TypeScript data contracts & models
│   ├── lib/
│   │   ├── tauri-api.ts       # Typed Tauri IPC command & event wrapper
│   │   └── utils.ts           # Helpers: duration, file size, smart delete logic
│   └── components/
│       ├── Header.tsx                 # Output folder picker & vault toggle
│       ├── UrlInputSection.tsx        # Zero-layer input + clipboard smart button
│       ├── MetadataPreviewCard.tsx    # Format & quality selection
│       ├── VideoSplitterModal.tsx     # Shorts & multi-part video cutter modal
│       ├── MediaVaultDrawer.tsx       # Side drawer with Table & Grid view
│       ├── VaultHistoryTable.tsx      # Tabular history with NOT FOUND badges
│       ├── VaultHistoryGrid.tsx       # Card grid history
│       ├── DeleteConfirmDialog.tsx    # Safe confirm modal for real disk files
│       ├── BinarySetupModal.tsx       # In-app yt-dlp & ffmpeg installer
│       ├── MediaPreviewModal.tsx      # Media preview player & detail modal
│       ├── SettingsModal.tsx          # Preferences & auto-update toggles
│       └── AboutModal.tsx             # Studio version & developer credits
└── src-tauri/
    ├── Cargo.toml             # Rust dependencies (tauri, rusqlite, tokio, reqwest)
    ├── tauri.conf.json        # Window & bundle configuration
    ├── icons/                 # Desktop application icons
    └── src/
        ├── main.rs            # Application entrypoint
        ├── lib.rs             # Tauri command registrations
        ├── models.rs          # Serde data structs
        ├── db.rs              # SQLite database engine (WAL mode)
        ├── binaries.rs        # Binary resolver & GitHub release downloader
        ├── downloader.rs      # Child process runner & stdout progress parser
        └── metadata.rs        # Fast media metadata fetcher
```

---

## 🔒 Security & Privacy

- **100% Local & Private**: All media downloads, video slicing, and file conversions occur directly on your machine via local child processes (`yt-dlp` and `ffmpeg`). No media or personal telemetry is transmitted to third-party servers.
- **Minisign Cryptographic Verification**: Auto-update payloads are verified using Minisign public key cryptography to guarantee installer integrity before execution.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — see the [LICENSE](LICENSE) file for details.

Developed with ❤️ by [Egga](https://github.com/egga-fx).
