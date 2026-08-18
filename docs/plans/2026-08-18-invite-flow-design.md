# Invite / Sharing Flow — Design (approved 2026-08-18)

Core promise: share a link → teammate clicks → they're in the space. "Easier than SharePoint."

## Locked product decisions
1. **Link = instant access** (safety = expiry + revocation, not approval)
2. **Two roles only: Owner + Member** (DB keeps `owner|editor|viewer` values; `editor` displays as "Member"; `viewer` merged into `editor` by migration; no role pickers anywhere)
3. **Web page → app**: invite link is an HTTPS page with "Open in EasyVault" (deep link) + download buttons; invite survives signup
4. **7-day default expiry**, revocable anytime

## Interface contracts (all builders conform to these)

- **Invite URL**: `${SUPABASE_FUNCTIONS_URL}/invite/<token>` (token = existing 48-hex from `space_invite_links`)
- **Deep link**: `easyvault://invite/<token>` — scheme `easyvault` registered via `plugins.deep-link.desktop.schemes` in `tauri.conf.json`
- **Pending invite storage**: `localStorage["easyvault_pending_invite"]` = bare token string; constant added to `STORAGE_KEYS` in `src/config.ts` as `pendingInvite`
- **New service `src/services/inviteService.ts`**:
  - `handleInviteUrl(url: string): void` — parses `easyvault://invite/<token>`; if logged in → `redeemInvite(token)`, else store pending + no-op (LoginScreen shows banner)
  - `redeemInvite(token: string): Promise<void>` — `invokeEdgeFunction("spaceInviteLink", { action: "join", token })` → on success `refreshAccessScope()` + `refreshSharedFromRemote()` → `setActiveTab("workspaces")` → status `t("invite.joined", { name })`; idempotent already-member → `t("invite.alreadyMember", …)`; failure → `t("invite.joinFailed", { error })`; always clears pending storage on success/known-failure
  - `getPendingInvite(): string | null`, `redeemPendingInvite(): Promise<void>` (called on WorkspaceLayout mount)
- **Deep-link wiring** (WorkspaceLayout mount): `getCurrentDeepLink()` (cold start) + `onOpenUrl` (running) → `handleInviteUrl`. Dev-mode caveat: scheme only registered by installed builds; paste-code fallback covers dev testing.
- **`space-invite-link` edge function**: `create` defaults `expires_hours: 168` and role `editor` when unspecified; `join` rate-limited (existing `_shared/rateLimit.ts`) and atomically increments `use_count`; response shapes unchanged (`{success, link}` / `{success, space_id, role}`)
- **New edge function `invite`** (deployed `--no-verify-jwt`): `GET …/invite/<token>` → hosted HTML page (vault-dark styling, precedent: `password-recover`): space name + inviter, **Open in EasyVault** (`easyvault://invite/<token>`), platform-aware download buttons (existing `desktop-download?asset=…`), token shown as manual code fallback. Read-only — never increments `use_count`. Invalid/expired → friendly expired page.
- **Share dialog** (WorkspaceDetail, owner-only): opens → auto-creates Member link (168h) → shows full invite URL, copy button, "expires {{date}}", list of active links w/ Revoke (delete via existing RLS/edge path). Fixes live bug: read token from `res.link.token` (not `res.token`).

## i18n keys (exact; en/sv/fi all three)
`invite.pendingBanner` "Sign in to join “{{name}}”" · `invite.joined` "You've joined “{{name}}”" · `invite.alreadyMember` "You're already a member of “{{name}}”" · `invite.joinFailed` "Couldn't join: {{error}}" · `workspaces.share` "Share" · `workspaces.shareTitle` "Share “{{name}}”" · `workspaces.shareDesc` "Anyone with this link joins as a member. Link expires in 7 days." · `workspaces.shareCopy` "Copy link" · `workspaces.shareCopied` "Copied!" · `workspaces.shareActive` "Active links" · `workspaces.shareNoLinks` "No active links" · `workspaces.shareRevoke` "Revoke" · `workspaces.shareExpires` "Expires {{date}}" · `workspaces.roleOwner` "Owner" · `workspaces.roleMember` "Member" (reuse existing keys where identical ones already exist)

## Backend migration `00016_invite_flow_hardening.sql`
1. `UPDATE space_members SET role='editor' WHERE role='viewer';` + rewrite `viewer`→`editor` inside `spaces.members` JSONB mirror
2. `spaces_update` policy → owner-only again: creator OR `space_members` row with `role='owner'` (00002 regression let any member update)
3. `folders`/`vault_items` INSERT `WITH CHECK` tightened: `created_by = (select auth_email())` AND (`space_id = ''` OR space_id ∈ member spaces OR space_id ∈ own created spaces) — closes the claim-any-space injection hole; the own-created-spaces arm keeps personal-space uploads safe even without a bootstrap membership row
4. Consolidate `space_members` duplicate permissive policies (advisor item): distinct SELECT/INSERT/UPDATE/DELETE policies, `(select auth_email())` wrapping for the initplan perf fix; semantics preserved (members see own row; creator manages all; creator self-bootstrap insert)

## Edge cases
Expired/revoked/maxed token → same friendly message web + in-app · already-member → idempotent open · cold-start deep link handled · web page never consumes tokens · join rate-limited · emails lowercase everywhere (existing invariant)

## Test & rollout
Backend via curl scripts; frontend manual matrix (member / no-account / no-app × mac/win) + `pnpm typecheck` + CI. Rollout: ① migration ② deploy `invite` (--no-verify-jwt) + `space-invite-link` ③ frontend 0.3.11. Each step backward-compatible; paste-code path untouched.

## Deferred (explicitly)
Collapse `spaces.members` JSONB ↔ `space_members` dual bookkeeping to table-only · pending/approval invite states · email delivery of invites · viewer role resurrection if ever needed
