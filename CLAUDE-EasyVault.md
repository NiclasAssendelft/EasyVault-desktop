# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Frontend dev server (Vite on port 1420, strictPort)
pnpm dev

# TypeScript check + Vite production build (tsc && vite build)
pnpm build

# Preview the production build
pnpm preview

# Full Tauri desktop app (dev mode with hot reload)
pnpm tauri dev

# Build distributable desktop app (all targets)
pnpm tauri build

# Cut a release: bumps version in package.json + tauri.conf.json,
# commits, tags v<ver>, pushes (the tag triggers CI release build)
pnpm release patch        # or minor | major | x.y.z
```

Package manager is **pnpm** (`pnpm-lock.yaml`; CI uses pnpm v9). **No test runner and no linter are configured** — there is no `test`/`lint` script, no vitest/jest/playwright, and no ESLint/Prettier config. The only static checking is the TypeScript compiler (`tsc`) invoked by `pnpm build`.

## Architecture

**Tauri v2 desktop app** — a Rust backend (`src-tauri/`) plus a **React 19 SPA** frontend (`src/`) bundled with Vite 6, state via Zustand v5, TypeScript ~5.6. App is `EasyVault`, identifier `com.niclas.easyvault`.

> The backend is **Supabase-only** in the live code. Base44 survives only as legacy traces (HTTP allowlist entries, legacy 24-hex file-id parsing, a vestigial `DEFAULT_API_KEY`). There is **no `BACKEND` switch** in `src/config.ts` or `src/api.ts`, and **no `main.ts` monolith** — older docs/memory describing either are stale.

## Frontend (`src/`)

React SPA. Entry: `index.html` (`<div id="app">`) → `src/main.tsx` (`createRoot` in `<StrictMode>`, imports `styles.css`) → `src/App.tsx`. `App.tsx` reads `isLoggedIn` from `useAuthStore` and renders `<WorkspaceLayout />` (logged in) or `<LoginScreen />`. On mount it registers `setAutoLogoutHandler(() => logout())` so a failed token refresh logs the user out.

### App shell — `components/WorkspaceLayout.tsx` (~341 lines)
Hosts the logged-in shell: `<Sidebar />`, header (with inline `GlobalSearch` and `LocaleDropdown` components), `<UpdateBanner />`, an `<ErrorBoundary>` wrapping the active tab, and a status bar. On mount it wires the app's long-running side effects:
- `useDeltaSync()` — starts/stops 15s remote delta polling.
- ONLYOFFICE: `setupOnlyofficeLocalRelay()` and exposes `window.EasyVaultEditors.onlyofficeLaunch(fileId)` → `launchOnlyofficeEditor`.
- Auto-update: `useUpdateStore.checkForUpdate(true)` on mount + every 6h.
- Watch folder: `startWatchPolling()`/`stopWatchPolling()`; listens for `easyvault:scan-watch-folder` window event → `scanWatchFolder().then(processQueue)`; auto-runs `processQueue()` when any queue item is `queued`.
- Outlook auto-sync on mount + daily at 07:00 (`outlookStatus`, then `syncOutlookEmails`, `syncOutlookCalendar`, then refresh).

`GlobalSearch` (⌘K / Ctrl+K to focus) searches files, emails and spaces (max 10). `ErrorBoundary` (`components/ErrorBoundary.tsx`) is a class component wrapping only the active-tab area with a "Something went wrong" / Try again / Reload fallback.

### Navigation, tabs, modals (all lazy-loaded)
Active tab lives in `useUiStore` (`activeTab`/`setActiveTab`, type `TabName`). `Sidebar.tsx` renders 9 nav buttons. `WorkspaceLayout` maps tab keys → `React.lazy` components via `TAB_COMPONENTS`; on tab change `TAB_REFRESH` calls the matching `refresh*FromRemote` from `deltaSyncService`. Note nav key `queue` maps to `DropzoneTab` (label `nav.dropzone`).

- **Tabs** (`components/tabs/`): `HomeTab`, `FilesTab` (Drive-like browser, multi-select, bulk actions), `EmailTab`, `CalendarTab`, `VaultTab`, `LinksTab`, `DropzoneTab` (watch-folder ingestion queue), `SettingsTab` (Outlook connect/disconnect, locale, email sync count).
- **Workspaces** (`components/tabs/workspaces/`): `WorkspacesTab` (lazy `workspaces` tab), `WorkspaceDetail` (~971 lines — Overview/Files/Chat/Tasks/Activity/Settings), plus `workspaceHelpers.ts` / `workspaceTypes.ts`.
- **Modals** (`components/modals/`, open-state from `useUiStore`): `NewModal`, `SaveLinkModal`, `ImportLinksModal`, `ManageModal`, `DeleteModal`, `FileActionModal`, `PreviewEditModal` (hosts `TranslatePanel`, dispatches editor adapters).
- **Lists** (`components/lists/`): `FolderCard`, `ItemRow`, `LinkRow` (select-mode aware).

### Editor adapters (`src/editors/`)
`PreviewEditModal.tsx` selects an adapter via `adapterForKind(kind)` (`SupportedEditorKind = "pdf" | "image" | "office"`). The `EditorAdapter` interface (`types.ts`) is `canEdit / openPreview / openEditor / save`; backend ops are dependency-injected through `AdapterSaveContext` (checkout, download, upload, version helpers). Note the filenames are misleading:
- `office.onlyoffice.adapter.ts` — real ONLYOFFICE integration via the `window.EasyVaultEditors` bridge (gated on `featureFlags.onlyoffice`); `save()` is a no-op (saves go out-of-band via the relay).
- `image.pintura.adapter.ts` — **not** the Pintura SDK; a hand-rolled canvas rotate/brightness editor. `save()` redraws to canvas → PNG → upload + new version.
- `pdf.nutrient.adapter.ts` — **not** Nutrient/PSPDFKit; preview via **PDF.js**, edit via "open in native OS app". `pdf.native.bridge.ts` does `tryCheckout` → Tauri `download_and_save_to_workspace` → `openPath` → `startAutoSync`. `save()` is a no-op (edits flow through file-watch auto-sync).

### Services (`src/services/`)
Services run outside React, mutate stores via `useXStore.getState()`, and call `api.ts`.
- `helpers.ts` — shared types (`DesktopItem`, `DesktopFolder`, `EntityName`, `TabName`) and pure utils (normalizers, `formatRelativeTime`, file-kind helpers).
- `entityService.ts` — schema-aware writes. `safeEntityCreate/Update` sanitize payloads via `syncStore` and **retry**, learning unsupported columns from error strings (adaptive-schema tolerance for the evolving Supabase schema). `safeEntityUpdate` does optimistic concurrency via `callDesktopSave` + `expectedUpdatedAt`. `canUseRemoteData()` gates on `getAuthToken()`.
- `deltaSyncService.ts` (~518 lines) — remote→local sync + **user-scoping**. `isOwnedOrInSharedSpace(row)` checks ownership (`created_by` lowercased == current email) **first**, then `spaceAllowed(space_id)`. Per-entity refreshers push DB-level `created_by` filters; `refreshEmailFromRemote()` returns a `db=X owned=X me="email"` diagnostic string. `syncRemoteDelta()` applies incremental `callDeltaSync` changes; `startRemotePolling()` runs it every **15000ms**.
- `fileOps.ts` — interactive uploads: optimistic temp item → `uploadFileWithToken` → `safeEntityCreate("VaultItem", { source:"local_upload" })` → replace temp → refresh.
- `queueService.ts` — watch-folder import queue. `scanWatchFolder()` (Tauri `list_folder_files`, filter `SUPPORTED_IMPORT_EXT`, dedupe by signature) → `processQueue()` (single-runner, exponential backoff up to `IMPORT_MAX_RETRIES`). Polls every `WATCH_FOLDER_POLL_MS`.
- `onlyofficeService.ts` — ONLYOFFICE launch + cross-origin relay (see below).
- `textExtractService.ts` — lazy `pdfjs-dist` / `mammoth` text extraction for the translate panel.

### Stores (`src/stores/`)
Zustand v5, no middleware; persistence is hand-rolled via `localStorage`.
- `authStore.ts` — `isLoggedIn`, `email`, `accessibleSpaceIds`, `personalSpaceId`. Login/signup **lowercase-normalize email** before saving (the RLS email-case fix).
- `filesStore.ts` — offline-first `folders`/`items` cache (localStorage-seeded, immutable updates, `persist()`).
- `remoteDataStore.ts` — `emails`/`events` (localStorage-cached) + `packs`/`spaces`/`dropzoneItems` (in-memory).
- `syncStore.ts` — sync bookkeeping: `lastDeltaSyncIso`, per-entity updated-at maps (optimistic concurrency), and adaptive-schema state (`sanitizePayload`, `addUnsupportedField`, seeded known-unsupported fields).
- `queueStore.ts` — import-queue items + uploaded signatures.
- `previewEditStore.ts` — preview/edit panel + ONLYOFFICE editor state (relay callback URLs, poll timer, baseline version count).
- `uiStore.ts` — `activeTab` (default `home`), `statusText` (auto-reverts to `idle` after 3s), modal flags/targets.
- `updateStore.ts` — Tauri auto-updater state machine (`idle|checking|up-to-date|available|downloading|installing|ready-restart|failed`).

### Hooks (`src/hooks/`)
Only two: `useDeltaSync()` (mount → `refreshAllRemoteData()` + `startRemotePolling()`; unmount → stop) and `useEscapeClose(open, close)` (Escape closes modals).

### i18n (`src/i18n/`)
Languages **en / sv / fi** (`index.ts` + `en.ts`/`sv.ts`/`fi.ts`). `en.ts` is the source of truth (~722 flat dot-namespaced keys; `TranslationKeys = keyof typeof en`). `useLocaleStore` persists locale to `localStorage["easyvault_locale"]`. Use `useT()` in components (re-renders on switch) and the bare `t(key, vars?)` function in non-React contexts. Supports `{{var}}` interpolation and `_one`/`_other` pluralization on `vars.count`; missing keys return the key string.

### `api.ts` — Supabase API layer (~762 lines)
Uses `@tauri-apps/plugin-http` (`tauriFetch`) for all entity CRUD, edge-function calls, and file ops (bypasses browser CORS). Browser `fetch` (`credentials:"omit"`) is used **only** for the three GoTrue auth calls: `login`, `signup`, `refreshSupabaseToken`.

- **`TABLE_MAP`** (14 entities → PostgREST tables, e.g. `Folder→folders`, `VaultItem→vault_items`, `Space→spaces`). Entity CRUD (`entityList/Filter/Get/Create/Update/Delete`) hits `/rest/v1/<table>` with the user JWT as Bearer + `apikey`. `entityCreate` injects `created_by = emailFromJwt(token)` (except `space_members`/`item_tags`). `mapSupabaseRecord` reconciles DB `created_at`/`updated_at` → app `created_date`/`updated_date`. Filters are equality-only (`eq`); default limit 200.
- **`EDGE_FUNCTION_MAP`** (30 logical names → deployed slugs, e.g. `deltaSync→delta-sync`, `desktopSave→desktop-save`, `onlyofficeEditorSession→onlyoffice-editor-session`, `syncOutlookEmails→sync-outlook-emails`). `invokeEdgeFunction(name, body)` POSTs to `/functions/v1/<slug>` with the **anon key as Bearer** and the **user token in the JSON body** (server-side `resolveUser()` validates it). Throws if the logical name is unmapped.
- **Conflict-aware save**: `callDesktopSave` returns `{ok:true, record}` or, on HTTP 409, `{ok:false, status:409, currentRecord, serverUpdatedDate}` (optimistic concurrency via `last_known_updated_date`).
- **File flow**: `checkoutFile` (`file-checkout`, sends `device_id`) → `downloadFile` → edit → chunked `uploadFileWithToken` (init/chunk/complete) → `createNewVersion` (`file-versions`). `extractFileUrl`/`extractUploadId` scan many key spellings for inconsistent backend responses. `sha256Hex` for version checksums.
- **JWT auto-refresh**: `ensureFreshToken()` returns the JWT if `exp` is >30s away, else refreshes; concurrent calls deduped via a singleton `_refreshPromise`. On refresh failure, `triggerAutoLogout()` fires the registered handler.

### `config.ts` (~28 lines, all hardcoded)
- `SUPABASE_URL = https://ocokoemfmdodzftqbjim.supabase.co`, `SUPABASE_FUNCTIONS_URL`, and a hardcoded `SUPABASE_ANON_KEY` (anon JWT).
- `CHUNK_SIZE = 5 MiB`; watch timing `WATCH_INTERVAL_MS=1500`, `WATCH_DEBOUNCE_MS=2000`, `WATCH_FOLDER_POLL_MS=4000`; `IMPORT_MAX_RETRIES=5`.
- `STORAGE_KEYS` — all `easyvault_`-prefixed localStorage keys.
- ONLYOFFICE defaults (`http://89.167.67.171:8080`, JWT secret) and `getEmailSyncCount()` live in `storage.ts`, not `config.ts`.

