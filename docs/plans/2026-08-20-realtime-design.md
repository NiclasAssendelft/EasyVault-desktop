# Realtime (chat / tasks / comments) — Design (2026-08-20)

Vision gap #4. Replace polling with live updates so collaboration feels instant.

## Decisions (grounded in recon, not preference)

**Transport: `@supabase/realtime-js` standalone, lazy-loaded.**
- 56.6 KB min / **16.4 KB gzip**; exactly 2 runtime deps (`tslib`, `@supabase/phoenix`).
- NOT `@supabase/supabase-js` (213 KB / 55 KB gzip, 7+ transitive deps): five of its six sub-libraries duplicate `src/api.ts`, and critically its `auth-js` runs its **own `autoRefreshToken` loop against the same GoTrue refresh token** `refreshSupabaseToken()` (api.ts:224-246) rotates. Two loops on one refresh token ⇒ `Invalid Refresh Token: Already Used`.
- NOT hand-rolled: the library's `accessToken?: () => Promise<string|null>` option maps 1:1 onto the existing `ensureFreshToken()` (api.ts:261) — including its 30s buffer and `_refreshPromise` dedupe — and it already implements the 25s heartbeat, `[1000,2000,5000,10000]` reconnect backoff, per-channel rejoin state machine, push buffering, and auth-generation race guarding. Re-implementing that correctly is the expensive part, not the framing.
- Constructor REQUIRES `params.apikey` (anon key) or it throws.
- Lands in a new `vendor-realtime` chunk via one line in vite.config.ts's `manualChunks` (the matcher keys on the package name after the last `/node_modules/`, pnpm-safe). Loaded with `await import()` like pdfjs/mammoth, so initial JS is unchanged.

**No Tauri changes needed.** `app.security.csp` is `null` (no `connect-src` restriction) and the capability allowlist governs `plugin-http` only — native `WebSocket` is not gated. `wss://` is required (`ws://` would be blocked from the tauri origin); Supabase is wss-only anyway.

**Primitive: Postgres Changes for INSERT/UPDATE; delta-sync keeps DELETEs.**
- RLS **does** apply to Postgres Changes — verified on the live DB: `realtime.apply_rls` does `set_config('request.jwt.claims', …)` and switches role, so `public.auth_email()` (00006) evaluates correctly per subscriber. Requires `GRANT SELECT` to `authenticated`, which these tables have.
- ⚠️ **RLS does NOT apply to DELETE** ("no way for Postgres to verify a user has access to a deleted record") and DELETE payloads reach every subscriber on the channel; filtering DELETEs at all requires `REPLICA IDENTITY FULL`, which would then broadcast the whole old row. So we do NOT rely on the change feed for deletions — the existing delta-sync tombstone path (access-checked, already shipped, now space-aware) keeps handling them.
- Scaling note: Postgres Changes authorizes every event per subscriber; docs recommend Broadcast beyond ~3,000 concurrent subscribers on the same changes. Irrelevant at this team size, relevant if EasyVault grows.

**Free plan quotas:** 200 concurrent connections, 2M messages/month, 100 msg/s, 100 channels/connection, 5 presence calls/client/30s. Comfortable now; note the presence-call limit if we ever move co-editing presence to Realtime Presence.

## Scope

### Backend — migration `00021_realtime_publication.sql`
`ALTER PUBLICATION supabase_realtime ADD TABLE space_messages, space_tasks, file_comments;`
- Do NOT set `REPLICA IDENTITY FULL` (default identity keeps DELETE payloads to the PK only, minimising the RLS-exempt leak).
- Verify (and note in comments) that `authenticated` holds `SELECT` on all three — 00017 revoked anon everywhere but preserved the client tables.
- Do NOT publish `vault_items` in this pass: it changes on every upload/save/presence write, so a change feed there is high-volume and delta-sync already covers it.

### Frontend
- **`src/services/realtimeService.ts`** (new): lazily imports `RealtimeClient`, one shared socket, `channelFor(spaceId)` helpers, subscribe/unsubscribe by ref-count, `accessToken: () => ensureFreshToken()`, `params: { apikey: SUPABASE_ANON_KEY }`. Handles SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED, and degrades to the existing polling when the socket cannot connect (offline, blocked, quota) — Realtime is an accelerator, never the only path.
- **WorkspaceDetail**: chat (5s), tasks (10s) and events (30s) polls become Realtime subscriptions while the panel is open, with polling retained as fallback. Apply INSERT/UPDATE by id into the existing local state; ignore DELETE (delta-sync tombstones handle it).
- **FileActionModal**: comments poll (8s) → subscription on `file_comments` filtered by item.
- Keep `deltaSyncService`'s 15s poll unchanged — it covers files/emails/calendar/spaces AND tombstone reconciliation, which the change feed deliberately does not.

## Out of scope (deliberate)
Realtime Presence for co-editing (the `editing_users` column shipped and works; Presence has a 5-calls/30s client limit) · Broadcast/typing indicators · publishing `vault_items` · replacing the relay-stats, watch-folder or upload polls (local, not DB-backed).

## Test plan
Two windows, same space: a message sent in one appears in the other without waiting ~5s; task add/toggle likewise; comments likewise. Kill the network → falls back to polling, no errors, recovers on reconnect. Leave a space → channel unsubscribes (no leak). Token expiry mid-session → socket stays alive via the accessToken callback.
