# AGENTS.md — Development Rules & Operating Guidelines for xDownloader

## 1. Project Overview & Identity
- **Project**: xDownloader (Desktop Media Studio Downloader)
- **Role**: Co-Leader of Masagi (xDownloader Module)
- **Architecture**: Tauri v2 Desktop Shell + Vite 6 + React 19 + TailwindCSS v4 + Rust 2021 Tokio Backend + SQLite (`rusqlite`)

---

## 2. STRICT UI LANGUAGE RULE
- **Primary Rule**: **ALL UI elements, labels, buttons, dialogs, toasts, placeholders, tooltips, and OS notifications MUST be in English.**
- **Exception**: Bahasa Indonesia is **ONLY** permitted in code comments and internal documentation files (`.md`).
- **Forbidden**: Do NOT introduce Indonesian phrases or terms into any user-facing frontend component or UI string.

---

## 3. CORE PRINCIPLES & FLOW
1. **No Hallucination**: Always verify existing files and symbols before proposing or applying changes.
2. **Flow-Driven**: Understand → Plan → Execute → Verify → Test → Reflect.
3. **Execution-Focused**: Fast, desktop-native, zero-crash, scalable.
4. **Type Parity**: Maintain 1:1 parity between Rust structs (`models.rs`) and TypeScript types (`types.ts`).

---

## 4. DESIGN SYSTEM (Masagi Zinc Dark)
- Background Canvas: `#09090b` (`bg-[#09090b]` / `--background`)
- Cards / Modals: `#121215` (`bg-[#121215]` / `--card`)
- Borders: `#27272a` (`border-[#27272a]`), hover `#3f3f46`
- Primary Accent: Blue-500 `#3b82f6` (`bg-primary`), hover `#2563eb`
- Text Colors: Primary `#f4f4f5`, Secondary `#a1a1aa`, Muted `#71717a`
- Markdown & Rich Content: Use independent, zero-dependency Markdown components for rendering formatted release notes and rich text.

---

## 5. PROCESS & IPC SAFETY
- Always use vector arguments `.arg(...)` for `yt-dlp` and `ffmpeg` (no shell interpolation).
- All spawned subprocesses must be registered in `ProcessManager` for cancellation and zombie prevention.
- All Tauri IPC commands must return `Result<T, String>` and be typed in `src/lib/tauri-api.ts`.
- Retain `isTauriEnvironment()` fallbacks in `src/lib/tauri-api.ts` to support browser simulation and web preview.

---

## 6. VERIFICATION COMMANDS
- Frontend Typecheck: `bun x tsc --noEmit`
- Frontend Build: `bun run build`
- Rust Backend Syntax: `cargo check` (in `src-tauri`)
- Rust Unit Tests: `cargo test --lib` (in `src-tauri`)
