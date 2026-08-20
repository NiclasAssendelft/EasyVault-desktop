# ONLYOFFICE Co-Editing — Design (approved 2026-08-20)

Vision gap #3. Today: one user at a time. Goal: teammates editing the same document simultaneously, with presence.

## Locked product decisions
1. **Join live + presence** — a second opener joins the same session; EasyVault shows who is in the document
2. **Comments + track changes ON**; in-document chat OFF (space chat already exists)
3. Co-editing mode left at ONLYOFFICE's default (`fast` = live cursors). Not pinned.

## Recon findings that drive this (file:line evidence in the recon output)
- 🔴 **PRIMARY BLOCKER** `onlyoffice-editor-session/index.ts:90-94`: `const sessionTs = Date.now().toString(36); const documentKey = ${fileId}_v${currentVersion}_${sessionTs}`. Per-request timestamp ⇒ every user gets a unique key ⇒ isolated sessions ⇒ last-writer-wins overwrite. ONLYOFFICE requires **the same key for all co-authors** and a **new key after each save** — `${fileId}_v${currentVersion}` satisfies both.
- The timestamp's stated reason ("reusing a key with a different signed URL causes file-cannot-be-accessed") is **obsolete**: `:99-109` now builds a stable **public** bucket URL. Likely a contributor to the long-standing "file cannot be accessed" bug.
- `onlyoffice-editor-session:177-186` writes `locked_by` unconditionally but **never checks it** — the lock is stale bookkeeping, not a mutex. Nothing actually blocks the second user today.
- 🔴 **SECURITY** `onlyoffice-callback`: `verify_jwt=false` AND no verification of ONLYOFFICE's outbox JWT on the body. Anyone can POST a forged status-2 with a `key` + `url` and have EasyVault download and commit it as a new version — unauthenticated remote file replacement. Must fix regardless of co-editing.
- Status 1 callbacks (the `users` array = live presence, `actions` = connect/disconnect) are received and **discarded** (`onlyoffice-callback:36`).
- Lock leaks: no TTL, no reaper, `callFileLock(...,"unlock")` has zero callers, status 6 (forcesave) commits but never clears the lock (`onlyoffice-commit:70`, `onlyoffice-callback:120`).
- No UI anywhere for "locked by X" — `DesktopItem` drops the columns; the 409 surfaces as *"file lock unavailable"*, blaming the system rather than naming the holder.
- `edit_session_id` bug: `file-checkout` stores a 21-char nanoid in `vault_items.edit_session_id` but the `edit_sessions` row gets a UUID PK — `file-versions:51-57` compares nanoid to uuid, never matches.
- ⚠️ ONLYOFFICE **Community Edition caps 20 simultaneous editing connections** (1 doc × 2 users = 2 connections); over the cap documents open read-only.

## Changes

### Migration `00020_coediting_presence.sql`
- `ALTER TABLE vault_items ADD COLUMN IF NOT EXISTS editing_users TEXT[] DEFAULT '{}'` — live co-authors, maintained by the callback. Chosen over the unused/broken `edit_sessions` table because delta-sync already ships `vault_items` rows (`select *`) to every member of the space, so presence propagates with zero new plumbing.
- No index needed (read with the row).

### Backend
**`onlyoffice-editor-session`**
- `documentKey = ${fileId}_v${currentVersion}` (drop `sessionTs`, drop the stale comment)
- Remove the unconditional `locked_by` write (co-editing has no exclusive holder). Office path no longer locks at all.
- `permissions.comment: true`, `permissions.review: true`; `customization.chat` stays `false`
- `editorConfig.user.id`: hash the email (ONLYOFFICE docs: id is visible to participants, should not carry sensitive data); `name` unchanged

**`onlyoffice-callback`** (and the equivalent path in the Rust relay)
- **Verify the ONLYOFFICE outbox JWT** on every inbound callback; reject unsigned/invalid. Secret = `ONLYOFFICE_JWT_SECRET`.
- **Status 1**: write the `users` array to `vault_items.editing_users` (presence). Empty array on last disconnect.
- **Status 2 and 6**: clear `editing_users`; clear `locked_by`/`locked_at` on **both** (fixes the forcesave leak) — same fix in `onlyoffice-commit`.
- Keep answering every callback `{"error":0}`.

### Frontend
- Carry `editing_users` (and `locked_by`/`locked_at`, currently dropped) through `normalizeItem` into `DesktopItem`.
- **Presence UI**: in the file list and the preview/edit modal, show avatars/initials of current editors ("Anna is editing"). Reuse `avatarColor`/`initials` from workspaceHelpers.
- **Native-open path keeps exclusive locks** (you cannot co-edit in Word/Preview). Replace the misleading *"file lock unavailable"* with a real "Locked by {{name}}" message, and add stale-lock takeover (a lock older than N hours is treated as abandoned).
- i18n: new keys × en/sv/fi.

## Deliberately out of scope
Pinning `coEditing.mode` · in-document chat · fixing the `edit_session_id` nanoid/uuid mismatch (dead code path; note it) · a stale-lock reaper job (client-side takeover covers it) · version-merge UI.

## Rollout
① migration ② backend functions ③ frontend. Backward compatible: old clients ignore `editing_users`; the key change affects only new sessions.

## Test plan
Two accounts, same document, simultaneously: both see each other's cursors and edits; comments and track-changes work; closing one leaves the other editing; the final save produces ONE new version containing both people's edits; presence clears on exit. Plus: a forged callback (no/invalid JWT) must be rejected.
