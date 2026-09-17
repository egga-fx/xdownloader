---
description: Explicit Commit Only — Strict protocol enforcing manual user-triggered single consolidated git commits without auto-committing.
---

# Explicit Commit Only Protocol

Enforces a strict policy: AI agents **MUST NEVER** execute `git commit` automatically. Commits are ONLY executed when explicitly requested by the user, and must be performed as a single consolidated commit.

## Purpose

Prevent unnecessary auto-commits, avoid polluting git history with partial edits, and ensure that code commits are only made under explicit user instruction.

## Core Rules & Principles

> [!IMPORTANT]
> **RULE 1: ZERO AUTO-COMMIT**
> AI agents are strictly prohibited from running `git commit` or auto-committing code changes after completing tasks or fixing bugs. All changes must remain uncommitted in the working directory until the user explicitly commands a commit (e.g., "commit sekarang", "tolong commit", `/explicit-commit`).

> [!TIP]
> **RULE 2: SINGLE CONSOLIDATED COMMIT**
> When the user commands a commit, combine all related changes into **EXACTLY ONE** clean, consolidated commit rather than creating multiple incremental micro-commits.

> [!NOTE]
> **RULE 3: CONVENTIONAL COMMITS COMPLIANCE**
> Every commit message must adhere to the Conventional Commits specification (`type(scope): subject`).

---

## Execution Workflow

When the user explicitly commands a commit:

### Phase 1: Pre-Commit Verification & Audit

1. **Check Working Directory Status**:
   ```bash
   git status
   ```

2. **Run Verification & Unit Tests**:
   Before creating the commit, verify that the project builds and all tests pass:
   ```bash
   bun test
   ```
   *If tests fail, report the failure to the user and halt commit execution until resolved.*

3. **Analyze Staged & Unstaged Diff**:
   Review all modified, created, or deleted files to formulate a clear, high-level summary:
   ```bash
   git diff --stat
   ```

---

### Phase 2: Staging & Single Commit Execution

1. **Stage Target Files**:
   ```bash
   git add .
   ```

2. **Execute Single Consolidated Commit**:
   Draft a clean Conventional Commit message summarizing the primary feature, fix, or refactor:
   ```bash
   git commit -m "type(scope): concise description of changes"
   ```

   *For complex multi-file changes, include a technical summary body:*
   ```bash
   git commit -m "type(scope): concise description of changes

   - Detailed technical point 1
   - Detailed technical point 2"
   ```

---

### Phase 3: Confirmation & Reporting

Provide a clear summary report back to the user with the commit hash, commit message, and changed files summary.

---

## Allowed Types & Scopes

### Types
- `feat`: New feature or page
- `fix`: Bug fix
- `refactor`: Code restructuring without logic/feature changes
- `style`: MUI v9 `sx` prop migration, visual styling, formatting
- `docs`: Documentation updates
- `test`: Adding or modifying tests
- `chore`: Maintenance, config, or workflow updates

### Scopes
- `screenplay`, `ai`, `auth`, `ui`, `editor`, `store`, `actions`, `api`, `workflow`

---

## Usage

To trigger a manual single commit, type:

```text
/explicit-commit
```

Or ask directly in chat:
> *"Tolong commit perubahan ini"*
> *"Commit sekarang"*

---

*Explicit Commit Only Workflow v1.0.0 — Updated 2026-08-08*
