# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Frontend dev server (Vite on port 1420)
pnpm dev

# TypeScript check + Vite production build
pnpm build

# Full Tauri desktop app (dev mode with hot reload)
pnpm tauri dev

# Build distributable desktop app
pnpm tauri build

# Rust backend only (from src-tauri/)
cd src-tauri && cargo build
```

Package manager is **pnpm**. No test runner or linter is configured.

## Architecture

**Tauri v2 desktop app** — Rust backend + TypeScript frontend, bundled with Vite.

### Frontend (`src/`)

- **`main.ts`** (~4300 lines) — Monolithic file containing all UI rendering (DOM manipulation), state management (in-memory variables), event handlers, modals, and tab navigation. This is the main target for refactoring.
- **`api.ts`** — HTTP client for the Base44 backend. Uses `@tauri-apps/plugin-http` (not browser fetch). Handles entity CRUD, chunked file uploads (5MB chunks), checkout/lock, delta sync, and version management.
- **`config.ts`** — API URLs, storage keys, constants. App ID and default API key are hardcoded here.
- **`types.ts`** — Core TypeScript types (FileStat, CheckoutPayload, ActiveEditSession, ImportQueueItem).
- **`storage.ts`** — localStorage wrapper for auth tokens, settings, watch folder config.
- **`syncEngine.ts`** — File auto-sync: polls local file stat every 1.5s, debounces 2s, uploads changes via chunked API. Only one file can be actively synced at a time (`activeEdit` singleton).
- **`editors/`** — Pluggable `EditorAdapter` interface for document editing:
  - `office.onlyoffice.adapter.ts` — DOCX/XLSX/PPTX via self-hosted ONLYOFFICE
  - `pdf.nutrient.adapter.ts` — PDF preview via Nutrient
  - `image.pintura.adapter.ts` — Image editing (rotation, brightness) via canvas

### Backend (`src-tauri/src/`)

- **`lib.rs`** (~890 lines) — All Tauri IPC commands:
  - File I/O: `save_file_to_workspace`, `get_file_stat`, `read_file_bytes`
  - Watch folder: `get_default_watch_folder`, `list_folder_files`
  - **ONLYOFFICE callback relay**: Background HTTP server on port 17171 that receives ONLYOFFICE save callbacks, downloads the edited file, re-uploads to Base44 via chunked API, and commits the version. This is the most complex piece of backend logic.

### Backend API (Base44)

All remote data flows through Base44 cloud functions at `https://ceo-vault.base44.app/api/functions`. Key patterns:
- **Entity CRUD**: Generic `entityList`, `entityFilter`, `entityGet`, `entityCreate`, `entityUpdate`, `entityDelete` functions parameterized by entity name
- **Entities**: Folder, VaultItem, EmailItem, CalendarEvent, Space, GatherPack
- **Delta sync**: `deltaSync(sinceTimestamp)` returns changed entities since last sync; polled every 15s
- **Conflict detection**: `desktopSave` returns 409 on conflicts; `desktopDelete` for safe deletion
- **File upload flow**: `extensionUploadInit` → `extensionUploadChunk` (5MB parts) → `extensionUploadComplete`
- **File edit flow**: `fileCheckout` (acquire lock + download URL) → edit → upload → `fileVersions` or `onlyofficeCommit`

### ONLYOFFICE Deployment

Self-hosted ONLYOFFICE Document Server. Config in `ops/onlyoffice/` (Docker Compose + Caddy reverse proxy). Runbook at `docs/onlyoffice-remote-setup.md`. Requires JWT secret for document signing.

## Key Patterns

- **Auth**: Two tokens — `authToken` (from login) and `extensionToken` (user-configured). Extension token is preferred for uploads. Both sent as Bearer tokens or x-api-key headers depending on endpoint.
- **File workspace**: Files checked out for editing are saved to `~/EasyVault Workspace/{fileId}/{filename}`.
- **Watch folder**: Polls `~/Downloads/ToEasyVault` (configurable) for new files to auto-import. Deduplicates via SHA256 signatures stored in localStorage.
- **ONLYOFFICE relay auth**: Configured at runtime via `set_onlyoffice_relay_auth` Tauri command; relay stores tokens in a global `OnceLock<Mutex<>>`.

## TypeScript Configuration

Strict mode enabled with `noUnusedLocals` and `noUnusedParameters`. Target ES2020, bundler module resolution, no emit (Vite handles bundling).
