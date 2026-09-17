---
description: Git Committer - Production-grade Conventional Commits workflow for prc_next
---

# Git Committer

Ensures every commit in the prc_next repository follows Conventional Commits standards.

## Purpose

Keep git history clean and scannable. Classify changes by standard type. Include technical context in body and task references in footer.

## Project Context

**Project**: `prc_next` — AI Filmmakers Copilot & Production Tools
**Stack**: Next.js 16, React 19, MUI v9, Firebase, Bun, TypeScript 6

## Commit Format

All commits must follow this format:

```
type(scope): subject

Optional body with technical details on why and what.

Optional footer with Refs #ID or BREAKING CHANGE.
```

## Types

| Type | When to Use |
|------|------------|
| `feat` | New feature or new page |
| `fix` | Bug fix |
| `docs` | Documentation only changes |
| `style` | Formatting, MUI sx migration, no logic change |
| `refactor` | Code restructuring that is not a fix or feature |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `build` | Build system or dependency changes (package.json, next.config.ts) |
| `ci` | CI/CD configuration changes |
| `chore` | Routine maintenance, cleanup |

## Scopes (prc_next)

| Scope | Covers |
|-------|--------|
| `auth` | Auth service, login/register pages, useAuth hook |
| `screenplay` | Screenplay editor, scenes, dialogs, screenplay store |
| `ai` | Generative service, AI models, AI bar, logline/scene generation |
| `ui` | Shared components, MUI theme, design system |
| `db` | Firebase Firestore, Firebase Admin, data models |
| `store` | Zustand stores (screenplay.store, etc.) |
| `api` | Route handlers in src/app/api/ |
| `actions` | Server Actions in src/lib/actions/ |
| `i18n` | next-intl translations, messages/ |
| `infra` | Docker, Dockerfile, apphosting.yaml, next.config.ts |
| `types` | TypeScript interfaces in src/types/ |
| `media` | Asset upload, image crop, S3, media processing |

## Execution Protocol

**Step 1: Technical Audit**
Run `git status` and `git diff --cached` to review actual changes. Identify if changes span multiple categories. If so, perform multi-commit.

**Step 2: Subject Line Rules**
- Use imperative mood: `add` not `added`, `fix` not `fixed`
- Maximum 72 characters
- Do not end with a period

**Step 3: Body and Footer**
- If changes are complex (>10 lines or touch core logic), include a body
- Separate subject and body with one blank line
- Use dashes for technical points in body

## Required Flags

- `--all` — commit all staged changes with auto-classification
- `--feat` — new feature
- `--fix` — bug fix
- `--docs` — documentation updates
- `--refactor` — code cleanup or restructuring
- `--style` — MUI v9 prop migration, formatting

Optional modifiers:
- `--push` — git push after commit
- `--skip-lint` — skip linting validation (emergencies only)

## Examples

Simple feature:
```
feat(screenplay): add logline auto-generation with gemini-flash-lite
```

MUI v9 migration:
```
style(ui): migrate Stack/Typography layout props to sx — MUI v9
```

Bug fix with body:
```
fix(ai): resolve fallback not triggering on Gemini 429 rate limit

- Primary model throws on rate limit, catch was too narrow
- Now catches all Error instances and triggers DeepInfra fallback
- Added structured logging for fallback events
```

Multi-commit:
```
fix(auth): type token param in syncUserFromToken as FirebaseTokenPayload
refactor(types): remove [key: string]: any from UserData, ScreenplayData
```

## Usage

```
/git-commiter --all --push
/git-commiter --fix --push
/git-commiter --feat
/git-commiter --style --push
```