## Dual Backend (Supabase)

All remote data flows through Supabase, split two ways (see `api.ts`):
- **PostgREST** (`/rest/v1/<table>`) — all entity CRUD, via `TABLE_MAP`, with user JWT + `apikey`.
- **Edge Functions** (`/functions/v1/<slug>`) — everything custom (delta sync, conflict-aware save, file ops, chunked uploads, ONLYOFFICE, AI, email/calendar/Outlook sync, spaces/collaboration), via `EDGE_FUNCTION_MAP`.

**Edge function source does NOT live in this repo** — `supabase/functions/` here is empty. The ~37 functions live in the separate backend repo `/Users/Niclas/Documents/easyvault-backend/supabase/functions/` (`delta-sync`, `desktop-save/delete`, `onlyoffice-*`, `outlook-*`, `sync-*`, `get-accessible-spaces`, `space-*`, `upload-*`, `file-*`, `translate-text`, etc.).

## Rust / Tauri backend (`src-tauri/`)

`src/main.rs` (6 lines) calls `easyvault_lib::run()`. All logic is in **`src/lib.rs` (~1167 lines, single file, no tests)**. (Note: `tauri.conf.json` version is 0.3.10 but `Cargo.toml` is 0.3.0 — the Cargo version is likely stale; `pnpm release` syncs `package.json` + `tauri.conf.json`.)

