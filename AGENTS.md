# AGENTS.md — Development Rules & Operating Guidelines for xDownloader

## 1. Project Overview & Identity
- **Project**: xDownloader (Desktop Media Studio Downloader & AI Transcription Studio)
- **Role**: Co-Leader of Masagi (xDownloader Module)
- **Architecture**: Tauri v2 Desktop Shell + Vite 6 + React 19 + TailwindCSS v4 + Rust 2021 Tokio Backend + SQLite (`rusqlite` WAL)
- **Current Version**: `v1.2.2+`
- **Core Engine Capabilities**:
  - Direct multi-platform media downloader (YouTube, TikTok, Instagram, Threads, X/Twitter, Pinterest, generic web media).
  - Native multi-image & multi-video carousel extractor (`image_extractor.rs`).
  - AI Video & Audio Transcription Studio via ElevenLabs Scribe v2 (`transcriber.rs`) with speaker diarization and SRT/VTT/TXT export.
  - Resumable downloads (Pause/Resume with HTTP Range preservation and zero artifact corruption).
  - Native Desktop Notifications (`@tauri-apps/plugin-notification`).
  - In-App Self-Updating via GitHub releases and silent NSIS installer invocation.
  - Embedded SQLite Media Vault with local thumbnail caching and auto-healing titles.

---

## 2. STRICT UI LANGUAGE RULE
- **Primary Rule**: **ALL UI elements, labels, buttons, dialogs, toasts, placeholders, tooltips, and OS notifications MUST be in English.**
- **Exception**: Bahasa Indonesia is **ONLY** permitted in code comments and internal documentation files (`.md`).
- **Forbidden**: Do NOT introduce Indonesian phrases or terms into any user-facing frontend component or UI string.

---

## 3. CORE PRINCIPLES & OPERATING PHILOSOPHY
1. **No Hallucination**: Always inspect existing files, functions, and models before proposing or applying changes.
2. **Flow-Driven**: Understand → Plan → Execute → Verify → Test → Reflect.
3. **Execution-Focused**: Fast, desktop-native, zero-crash, zero zombie processes.
4. **Type Parity**: Maintain strict 1:1 parity between Rust structs (`models.rs`) and TypeScript types (`types.ts`).
5. **KISS & Minimal Footprint**: Follow `/protocol-kiss` — solve problems with the simplest robust abstraction without unnecessary external dependencies.

---

## 4. AGENT WORKFLOWS & PROTOCOLS
All complex tasks must adhere to the dedicated workflows located in `.agents/workflows/`:
- **/ai-spec-first-audit**: Contract-first testing protocol. Never mirror implementation details in tests; write independent assertions, boundary limits, and error scenarios.
- **/fix**: Targeted bug fix protocol. Diagnose root cause, isolate fix target, avoid unintended side-effects, and run the complete 5-layer verification matrix.
- **/diff-review**: Systematic diff analysis before staging or concluding edits.
- **/explicit-commit**: Strict commit discipline. NEVER perform automatic git commits without explicit user confirmation.
- **/git-commiter**: Standard Conventional Commits format (`feat(scope):`, `fix(scope):`, `chore(scope):`, `refactor(scope):`).
- **/push-and-release**: Production release protocol: linting, test suites, semantic tagging, NSIS installer compilation, and minisign signature verification.
- **/protocol-kiss**: Architecture simplicity check to avoid over-engineering.

---

## 5. DESIGN SYSTEM (Masagi Zinc Dark)
- **Background Canvas**: `#09090b` (`bg-[#09090b]` / CSS `--background`)
- **Cards & Modals**: `#121215` (`bg-[#121215]` / CSS `--card`)
- **Borders**: `#27272a` (`border-[#27272a]`), hover `#3f3f46`
- **Primary Accent**: Blue-500 `#3b82f6` (`bg-primary`), hover `#2563eb`
- **Text Tokens**: Primary `#f4f4f5`, Secondary `#a1a1aa`, Muted `#71717a`
- **Input Styling**: Dark native tailwind input with focus ring `focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500`.
- **Modals & Drawers**: Backdrop blur `backdrop-blur-sm`, smooth fade/slide transitions, ESC dismiss, and click-outside handler.
- **Markdown & Rich Content**: Zero-dependency renderer (`MarkdownRenderer.tsx`) for update changelogs and release notes.

---

## 6. PROCESS, IPC & NATIVE SAFETY
1. **CLI Vector Arguments**:
   - Always use `.arg(...)` or `.args([...])` on `Command::new()`. Never concatenate raw strings into a shell interpreter.
2. **Anti-Zombie Process Management (`ProcessManager`)**:
   - Every spawned subprocess (`yt-dlp`, `ffmpeg`) must register its PID with `ProcessManager`.
   - On Windows, always apply `CREATE_NO_WINDOW` flag (`0x08000000`).
   - Task cancellation must terminate the entire process tree (`taskkill /F /T /PID`).
3. **Resumable Download & Artifact Protection**:
   - **Pause**: Kills active CLI process but preserves partial stream files (`.part`, `.ytdl`).
   - **Cancel**: Aborts process and purges partial temporary files (`cleanup_task_artifacts`).
   - **Artifact Safety (B02)**: Never delete completed primary output files whose stem matches the active task stem.
4. **Template Percent Escaping**:
   - yt-dlp format strings must escape literal `%` characters to `%%` to prevent Windows shell / yt-dlp interpolation panics.
5. **Tauri IPC Command Contract**:
   - All `#[tauri::command]` functions must return `Result<T, String>` for fallible operations.
   - All IPC functions must be wrapped with typed signatures in `src/lib/tauri-api.ts`.
   - Maintain `isTauriEnvironment()` simulation fallbacks for seamless browser preview (`bun run dev`).
6. **API Key & Secret Sanitization**:
   - ElevenLabs API keys must NEVER be logged, printed to console, or passed in public IPC models.
   - The UI only receives masked hints (`••••XYZ9`) and status enums (`missing` | `saved` | `invalid`).

---

## 7. VERIFICATION MATRIX (MANDATORY BEFORE TURN COMPLETION)

| Scope | Command | Criteria |
| :--- | :--- | :--- |
| **Frontend Unit Tests** | `bun test` | 100% test passes (zero failures) |
| **TypeScript Typecheck** | `bun x tsc --noEmit` | 0 errors |
| **Frontend Production Build** | `bun run build` | Vite build succeeds generating `dist/` |
| **Rust Backend Syntax** | `cargo check` (in `src-tauri`) | 0 compile errors |
| **Rust Unit Tests** | `cargo test --lib` (in `src-tauri`) | All unit & integration tests pass (green) |
| **Desktop Runtime** | `bun run tauri:dev` | Application window launches and functions |
