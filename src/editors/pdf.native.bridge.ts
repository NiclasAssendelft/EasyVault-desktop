import { checkoutFile as apiCheckout, downloadFile as apiDownload } from "../api";
import { getAuthToken, getPreferredUploadToken } from "../storage";
import { startAutoSync as syncStart } from "../syncEngine";

export type CheckoutResult = {
  download_url: string;
  edit_session_id: string;
};

/**
 * Try to checkout (acquire lock + get edit session). If checkout fails (e.g.
 * 403 for files owned by a service account), return null so the caller can
 * fall back to a direct download without auto-sync.
 */
export async function tryCheckout(fileId: string): Promise<CheckoutResult | null> {
  const tokens = [getPreferredUploadToken(), getAuthToken()].filter(Boolean) as string[];
  if (tokens.length === 0) throw new Error("Not authenticated");

  for (const token of tokens) {
    try {
      const result = await apiCheckout(fileId, token);
      return { download_url: result.download_url, edit_session_id: result.edit_session_id };
    } catch {
      // try next token
    }
  }
  return null;
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
      onLastSync: (iso) => setStatus(`Last sync: ${iso}`),
    },
  );
}
