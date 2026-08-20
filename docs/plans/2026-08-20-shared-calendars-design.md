# Shared Team Calendars — Design (approved 2026-08-20)

Vision gap #2 ("M365 but easier"): spaces already have files/chat/tasks/members; the calendar is still personal-only.

## Locked product decisions
1. **Both views, color-coded** — team events appear in the main Calendar tab (with per-space filter chips) AND in a new Calendar section inside each space
2. **Members create; edit/delete own; Owner edits/deletes anything** in their space
3. **EasyVault-only in v1** — no push to Outlook (needs `Calendars.ReadWrite` + re-consent); clean phase 2
4. Deferred: recurrence, timezones, RSVP/attendee state, two-way Outlook sync

## Recon findings that shaped this (all verified, file:line in the recon output)
- ✅ **SAFETY CONFIRMED**: `sync-outlook-calendar` is **upsert-only, zero delete/prune logic** — it can never wipe EasyVault-native rows. Team + mirrored events coexist safely in one table.
- ⚠️ **Correction to earlier assumption**: `calendar_events` is ALREADY read-write from the app (`CalendarTab.tsx:112-131` creates `provider:"manual"` events via `safeEntityCreate`; ManageModal/DeleteModal handle edit/delete). We are EXTENDING a working system.
- `calendar_events` is in `TABLE_MAP` → direct PostgREST + RLS, exactly like folders/vault_items. **No new edge function needed** (unlike tasks/chat).
- `start_time`/`end_time` are **TEXT**, not timestamptz. Do not disturb in v1.
- Outlook upsert key: `UNIQUE (provider, event_id, created_by)`; sync writes 10 columns and never `space_id` → synced rows always get `space_id = ''`.
- `desktop-save`/`desktop-delete` already have a `space_id` membership branch that is currently DEAD for calendar events — adding the column activates it (no change needed there).
- 🐛 **Latent bug to fix**: `delta-sync/index.ts` space-aware branch is hardcoded `["Folder","VaultItem","GatherPack","Session"]`; `CalendarEvent` falls into the personal-only `created_by` branch → a teammate's event would be filtered out client-side even with RLS allowing it. Also `GatherPack` uses `shared_space_id`, not `space_id` — that filter references a non-existent column.
- 🐛 `refreshCalendarFromRemote` (deltaSyncService.ts:232-257) pushes a DB-level `created_by = me` filter — same client-side blindness; must fetch owned OR space-scoped (mirror `refreshFilesFromRemote`'s owned+shared merge pattern).
- 🐛 Hardcoded untranslated `"Loading..."` at WorkspaceDetail.tsx:1091 and :1192 (`workspaces.loading` already exists at en.ts:659).

## Migration `00019_calendar_space_scope.sql`
(00018 may exist from other work — the builder verifies the next free number.)
1. `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS space_id TEXT DEFAULT ''` — sentinel `''` = personal, UUID-as-text = team event. TEXT (not FK/UUID) deliberately matches the folders/vault_items precedent so the established `space_id <> ''` RLS idiom applies verbatim (see 00004's empty-string-UUID-cast fix).
2. `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS all_day BOOLEAN DEFAULT false`
3. `CREATE INDEX IF NOT EXISTS idx_calendar_events_space ON calendar_events(space_id)`
4. **Replace** the single `calendar_events_all` FOR ALL policy with four (semantics per decision #2, all `(select auth_email())`-wrapped for initplan, all using the `space_id <> ''` guard):
   - `calendar_events_select`: `created_by = me OR (space_id <> '' AND space_id IN (SELECT space_id::text FROM space_members WHERE user_email = me))`
   - `calendar_events_insert` WITH CHECK: `created_by = me AND (space_id = '' OR space_id IN (member spaces))` — mirrors the 00016 claim-any-space hole fix
   - `calendar_events_update` USING+WITH CHECK: `created_by = me OR (space_id <> '' AND space_id::uuid IN (SELECT user_owner_space_ids()))` — reuse the 00017 SECURITY DEFINER helper (guard the cast with `space_id <> ''`)
   - `calendar_events_delete` USING: same as update
   - RECURSION INVARIANT (00016/00017 header): fine here — calendar policies may reference `space_members` directly (chain terminates); never reference `calendar_events` itself.
5. No `color` column — space colors are derived client-side from `space_id`.

## Backend
- `delta-sync/index.ts`: add `CalendarEvent` to the space-aware entity branch; fix `GatherPack` to filter on `shared_space_id`. Keep response shapes.
- Nothing else. No new edge function.

## Frontend
- **`spaceColor(spaceId)`** helper (services/helpers.ts): deterministic hash → fixed accessible palette (8-10 hues, WCAG-safe on the dark surface). Same space = same color app-wide, no storage.
- **`refreshCalendarFromRemote`**: fetch owned (`created_by = me`) + per-space (`space_id = <id>` for each accessible space), merge by id — mirror `refreshFilesFromRemote`.
- **CalendarTab**: filter chips (`All · Personal · <space>…`, reuse `.links-filter-pill` styling); event rows show a color dot + space name; create form gains a space picker (default Personal); Edit/Delete rendered only when permitted (own event OR owner of its space).
- **New space Calendar section** (8th tab, existing `IconCalendar`): follow the Tasks-panel pattern exactly (add-row → loading → empty state → list). Register in the 4 coupled places: `SectionId` union (workspaceTypes.ts:55), `sections` useMemo (WorkspaceDetail.tsx:489-497), tab strip (:520-527), body chain (:529-636). Data via entity CRUD filtered by `space_id` — no edge function.
- **Space Overview**: surface next events in the 2×2 preview grid (builder picks the layout that keeps it balanced).
- **Permission helpers**: `canEditEvent(event)` = `created_by === me || isOwnerOfSpace(event.space_id)`.
- Fix the two hardcoded `"Loading..."` strings → `tr("workspaces.loading")`.

## i18n (en/sv/fi, natural not machine-literal)
`calendar.allSpaces`, `calendar.personal`, `calendar.space`, `calendar.allDay`, `calendar.addToSpace`, `workspaces.calendarTab`, `workspaces.noEvents`, `workspaces.addEvent`, `workspaces.eventTitle`, `workspaces.eventAddFailed`, `workspaces.eventDeleteFailed`, `workspaces.nextEvents` (+ any the builders need; single i18n owner adds all three locales, parity enforced by tsc).

## Edge cases
Outlook-mirrored rows keep `space_id = ''` (sync never writes it) → unaffected by every new policy · deleting a space leaves orphan events with a dead `space_id` (acceptable v1; they simply stop being visible to non-creators — note as follow-up) · an event whose space you left disappears from your view but is not deleted · `all_day` events sort by `start_time` like any other.

## Test & rollout
tsc + build + i18n parity + manual matrix (create personal event / create team event / second account sees it / member edits own / owner edits another's / member cannot edit another's). Rollout: ① migration ② deploy delta-sync ③ frontend release. Backward compatible: old clients ignore `space_id` and keep working with personal events.
