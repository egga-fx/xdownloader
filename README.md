# xDownloader — Standalone Multi-Platform Desktop Media Studio

**xDownloader** is a high-speed, lightweight desktop media downloader built with **Tauri v2**, **React 19**, **Vite**, **Tailwind CSS v4**, and a native **Rust Core IPC**. It is designed to be 100% self-contained, portable, and blazing fast.

---

## ⚡ Key Highlights & Architecture

- **Ultra-Lightweight Desktop Shell**: Built on Tauri v2 with tiny binary size (~10MB installer) and minimal RAM footprint (~35MB RAM).
- **Native Rust IPC Engine**: Directly invokes and manages `yt-dlp` and `ffmpeg` child processes via OS pipes with real-time streaming progress events (`download-progress`) to the React frontend.
- **Auto-Detect & Dynamic Binary Downloader**: Automatically resolves `yt-dlp` and `ffmpeg` in `./bin` or system `PATH`. If missing, provides a one-click in-app setup wizard downloading official GitHub release binaries.
- **Zero-Layer Search Bar**: Clean floating input bar with synchronized border radius, dynamic platform icon detection, and Smart Download button from OS clipboard.
- **Unified Media Vault**: Pinned live active tasks with cancel controls, dual view (Table View & Card Grid View), and smart direct deletion for missing/corrupted records (bypasses modal if the physical file no longer exists).
- **Local SQLite Storage**: Built-in SQLite WAL engine storing history and preferences in `%APPDATA%/xdownloader/` (or portable `./data/` mode).

---

## 🚀 Getting Started (Development)

### 1. Install Node/Frontend Dependencies
```bash
cd tools/xdownloader
bun install
```

### 2. Run in Web Browser Dev Mode
```bash
bun run dev
```

### 3. Run in Full Tauri v2 Desktop Mode
```bash
bun run tauri dev
```

### 4. Build Production Desktop Executable (NSIS / Standalone)
```bash
bun run tauri build
```

---

## 📂 Project Structure

```
tools/xdownloader/
├── package.json               # React 19, Vite, Tailwind v4, Tauri plugins
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
│       ├── MediaVaultDrawer.tsx       # Side drawer with Table & Grid view
│       ├── VaultHistoryTable.tsx      # Tabular history with NOT FOUND badges
│       ├── VaultHistoryGrid.tsx       # Card grid history
│       ├── DeleteConfirmDialog.tsx    # Safe confirm modal for real disk files
│       ├── BinarySetupModal.tsx       # In-app yt-dlp & ffmpeg installer
│       └── MediaPreviewModal.tsx      # Media preview player & detail modal
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
