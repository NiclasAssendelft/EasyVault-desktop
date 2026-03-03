import { invoke } from "@tauri-apps/api/core";
import type { ActiveEditSession, FileStat, UiCallbacks } from "./types";
import { WATCH_DEBOUNCE_MS, WATCH_INTERVAL_MS } from "./config";
import { createNewVersion, sha256Hex, uploadViaChunkApi } from "./api";

export type StartAutoSyncInput = {
  fileId: string;
  filename: string;
  localPath: string;
  editSessionId: string;
  authToken: string;
  extensionToken: string;
};

let activeEdit: ActiveEditSession | null = null;

async function getFileStat(path: string): Promise<FileStat> {
  return invoke<FileStat>("get_file_stat", { path });
}

async function readFileBytes(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("read_file_bytes", { path });
  return new Uint8Array(bytes);
}

export function getActiveEditSession(): ActiveEditSession | null {
  return activeEdit;
}

export function stopActiveWatcher(): void {
  if (!activeEdit) return;
  if (activeEdit.intervalId !== null) window.clearInterval(activeEdit.intervalId);
  if (activeEdit.debounceId !== null) window.clearTimeout(activeEdit.debounceId);
  activeEdit = null;
}

export async function syncActiveFileNow(ui: UiCallbacks): Promise<void> {
  if (!activeEdit) return;
  if (activeEdit.uploading) {
    activeEdit.queued = true;
    return;
  }

  activeEdit.uploading = true;
  try {
    ui.onStatus("syncing...");
    const bytes = await readFileBytes(activeEdit.localPath);
    const checksum = await sha256Hex(bytes);
    const fileUrl = await uploadViaChunkApi(activeEdit, bytes);
    await createNewVersion(activeEdit, fileUrl, checksum);

    const syncedAt = new Date().toISOString();
    ui.onStatus("synced");
    ui.onLastSync(syncedAt);
    ui.onResult({
      used_file_id: activeEdit.fileId,
      local_path: activeEdit.localPath,
      file_url: fileUrl,
      edit_session_id: activeEdit.editSessionId,
      synced_at: syncedAt,
    });
  } catch (err) {
    ui.onStatus("sync error");
    ui.onResult({
      used_file_id: activeEdit.fileId,
      local_path: activeEdit.localPath,
      error: String(err),
    });
  } finally {
    if (activeEdit) {
      activeEdit.uploading = false;
      if (activeEdit.queued) {
        activeEdit.queued = false;
        void syncActiveFileNow(ui);
      }
    }
  }
}

export async function startAutoSync(session: StartAutoSyncInput, ui: UiCallbacks): Promise<void> {
  stopActiveWatcher();

  const stat = await getFileStat(session.localPath);
  activeEdit = {
    ...session,
    lastModifiedMs: stat.modified_ms,
    lastSize: stat.size,
    intervalId: null,
    debounceId: null,
    uploading: false,
    queued: false,
  };

  ui.onCurrentFile(`${session.filename} (${session.fileId})`);

  activeEdit.intervalId = window.setInterval(async () => {
    if (!activeEdit) return;

    try {
      const current = await getFileStat(activeEdit.localPath);
      const changed = current.modified_ms !== activeEdit.lastModifiedMs || current.size !== activeEdit.lastSize;
      if (!changed) return;

      activeEdit.lastModifiedMs = current.modified_ms;
      activeEdit.lastSize = current.size;

      if (activeEdit.debounceId !== null) {
        window.clearTimeout(activeEdit.debounceId);
      }

      ui.onStatus("change detected...");
      activeEdit.debounceId = window.setTimeout(() => {
        void syncActiveFileNow(ui);
      }, WATCH_DEBOUNCE_MS);
    } catch {
      // editors can lock files briefly while saving
    }
  }, WATCH_INTERVAL_MS);
}
