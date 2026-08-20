import { checkoutFile as apiCheckout, downloadFile as apiDownload } from "../api";
import { getAuthToken, getPreferredUploadToken } from "../storage";
import { startAutoSync as syncStart } from "../syncEngine";
import { useFilesStore } from "../stores/filesStore";
import { isLockStale, parseLockConflict, resolveLockInfo } from "../services/helpers";
import type { LockInfo } from "../services/helpers";

export type CheckoutResult = {
  download_url: string;
  edit_session_id: string;
};

/**
 * What happened when we tried to take the file out for a native-app edit.
 *
 * The native path (Word, Preview, Acrobat) cannot co-edit, so it keeps the
 * exclusive lock ONLYOFFICE no longer needs — but a lock nobody ever released
 * must not brick the file forever, hence `takeover`.
 */
export type CheckoutOutcome =
  /** Lock acquired; edits auto-sync under a real edit session. */
  | { status: "ok"; checkout: CheckoutResult }
  /** Lock held but abandoned (older than `LOCK_STALE_MS`) — open read-write anyway. */
  | { status: "takeover"; lockedBy: string; lockedAt: string }
  /** Someone is genuinely holding the file — open read-only and name them. */
  | { status: "locked"; lockedBy: string; lockedAt: string }
  /** Checkout refused for a non-lock reason (403 service-account files, …). */
  | { status: "unavailable" };

/**
 * Try to check the file out (acquire lock + get an edit session).
 *
 * This is the one choke point where the native-open lock policy is decided, so
 * the stale-lock takeover threshold is applied here rather than in each editor
 * adapter: every caller gets the same answer for the same lock.
 */
export async function tryCheckout(fileId: string): Promise<CheckoutOutcome> {
  const tokens = Array.from(
    new Set([getPreferredUploadToken(), getAuthToken()].filter(Boolean) as string[]),
  );
  if (tokens.length === 0) throw new Error("Not authenticated");

  let conflict: LockInfo | null = null;
  for (const token of tokens) {
    try {
      const result = await apiCheckout(fileId, token);
      return {
        status: "ok",
        checkout: { download_url: result.download_url, edit_session_id: result.edit_session_id },
      };
    } catch (err) {
      // Remember a lock conflict; any other failure just moves to the next token.
      conflict = parseLockConflict(err) || conflict;
    }
  }

  if (!conflict) return { status: "unavailable" };

  const { lockedBy, lockedAt } = resolveLockInfo(conflict, fileId, useFilesStore.getState().items);
  if (isLockStale(lockedAt)) return { status: "takeover", lockedBy, lockedAt };
  return { status: "locked", lockedBy, lockedAt };
}

export async function downloadFile(url: string): Promise<Uint8Array> {
  return apiDownload(url);
}

export async function startAutoSync(
  session: {
    fileId: string;
    filename: string;
    localPath: string;
    editSessionId: string;
  },
  setStatus: (text: string) => void,
): Promise<void> {
  const authToken = getAuthToken() || "";
  const extensionToken = getPreferredUploadToken() || authToken;
  await syncStart(
    {
      fileId: session.fileId,
      filename: session.filename,
      localPath: session.localPath,
      editSessionId: session.editSessionId,
      authToken,
      extensionToken,
    },
    {
      onStatus: setStatus,
      onResult: () => {},
      onCurrentFile: () => {},
      onLastSync: (iso) => console.log(`Last sync: ${iso}`),
    },
  );
}