### IPC commands (`#[tauri::command]`, 12 total)
File I/O: `save_file_to_workspace` (sanitizes ids/names, writes to `$HOME/EasyVault Workspace/{file_id}/{filename}`), `download_and_save_to_workspace` (blocking reqwest GET straight to disk), `get_file_stat`, `read_file_bytes`. Watch folder: `get_default_watch_folder` (`$HOME/Downloads/ToEasyVault`), `list_folder_files`. Misc: `fetch_page_title` (link bookmarking), `fetch_text` (CORS-bypass GET). ONLYOFFICE: `get_onlyoffice_relay_info`, `get_onlyoffice_relay_stats`, `set_onlyoffice_relay_auth` (stores the user JWT in a global `OnceLock<Mutex<Option<RelayAuth>>>`), `store_onlyoffice_editor_config` (keyed by a pseudo-random session id, ≤5 entries).

Tauri plugins (all v2): `opener`, `updater`, `deep-link`, `http`. Deps include `tiny_http`, `reqwest` (blocking, rustls-tls), `sha2`, `hex`. Capability allowlist (`capabilities/default.json`) restricts `opener:allow-open-path` to the workspace and allows HTTP to `*.supabase.co`, the Hetzner ONLYOFFICE server `http://89.167.67.171:*`, `http://localhost:*`, `login.microsoftonline.com`, and legacy Base44 hosts. **`SUPABASE_ANON_KEY` is hardcoded in `lib.rs`** (matches the frontend pattern).

