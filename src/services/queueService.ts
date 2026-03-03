import { invoke } from "@tauri-apps/api/core";
import { uploadFileWithToken } from "../api";
import { getPreferredUploadToken, getWatchEnabled, getWatchFolder, getUploadedWatchSignatures, saveUploadedWatchSignatures } from "../storage";
import { IMPORT_MAX_RETRIES, WATCH_FOLDER_POLL_MS } from "../config";
import { SUPPORTED_IMPORT_EXT, extOf, sleep } from "./helpers";
import { useQueueStore } from "../stores/queueStore";
import { useUiStore } from "../stores/uiStore";
import { canUseRemoteData } from "./entityService";
import { refreshDropzoneFromRemote, refreshFilesFromRemote } from "./deltaSyncService";
import type { LocalFolderFile } from "../types";

function fileSignature(file: LocalFolderFile): string {
  return `${file.path}|${file.size}|${file.modified_ms}`;
}

export async function scanWatchFolder(): Promise<void> {
  if (!getWatchEnabled()) return;
  const folder = getWatchFolder();
  if (!folder) return;
  const files = await invoke<LocalFolderFile[]>("list_folder_files", { path: folder });
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
  const setStatus = useUiStore.getState().setStatus;
  try {
    while (true) {
      const item = useQueueStore.getState().items.find((x) => x.status === "queued" || x.status === "retrying");
      if (!item) break;
      const uploadToken = getPreferredUploadToken();
      if (!uploadToken) { setStatus("queue paused: missing token"); break; }

      useQueueStore.getState().updateItem(item.id, { status: "uploading", attempts: item.attempts + 1, progress: 0, error: undefined });

      try {
        setStatus(`uploading ${item.filename}...`);
        const numbers = await invoke<number[]>("read_file_bytes", { path: item.sourcePath });
        const bytes = new Uint8Array(numbers);
        await uploadFileWithToken(uploadToken, item.filename, bytes, (pct) => {
          useQueueStore.getState().updateItem(item.id, { progress: pct });
        });
        useQueueStore.getState().updateItem(item.id, { status: "done", progress: 100, finishedAtIso: new Date().toISOString() });
        useQueueStore.getState().markSignature(item.signature);
        const sigs = getUploadedWatchSignatures();
        sigs.add(item.signature);
        saveUploadedWatchSignatures(sigs);
        setStatus(`imported ${item.filename}`);
        if (canUseRemoteData()) {
          void refreshDropzoneFromRemote();
          void refreshFilesFromRemote();
        }
      } catch (err) {
        const attempts = (useQueueStore.getState().items.find((x) => x.id === item.id)?.attempts) || item.attempts + 1;
        if (attempts < IMPORT_MAX_RETRIES) {
          useQueueStore.getState().updateItem(item.id, { status: "retrying", error: String(err) });
          setStatus(`retrying ${item.filename} (${attempts}/${IMPORT_MAX_RETRIES})`);
          await sleep(Math.min(1000 * 2 ** (attempts - 1), 15000));
          useQueueStore.getState().updateItem(item.id, { status: "queued" });
        } else {
          useQueueStore.getState().updateItem(item.id, { status: "failed", error: String(err) });
          setStatus(`failed ${item.filename}`);
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
