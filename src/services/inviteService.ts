// Invite deep-link handling.
//
// Parses `easyvault://invite/<token>` URLs (48-hex tokens from
// `space_invite_links`), redeems them via the `space-invite-link` edge
// function, and persists a pending token across login so an invite clicked
// before sign-in still lands after the user authenticates.
import { invokeEdgeFunction } from "../api";
import { STORAGE_KEYS } from "../config";
import { t } from "../i18n";
import { useAuthStore } from "../stores/authStore";
import { useRemoteDataStore } from "../stores/remoteDataStore";
import { useUiStore } from "../stores/uiStore";
import { refreshAccessScope, refreshSharedFromRemote } from "./deltaSyncService";

const TOKEN_RE = /^[0-9a-f]{48}$/;
const INVITE_URL_RE = /^easyvault:\/\/invite\/([0-9a-fA-F]{48})(?:[/?#].*)?$/;

/** HTTP statuses where retrying the same token can never succeed. */
const DEFINITIVE_REJECTIONS = new Set([400, 404, 410]);

/** Shown when the space name is unknown (e.g. legacy already-member 409s). */
const NAME_FALLBACK = "…";

interface JoinResponse {
  success?: boolean;
  space_id?: string;
  role?: string;
  // Additive backend fields — may be absent on older deployments.
  space_name?: string;
  already_member?: boolean;
}

/**
 * Window event fired whenever a pending invite token is stored, so an
 * already-mounted LoginScreen can show its banner (same window-event idiom as
 * "easyvault:scan-watch-folder").
 */
export const PENDING_INVITE_EVENT = "easyvault:pending-invite";

function setStatus(text: string): void {
  useUiStore.getState().setStatus(text);
}

function storePendingInvite(token: string): void {
  localStorage.setItem(STORAGE_KEYS.pendingInvite, token);
  window.dispatchEvent(new CustomEvent(PENDING_INVITE_EVENT));
}

function clearPendingInvite(): void {
  localStorage.removeItem(STORAGE_KEYS.pendingInvite);
}

/** Returns the stored pending invite token, or null when absent/malformed. */
export function getPendingInvite(): string | null {
  const stored = localStorage.getItem(STORAGE_KEYS.pendingInvite);
  if (!stored) return null;
  const token = stored.trim().toLowerCase();
  if (!TOKEN_RE.test(token)) {
    clearPendingInvite();
    return null;
  }
  return token;
}

/**
 * Handle an `easyvault://invite/<token>` deep link. Logged-in users redeem
 * immediately; logged-out users get the token stored so LoginScreen can show
 * its pending banner and WorkspaceLayout redeems it after sign-in.
 */
export function handleInviteUrl(url: string): void {
  const match = INVITE_URL_RE.exec(url.trim());
  if (!match) return;
  const token = match[1].toLowerCase();
  // Persist first so a redeem that dies mid-flight (network error) is retried
  // on next launch; redeemInvite clears it on success/definitive rejection.
  storePendingInvite(token);
  if (useAuthStore.getState().isLoggedIn) {
    void redeemInvite(token);
  }
}

// Dedupe concurrent redeems of the same token (StrictMode double-mount, or a
// cold-start deep link and the pending-storage path firing together).
let inFlight: Promise<void> | null = null;
let inFlightToken = "";

/**
 * Redeem an invite token: join the space, refresh access scope + shared
 * spaces, switch to the Workspaces tab, and surface a status message.
 * Pending storage is cleared on success and on definitive rejection
 * (expired/invalid); network failures keep it for retry on next launch.
 */
export function redeemInvite(token: string): Promise<void> {
  if (inFlight && inFlightToken === token) return inFlight;
  inFlightToken = token;
  inFlight = doRedeem(token).finally(() => {
    inFlight = null;
    inFlightToken = "";
  });
  return inFlight;
}

async function doRedeem(token: string): Promise<void> {
  if (!TOKEN_RE.test(token)) {
    clearPendingInvite();
    setStatus(t("invite.joinFailed", { error: "Invalid invite code" }));
    return;
  }

  let res: JoinResponse;
  try {
    res = await invokeEdgeFunction<JoinResponse>("spaceInviteLink", { action: "join", token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = parseHttpStatus(msg);
    if (status === 409) {
      // Legacy backend rejects re-joins with 409 — treat as idempotent success.
      clearPendingInvite();
      await finishJoin(undefined, undefined, true);
      return;
    }
    if (status !== null && DEFINITIVE_REJECTIONS.has(status)) {
      // Expired, maxed out, or unknown token — retrying can never succeed.
      clearPendingInvite();
    }
    // Network/auth/server errors keep the pending token for a later retry.
    setStatus(t("invite.joinFailed", { error: extractErrorDetail(msg) }));
    return;
  }

  clearPendingInvite();
  await finishJoin(res.space_id, res.space_name, res.already_member === true);
}

async function finishJoin(
  spaceId: string | undefined,
  spaceName: string | undefined,
  alreadyMember: boolean
): Promise<void> {
  try {
    await refreshAccessScope();
    await refreshSharedFromRemote();
  } catch (err) {
    // Delta-sync polling will converge shortly; don't block the happy path.
    console.warn("Post-join refresh failed:", err);
  }
  const name = spaceName || lookupSpaceName(spaceId) || NAME_FALLBACK;
  useUiStore.getState().setActiveTab("workspaces");
  setStatus(t(alreadyMember ? "invite.alreadyMember" : "invite.joined", { name }));
}

function lookupSpaceName(spaceId: string | undefined): string {
  if (!spaceId) return "";
  const space = useRemoteDataStore.getState().spaces.find((s) => String(s.id ?? "") === spaceId);
  return space ? String(space.name ?? "") : "";
}

function parseHttpStatus(message: string): number | null {
  const match = /failed \((\d{3})\)/.exec(message);
  return match ? Number(match[1]) : null;
}

/** Pull the server's `error`/`message` field out of an invokeEdgeFunction throw. */
function extractErrorDetail(message: string): string {
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart)) as { error?: unknown; message?: unknown };
      const detail = parsed.error ?? parsed.message;
      if (typeof detail === "string" && detail) return detail;
    } catch {
      // Not JSON — fall through to the raw message.
    }
  }
  return message.replace(/^Error:\s*/, "");
}

/** Redeem a token stored pre-login. Called once on WorkspaceLayout mount. */
export async function redeemPendingInvite(): Promise<void> {
  const token = getPendingInvite();
  if (!token) return;
  if (!useAuthStore.getState().isLoggedIn) return;
  await redeemInvite(token);
}