### ONLYOFFICE callback relay
A `tiny_http` server started **before** the Tauri builder on a dedicated thread, binding `0.0.0.0:17171` (`ONLYOFFICE_RELAY_PORT_DEFAULT`, overridable via `EASYVAULT_ONLYOFFICE_RELAY_PORT`). Routes: `GET /health`; `GET /editor?id=…` (serves an inline HTML shell that loads `{documentServerUrl}/web-apps/apps/api/documents/api.js`, instantiates `DocsAPI.DocEditor`, and relays editor events to the parent via `postMessage`); `GET /editor-config?id=…`; `POST /onlyoffice-callback`.

For local-ish callback URLs with **status 2 or 6** (save), the relay handles the save end-to-end in Rust: requires the stored relay auth token, downloads edited bytes (rewriting `host.docker.internal`→`localhost`), uploads via the chunked Supabase pipeline (`upload-init/chunk/complete`, 5 MiB chunks), then commits via `onlyoffice-commit` (falling back to `file-versions` with a SHA-256 checksum). Non-local/other callbacks are proxied upstream to the `onlyoffice-callback` edge function. Print/export artifacts and non-vault keys are gracefully acked with `{"error":0}`.

### Auto-updater
`tauri.conf.json` → `plugins.updater`: `createUpdaterArtifacts: true` (generates `.sig` + `latest.json`), single endpoint `https://ocokoemfmdodzftqbjim.supabase.co/functions/v1/desktop-update`, minisign `pubkey` embedded.

