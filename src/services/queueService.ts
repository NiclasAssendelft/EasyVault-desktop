import { invoke } from "@tauri-apps/api/core";
import { uploadFileWithToken } from "../api";
import { getPreferredUploadToken, getWatchEnabled, getWatchFolder } from "../storage";
import { IMPORT_MAX_RETRIES, WATCH_FOLDER_POLL_MS } from "../config";
import { SUPPORTED_IMPORT_EXT, extOf, sleep } from "./helpers";
import { useQueueStore } from "../stores/queueStore";

import { canUseRemoteData } from "./entityService";
import { refreshDropzoneFromRemote, refreshFilesFromRemote } from "./deltaSyncService";
import type { LocalFolderFile } from "../types";

function fileSignature(file: LocalFolderFile): string {
  return `${file.path}|${file.size}|${file.modified_ms}`;
}

let lastScanErrorMsg = "";

/**
 * Per-item retry backoff: item id → epoch ms when the next attempt is due.
 * No entry = due now. Kept module-local (instead of on ImportQueueItem) so the
 * queue item type stays unchanged; entries are dropped when an item finishes.
 */
const retryDueAtMs = new Map<string, number>();

export async function scanWatchFolder(): Promise<void> {
  if (!getWatchEnabled()) return;
  const folder = getWatchFolder();
  if (!folder) return;
  let files: LocalFolderFile[];
  try {
    files = await invoke<LocalFolderFile[]>("list_folder_files", { path: folder });
    lastScanErrorMsg = "";
  } catch (err) {
    // Polled every 4s — log each distinct failure once instead of rejecting
    // unhandled (and spamming) every tick when the folder is unreadable.
    const msg = String(err);
    if (msg !== lastScanErrorMsg) {
      lastScanErrorMsg = msg;
      console.warn("watch folder scan failed:", msg);
    }
    return;
  }
  const store = useQueueStore.getState();
  for (const file of files) {
    if (!SUPPORTED_IMPORT_EXT.has(extOf(file.name))) continue;
    const sig = fileSignature(file);
    if (store.hasSignature(sig)) continue;
    if (store.items.some((x) => x.signature === sig && x.status !== "failed")) continue;
    store.addItem({
      id: crypto.randomUUID(),
      signature: sig,
      sourcePath: file.path,
      filename: file.name,
      status: "queued",
      attempts: 0,
      progress: 0,
      createdAtIso: new Date().toISOString(),
    });
  }
}

export async function processQueue(): Promise<void> {
  const store = useQueueStore.getState();
  if (store.isRunning) return;
  store.setIsRunning(true);
  try {
    while (true) {
      const pending = useQueueStore.getState().items.filter((x) => x.status === "queued" || x.status === "retrying");
      if (pending.length === 0) break;
      const now = Date.now();
      const item = pending.find((x) => (retryDueAtMs.get(x.id) ?? 0) <= now);
      if (!item) {
        // Every pending item is backing off. Wait a short slice and re-check
        // so a freshly queued file is picked up right away instead of being
        // blocked behind another file's backoff (head-of-line blocking).
        await sleep(1000);
        continue;
      }
      const uploadToken = getPreferredUploadToken();
      if (!uploadToken) { console.warn("queue paused: missing token"); break; }

      retryDueAtMs.delete(item.id);
      useQueueStore.getState().updateItem(item.id, { status: "uploading", attempts: item.attempts + 1, progress: 0, error: undefined });

      try {
        console.log(`uploading ${item.filename}...`);
        const numbers = await invoke<number[]>("read_file_bytes", { path: item.sourcePath });
        const bytes = new Uint8Array(numbers);
        await uploadFileWithToken(uploadToken, item.filename, bytes, (pct) => {
          useQueueStore.getState().updateItem(item.id, { progress: pct });
        });
        useQueueStore.getState().updateItem(item.id, { status: "done", progress: 100, finishedAtIso: new Date().toISOString() });
        useQueueStore.getState().markSignature(item.signature);
        console.log(`imported ${item.filename}`);
        if (canUseRemoteData()) {
          void refreshDropzoneFromRemote();
          void refreshFilesFromRemote();
        }
      } catch (err) {
        const attempts = (useQueueStore.getState().items.find((x) => x.id === item.id)?.attempts) || item.attempts + 1;
        if (attempts < IMPORT_MAX_RETRIES) {
          const backoffMs = Math.min(1000 * 2 ** (attempts - 1), 15000);
          retryDueAtMs.set(item.id, Date.now() + backoffMs);
          useQueueStore.getState().updateItem(item.id, { status: "retrying", error: String(err) });
          console.warn(`retrying ${item.filename} (${attempts}/${IMPORT_MAX_RETRIES})`);
        } else {
          useQueueStore.getState().updateItem(item.id, { status: "failed", error: String(err) });
          console.warn(`import failed: ${item.filename}`);
        }
      }
    }
  } finally {
    useQueueStore.getState().setIsRunning(false);
  }
}

let watchPollId: number | null = null;

export function startWatchPolling(): void {
  stopWatchPolling();
  if (!getWatchEnabled()) return;
  watchPollId = window.setInterval(() => { void scanWatchFolder(); }, WATCH_FOLDER_POLL_MS);
  void scanWatchFolder();
}

export function stopWatchPolling(): void {
  if (watchPollId !== null) {
    window.clearInterval(watchPollId);
    watchPollId = null;
  }
}
