import { callDesktopSave } from "../api";
import { getAuthToken } from "../storage";
import { useAuthStore } from "../stores/authStore";
import { useFilesStore } from "../stores/filesStore";
import { useRemoteDataStore } from "../stores/remoteDataStore";
import { useSyncStore } from "../stores/syncStore";

import { safeEntityCreate, deleteRemoteEntity, canUseRemoteData } from "./entityService";
import {
  refreshAllRemoteData,
  syncRemoteDelta,
  refreshFilesFromRemote,
} from "./deltaSyncService";
import { asString, sleep, type EntityName } from "./helpers";

// ---------------------------------------------------------------------------
// Capabilities report
// ---------------------------------------------------------------------------

export function getCapabilitiesReport(): string {
  const entities: EntityName[] = ["Folder", "VaultItem", "EmailItem", "CalendarEvent", "Space", "GatherPack"];
  const lines: string[] = [];

  const auth = useAuthStore.getState();
  const sync = useSyncStore.getState();
  const files = useFilesStore.getState();
  const remote = useRemoteDataStore.getState();

  lines.push("EasyVault Desktop Capabilities");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Auth token: ${getAuthToken() ? "present" : "missing"}`);
  lines.push(`Accessible spaces loaded: ${auth.accessibleSpaceIds.length}`);
  lines.push(`Personal space id: ${auth.personalSpaceId || "(none)"}`);
  lines.push(`Schema loaded: ${sync.schemaLoadedAt ? sync.schemaLoadedAt : "no"}`);
  lines.push(`Schema version: ${sync.schemaVersion || "unknown"}`);
  lines.push(`Schema functions: ${sync.schemaFunctionCount}`);
  lines.push("");

  for (const entity of entities) {
    const blocked = Array.from(sync.unsupportedFieldsByEntity[entity]);
    const schema = sync.schemaFieldsByEntity[entity];
    lines.push(`${entity}:`);
    lines.push(`  schema fields loaded: ${schema ? schema.size : 0}`);
    lines.push(`  unsupported fields: ${blocked.length === 0 ? "(none detected)" : blocked.join(", ")}`);
  }

  lines.push("");
  lines.push("Counts:");
  lines.push(`  folders=${files.folders.length}`);
  lines.push(`  files_items=${files.items.length}`);
  lines.push(`  emails=${remote.emails.length}`);
  lines.push(`  events=${remote.events.length}`);
  lines.push(`  packs=${remote.packs.length}`);
  lines.push(`  shared_spaces=${remote.spaces.length}`);
  lines.push(`  dropzone_items=${remote.dropzoneItems.length}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Sync health check
// ---------------------------------------------------------------------------

function pushHealthLine(lines: string[], ok: boolean, label: string, detail = ""): void {
  lines.push(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` -- ${detail}` : ""}`);
}

async function waitForCondition(
  predicate: () => boolean,
  attempts: number,
  delayMs: number,
  refresh?: () => Promise<void>,
): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return true;
    if (refresh) {
      try { await refresh(); } catch { /* ignore */ }
    }
    if (predicate()) return true;
    await sleep(delayMs);
  }
  return false;
}

export type SyncHealthResult = {
  passed: boolean;
  report: string;
  finishedAt: string;
};

export async function runSyncHealthCheck(): Promise<SyncHealthResult> {
  if (!canUseRemoteData()) {
    console.warn("sync health check requires login");
    return { passed: false, report: "FAIL: login required", finishedAt: new Date().toISOString() };
  }

  const sync = useSyncStore.getState();
  const auth = useAuthStore.getState();
  console.log("sync health check running...");

  const startedAt = Date.now();
  const lines: string[] = [];
  let createdFolderId = "";
  let createdItemId = "";
  const stamp = new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14);
  const folderName = `Desktop Sync Test ${stamp}`;
  let itemTitle = `Desktop Sync Item ${stamp}`;

  try {
    await refreshAllRemoteData();
    pushHealthLine(lines, true, "Baseline remote refresh");

    // --- Create folder ---
    const folderPayload: Record<string, unknown> = { name: folderName, parent_folder_id: "" };
    if (auth.personalSpaceId) folderPayload.space_id = auth.personalSpaceId;
    const createdFolder = await safeEntityCreate<Record<string, unknown>>("Folder", folderPayload);
    createdFolderId = asString(createdFolder.id);
    pushHealthLine(lines, Boolean(createdFolderId), "Create folder", createdFolderId || "missing id");
    if (!createdFolderId) throw new Error("create folder returned no id");

    await syncRemoteDelta();
    const folderVisible = useFilesStore.getState().folders.some((f) => f.id === createdFolderId);
    pushHealthLine(lines, folderVisible, "Folder appears after sync");
    if (!folderVisible) throw new Error("folder missing after sync");

    // --- Create item ---
    const itemPayload: Record<string, unknown> = {
      title: itemTitle,
      item_type: "note",
      folder_id: createdFolderId,
      source: "local_upload",
      content_text: "sync health payload",
      tags: ["sync-health-check"],
    };
    if (auth.personalSpaceId) itemPayload.space_id = auth.personalSpaceId;
    const createdItem = await safeEntityCreate<Record<string, unknown>>("VaultItem", itemPayload);
    createdItemId = asString(createdItem.id);
    pushHealthLine(lines, Boolean(createdItemId), "Create item in folder", createdItemId || "missing id");
    if (!createdItemId) throw new Error("create item returned no id");

    await syncRemoteDelta();
    const folderItemVisible = useFilesStore.getState().items.some((i) => i.id === createdItemId && i.folderId === createdFolderId);
    pushHealthLine(lines, folderItemVisible, "Item appears in folder after sync");
    if (!folderItemVisible) throw new Error("item missing in folder after sync");

    // --- Rename test ---
    itemTitle = `${itemTitle} Renamed`;
    const renameBaseline = sync.getEntityUpdatedAt("VaultItem", createdItemId);
    if (!renameBaseline) throw new Error("missing updated_date baseline before rename test");
    const renameWrite = await callDesktopSave<Record<string, unknown>>(
      "VaultItem",
      createdItemId,
      { title: itemTitle },
      renameBaseline,
    );
    if (!renameWrite.ok) throw new Error(`rename write conflicted at ${renameWrite.serverUpdatedDate}`);
    const renameUpdatedAt = asString(renameWrite.record.updated_date, asString(renameWrite.record.created_date, ""));
    if (renameUpdatedAt) useSyncStore.getState().setEntityUpdatedAt("VaultItem", createdItemId, renameUpdatedAt);
    await syncRemoteDelta();
    const renameVisible = useFilesStore.getState().items.some((i) => i.id === createdItemId && i.title === itemTitle);
    pushHealthLine(lines, renameVisible, "External rename propagates to desktop");
    if (!renameVisible) throw new Error("rename not visible after sync");

    // --- Conflict detection ---
    const staleUpdatedAt = useSyncStore.getState().getEntityUpdatedAt("VaultItem", createdItemId);
    if (!staleUpdatedAt) throw new Error("missing updated_date baseline before conflict test");
    const serverWrite = await callDesktopSave<Record<string, unknown>>(
      "VaultItem",
      createdItemId,
      { notes: `server-edit-${Date.now()}` },
      staleUpdatedAt,
    );
    if (!serverWrite.ok) throw new Error(`server write conflicted at ${serverWrite.serverUpdatedDate}`);
    const serverUpdatedAt = asString(serverWrite.record.updated_date, asString(serverWrite.record.created_date, ""));
    if (serverUpdatedAt) useSyncStore.getState().setEntityUpdatedAt("VaultItem", createdItemId, serverUpdatedAt);
    const conflict = await callDesktopSave("VaultItem", createdItemId, { notes: "desktop-stale-write" }, staleUpdatedAt);
    const conflictDetected = !conflict.ok && conflict.status === 409;
    pushHealthLine(lines, conflictDetected, "Conflict detection (desktopSave 409)");
    if (!conflictDetected) throw new Error("desktopSave conflict not detected");

    await syncRemoteDelta();

    // --- Delete item ---
    await deleteRemoteEntity("VaultItem", createdItemId);
    const deletedItemId = createdItemId;
    createdItemId = "";
    const itemDeleted = await waitForCondition(
      () => !useFilesStore.getState().items.some((i) => i.id === deletedItemId),
      8,
      400,
      async () => { await refreshFilesFromRemote(); },
    );
    pushHealthLine(lines, itemDeleted, "Item delete propagates");
    if (!itemDeleted) throw new Error("item still present after delete");

    // --- Delete folder ---
    await deleteRemoteEntity("Folder", createdFolderId);
    const deletedFolderId = createdFolderId;
    createdFolderId = "";
    const folderDeleted = await waitForCondition(
      () => !useFilesStore.getState().folders.some((f) => f.id === deletedFolderId),
      8,
      400,
      async () => { await refreshFilesFromRemote(); },
    );
    pushHealthLine(lines, folderDeleted, "Folder delete propagates");
    if (!folderDeleted) throw new Error("folder still present after delete");

    const durationMs = Date.now() - startedAt;
    lines.unshift(`Sync Health Check: PASS (${durationMs}ms)`);
    console.log("sync health check passed");

    const finishedAt = new Date().toISOString();
    return { passed: true, report: [`Finished: ${finishedAt}`, ...lines].join("\n"), finishedAt };
  } catch (err) {
    pushHealthLine(lines, false, "Run error", String(err));
    lines.unshift("Sync Health Check: FAIL");
    console.warn("sync health check failed:", err);

    const finishedAt = new Date().toISOString();
    return { passed: false, report: [`Finished: ${finishedAt}`, ...lines].join("\n"), finishedAt };
  } finally {
    if (createdItemId) {
      try { await deleteRemoteEntity("VaultItem", createdItemId); } catch { /* cleanup */ }
    }
    if (createdFolderId) {
      try { await deleteRemoteEntity("Folder", createdFolderId); } catch { /* cleanup */ }
    }
    try { await syncRemoteDelta(); } catch { /* cleanup */ }
  }
}