## ONLYOFFICE deployment (`ops/onlyoffice/`)
Self-hosted ONLYOFFICE Document Server.
- `docker-compose.yml` (production): `onlyoffice/documentserver:latest` (JWT enabled, secret from `${ONLYOFFICE_JWT_SECRET}`) behind a `caddy:2` reverse proxy on ports 80/443 with auto-TLS. Domain/email from `.env` (`Caddyfile`).
- `docker-compose.local.yml`: Mac dev variant on `localhost:80`, no Caddy/HTTPS. **Contains a committed dev JWT secret** — do not reuse in production.
- `check.sh` verifies the server + callback; runbook at `docs/onlyoffice-remote-setup.md` (note: that runbook still references Base44 env/callback and is likely stale post-migration).

In the desktop app, the editor loads `http://localhost:17171/editor?id=<sessionId>` inside an iframe so ONLYOFFICE `api.js` (which wipes `window.__TAURI_INTERNALS__`) is sandboxed by Same-Origin Policy from `tauri://localhost`. The relay polls `get_onlyoffice_relay_stats` every 1500ms and triggers a delta sync on a detected save.

## Key Patterns

- **Auth tokens** (`storage.ts`): `authToken` (Supabase user JWT) + `refreshToken` (GoTrue) + a long-lived `extensionToken`. Edge functions prefer the extension token, then the auth token (`getPreferredUploadToken`). `getDeviceId()` persists an `ev-<uuid>` device id sent on checkout.
- **JWT refresh**: `ensureFreshToken()` (30s buffer, deduped via `_refreshPromise`); refresh failure auto-logs-out.
- **User scoping / ownership filter** (`deltaSyncService.ts`): ownership (`created_by` lowercased == current email) is checked **before** the space gate; enforced client-side *and* via DB `created_by` filters (security + LIMIT-exhaustion mitigation). Email is lowercase-normalized on login/signup so `created_by` matches RLS `auth_email()`.
- **File workspace**: checked-out files live in `~/EasyVault Workspace/{fileId}/{filename}`.
- **Watch folder**: polls `~/Downloads/ToEasyVault` (configurable), deduping by SHA-256 signatures (`path|size|modified_ms`) in localStorage.
- **File auto-sync** (`syncEngine.ts`): a single `activeEdit` session polls file stat every `WATCH_INTERVAL_MS` (1500ms), debounces `WATCH_DEBOUNCE_MS` (2000ms), then SHA-256 + chunked upload + `createNewVersion`; coalesces concurrent saves via an `uploading`/`queued` flag.
- **Optimistic concurrency** spans `entityService` (`callDesktopSave` + `expectedUpdatedAt`), `syncStore` (updated-at maps), and `uiStore` (manage-target baseline).

## Distribution / CI-CD

- **`.github/workflows/release.yml`** (job name `Release`) triggers on `v*` tag push (`contents: write`). Single `build` job, `fail-fast: false`, **4-entry matrix**: macOS ARM (`aarch64-apple-darwin`), macOS Intel (`x86_64-apple-darwin`), Linux (`ubuntu-22.04`), Windows. Steps: checkout → pnpm v9 → Node 20 → `dtolnay/rust-toolchain@stable` + `swatinem/rust-cache` → Ubuntu webkit deps → `pnpm install` → `tauri-apps/tauri-action@v0`. Secrets: `GITHUB_TOKEN`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Publishes a non-draft GitHub Release (`.dmg` ARM/Intel, Windows `.msi`, Linux `.AppImage`/`.deb`) plus an `install.sh` one-liner.
- **`scripts/release.mjs`** (`pnpm release`) bumps the version in both `package.json` and `src-tauri/tauri.conf.json`, commits, tags `v<ver>`, and pushes (the tag is what kicks off CI).
- **Auto-updater**: `updateStore.ts` (frontend) + the Tauri updater plugin check `desktop-update` for `latest.json`; `UpdateBanner` shows available/downloading/installing/ready-restart/failed states, with a platform-aware manual-download fallback (`EasyVault_{v}_aarch64.dmg` / `_x64.dmg` / `_x64-setup.exe`).

## TypeScript Configuration

`tsconfig.json`: `target ES2020`, `module ESNext`, `jsx: react-jsx`, bundler `moduleResolution` (`allowImportingTsExtensions`, `noEmit`, `isolatedModules`). Strict mode on (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`); `include: ["src"]`. Vite (`vite.config.ts`, `@vitejs/plugin-react`) serves on port 1420 / HMR 1421, ignores `src-tauri/`, and splits vendor chunks `vendor-react` (react/scheduler), `vendor-tauri` (`@tauri-apps`), `vendor-zustand`, `vendor-docs` (`pdfjs-dist`/`mammoth`).
