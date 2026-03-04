import { entityList, entityFilter, entityDelete, callDeltaSync, invokeBase44Function } from "../api";
import { BACKEND } from "../config";
import { getAuthToken, getPreferredUploadToken, getSavedEmail } from "../storage";
import {
  asString, asBool, asArray, normalizeFolder, normalizeItem,
  isOnlyofficeRelayTempTitle, semverAtLeast,
  type FileItemType, type EntityName, type DesktopItem,
} from "./helpers";
import { canUseRemoteData } from "./entityService";
import { useAuthStore } from "../stores/authStore";
import { useFilesStore } from "../stores/filesStore";
import { useRemoteDataStore } from "../stores/remoteDataStore";
import { useSyncStore } from "../stores/syncStore";


function currentUserEmail(): string {
  return getSavedEmail().trim().toLowerCase();
}

function isOwnedByCurrentUser(row: Record<string, unknown>): boolean {
  const me = currentUserEmail();
  if (!me) return false;
  return asString(row.created_by).toLowerCase() === me;
}

/** Personal items must be owned by current user; shared-space items visible if space is accessible. */
function isOwnedOrInSharedSpace(row: Record<string, unknown>): boolean {
  const spaceId = asString(row.space_id);
  if (spaceId) return spaceAllowed(spaceId);
  return isOwnedByCurrentUser(row);
}

function spaceAllowed(spaceId: string): boolean {
  const { accessibleSpaceIds } = useAuthStore.getState();
  if (accessibleSpaceIds.length === 0) return true;
  return !spaceId || accessibleSpaceIds.includes(spaceId);
}

export async function refreshAccessScope(): Promise<void> {
  try {
    const payload = await invokeBase44Function<{ space_ids?: string[]; personal_space_id?: string }>("getAccessibleSpaces", {});
    const spaceIds = Array.isArray(payload?.space_ids) ? payload.space_ids : [];
    const personalId = asString(payload?.personal_space_id);
    useAuthStore.getState().setAccessScope(spaceIds, personalId);
  } catch {
    useAuthStore.getState().setAccessScope([], "");
  }
}

const relayTempCleanupInFlight = new Set<string>();

async function cleanupOnlyofficeRelayTempItems(items: DesktopItem[]): Promise<void> {
  const token = getPreferredUploadToken() || getAuthToken();
  if (!token) return;
  const tempItems = items.filter((x) => isOnlyofficeRelayTempTitle(x.title));
  if (tempItems.length === 0) return;
  let removed = 0;
  let failed = 0;
  for (const item of tempItems) {
    if (!item.id || relayTempCleanupInFlight.has(item.id)) continue;
    relayTempCleanupInFlight.add(item.id);
    try {
      await entityDelete("VaultItem", item.id, token);
      removed += 1;
    } catch {
      failed += 1;
    } finally {
      relayTempCleanupInFlight.delete(item.id);
    }
  }
  if (removed > 0 || failed > 0) {
    console.log(`relay temp cleanup: removed ${removed}, failed ${failed}`);
  }
}

export async function refreshFilesFromRemote(): Promise<void> {
  if (!canUseRemoteData()) return;
  await refreshAccessScope();
  try {
    const [folders, items] = await Promise.all([
      entityList<Record<string, unknown>>("Folder", "-created_date", 500),
      entityList<Record<string, unknown>>("VaultItem", "-updated_date", 1000),
    ]);

    const sync = useSyncStore.getState();
    const filesStore = useFilesStore.getState();

    const newFolders = folders
      .filter((row) => isOwnedOrInSharedSpace(row))
      .map((row) =>
        normalizeFolder({
          id: asString(row.id),
          name: asString(row.name, "Untitled folder"),
          createdAtIso: asString(row.created_date, new Date().toISOString()),
          updatedAtIso: asString(row.updated_date, asString(row.created_date, new Date().toISOString())),
          isPinned: asBool(row.is_pinned),
          spaceId: asString(row.space_id),
          createdBy: asString(row.created_by),
        })
      );
    sync.clearEntityUpdatedAt("Folder");
    for (const folder of newFolders) {
      sync.setEntityUpdatedAt("Folder", folder.id, folder.updatedAtIso || folder.createdAtIso);
    }

    const allItems = items
      .filter((row) => isOwnedOrInSharedSpace(row))
      .map((row) =>
        normalizeItem({
          id: asString(row.id),
          title: asString(row.title, "Untitled item"),
          itemType: asString(row.item_type, "note") as FileItemType,
          folderId: asString(row.folder_id),
          createdAtIso: asString(row.created_date, asString(row.updated_date, new Date().toISOString())),
          updatedAtIso: asString(row.updated_date, asString(row.created_date, new Date().toISOString())),
          notes: asString(row.notes),
          tags: asArray(row.tags),
          isPinned: asBool(row.is_pinned),
          isFavorite: asBool(row.is_favorite),
          storedFileUrl: asString(row.stored_file_url),
          sourceUrl: asString(row.source_url),
          localPath: asString(row.local_path),
          fileExtension: asString(row.file_extension),
          contentText: asString(row.content_text),
          spaceId: asString(row.space_id),
          createdBy: asString(row.created_by),
        })
      );

    // Delete ONLYOFFICE relay temp items from server, then filter them out locally
    void cleanupOnlyofficeRelayTempItems(allItems);
    const newItems = allItems.filter((x) => !isOnlyofficeRelayTempTitle(x.title));

    sync.clearEntityUpdatedAt("VaultItem");
    for (const item of newItems) {
      sync.setEntityUpdatedAt("VaultItem", item.id, item.updatedAtIso || item.createdAtIso);
    }

    filesStore.setFolders(newFolders);
    filesStore.setItems(newItems);
    filesStore.persist();
  } catch (err) {
    console.warn("remote files sync failed:", err);
  }
}

export async function refreshEmailFromRemote(): Promise<void> {
  if (!canUseRemoteData()) return;
  try {
    const data = await entityList<Record<string, unknown>>("EmailItem", "-received_at", 200);
    const emails = data.filter((row) => isOwnedByCurrentUser(row));
    const sync = useSyncStore.getState();
    sync.clearEntityUpdatedAt("EmailItem");
    for (const row of emails) {
      const id = asString(row.id);
      const updated = asString(row.updated_date, asString(row.created_date, ""));
      if (id && updated) sync.setEntityUpdatedAt("EmailItem", id, updated);
    }
    useRemoteDataStore.getState().setEmails(emails);
  } catch (err) {
    console.warn("email sync failed:", err);
  }
}

export async function refreshCalendarFromRemote(): Promise<void> {
  if (!canUseRemoteData()) return;
  try {
    const data = await entityList<Record<string, unknown>>("CalendarEvent", "start_time", 300);
    const events = data.filter((row) => isOwnedByCurrentUser(row));
    const sync = useSyncStore.getState();
    sync.clearEntityUpdatedAt("CalendarEvent");
    for (const row of events) {
      const id = asString(row.id);
      const updated = asString(row.updated_date, asString(row.created_date, ""));
      if (id && updated) sync.setEntityUpdatedAt("CalendarEvent", id, updated);
    }
    useRemoteDataStore.getState().setEvents(events);
  } catch (err) {
    console.warn("calendar sync failed:", err);
  }
}

export async function refreshVaultFromRemote(): Promise<void> {
  if (!canUseRemoteData()) return;
  try {
    const data = await entityList<Record<string, unknown>>("GatherPack", "-created_date", 100);
    const packs = data.filter((row) => isOwnedByCurrentUser(row));
    const sync = useSyncStore.getState();
    sync.clearEntityUpdatedAt("GatherPack");
    for (const row of packs) {
      const id = asString(row.id);
      const updated = asString(row.updated_date, asString(row.created_date, ""));
      if (id && updated) sync.setEntityUpdatedAt("GatherPack", id, updated);
    }
    useRemoteDataStore.getState().setPacks(packs);
  } catch (err) {
    console.warn("vault sync failed:", err);
  }
}

export async function refreshSharedFromRemote(): Promise<void> {
  if (!canUseRemoteData()) return;
  try {
    const spaces = await entityFilter<Record<string, unknown>>("Space", { space_type: "shared" }, "-created_date", 100);
    const me = currentUserEmail();
    const filtered = spaces.filter((row) => {
      if (!spaceAllowed(asString(row.id))) return false;
      if (!me) return true;
      if (asString(row.created_by).toLowerCase() === me) return true;
      const members = row.members;
      if (!Array.isArray(members)) return false;
      return members.some((m) => m && typeof m === "object" && asString((m as Record<string, unknown>).email).toLowerCase() === me);
    });
    const sync = useSyncStore.getState();
    sync.clearEntityUpdatedAt("Space");
    for (const row of filtered) {
      const id = asString(row.id);
      const updated = asString(row.updated_date, asString(row.created_date, ""));
      if (id && updated) sync.setEntityUpdatedAt("Space", id, updated);
    }
    useRemoteDataStore.getState().setSpaces(filtered);
  } catch (err) {
    console.warn("shared sync failed:", err);
  }
}

export async function refreshDropzoneFromRemote(): Promise<void> {
  if (!canUseRemoteData()) return;
  try {
    const items = await entityFilter<Record<string, unknown>>("VaultItem", { source: "local_upload" }, "-created_date", 30);
    const filtered = items.filter((row) => spaceAllowed(asString(row.space_id)) && isOwnedByCurrentUser(row));
    useRemoteDataStore.getState().setDropzoneItems(filtered);
  } catch (err) {
    console.warn("dropzone sync failed:", err);
  }
}

type EntitySchemasResponse = {
  version: string;
  app_id: string;
  generated_at: string;
  entities: Record<string, { required: string[]; properties: Record<string, { type: string }>; built_in_fields: Record<string, { type: string }>; operations: string[] }>;
  functions: Array<{ name: string; method: string; payload: object; returns: string; note?: string }>;
  auth: { note: string; entity_endpoint_pattern: string; function_endpoint_pattern: string };
};

function parseEntitySchemasPayload(payload: unknown): EntitySchemasResponse {
  if (!payload || typeof payload !== "object") throw new Error("entitySchemas payload is not an object");
  const obj = payload as Record<string, unknown>;
  if (typeof obj.version !== "string") throw new Error("entitySchemas.version missing");
  if (typeof obj.app_id !== "string") throw new Error("entitySchemas.app_id missing");
  if (typeof obj.generated_at !== "string") throw new Error("entitySchemas.generated_at missing");
  if (!obj.entities || typeof obj.entities !== "object") throw new Error("entitySchemas.entities missing");
  if (!Array.isArray(obj.functions)) throw new Error("entitySchemas.functions missing");
  if (!obj.auth || typeof obj.auth !== "object") throw new Error("entitySchemas.auth missing");
  const entities = obj.entities as Record<string, unknown>;
  for (const [name, rawDef] of Object.entries(entities)) {
    if (!rawDef || typeof rawDef !== "object") throw new Error(`entitySchemas.entities.${name} invalid`);
    const def = rawDef as Record<string, unknown>;
    if (!Array.isArray(def.required)) throw new Error(`entitySchemas.entities.${name}.required missing`);
    if (!def.properties || typeof def.properties !== "object") throw new Error(`entitySchemas.entities.${name}.properties missing`);
    if (!def.built_in_fields || typeof def.built_in_fields !== "object") throw new Error(`entitySchemas.entities.${name}.built_in_fields missing`);
    if (!Array.isArray(def.operations)) throw new Error(`entitySchemas.entities.${name}.operations missing`);
  }
  return obj as unknown as EntitySchemasResponse;
}

export async function refreshEntitySchemas(): Promise<void> {
  if (!canUseRemoteData()) return;
  // entitySchemas is a Base44-only endpoint; skip when using Supabase
  if (BACKEND === "supabase") return;
  const sync = useSyncStore.getState();
  try {
    const rawPayload = await invokeBase44Function<unknown>("entitySchemas", {});
    const payload = parseEntitySchemasPayload(rawPayload);
    if (!semverAtLeast(payload.version, "1.0.0")) {
      throw new Error(`Unsupported entitySchemas version: ${payload.version}`);
    }
    const entities: EntityName[] = ["Folder", "VaultItem", "EmailItem", "CalendarEvent", "Space", "GatherPack"];
    for (const entity of entities) {
      const entry = payload.entities[entity];
      if (!entry) {
        sync.setSchemaFields(entity, new Set<string>());
        continue;
      }
      sync.setSchemaFields(entity, new Set<string>(Object.keys(entry.properties || {})));
    }
    sync.setSchemaInfo(payload.generated_at, payload.version, payload.functions.length);
  } catch (err) {
    console.warn("entitySchemas parse failed:", err);
  }
}

export async function refreshAllRemoteData(): Promise<void> {
  await refreshAccessScope();
  await Promise.all([
    refreshFilesFromRemote(),
    refreshEmailFromRemote(),
    refreshCalendarFromRemote(),
    refreshVaultFromRemote(),
    refreshSharedFromRemote(),
    refreshDropzoneFromRemote(),
    refreshEntitySchemas(),
  ]);
}

export async function syncRemoteDelta(): Promise<void> {
  if (!canUseRemoteData()) return;
  const sync = useSyncStore.getState();
  try {
    const since = sync.lastDeltaSyncIso || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const result = await callDeltaSync(since);
    if (!result || typeof result !== "object") return;
    const obj = result as Record<string, unknown>;
    const serverTime = asString(obj.server_time);
    if (serverTime) sync.setLastDeltaSyncIso(serverTime);
    const changes = obj.changes as Record<string, { updated?: Record<string, unknown>[]; deleted?: { record_id: string }[] }> | undefined;
    if (!changes) return;

    const filesStore = useFilesStore.getState();
    const remoteData = useRemoteDataStore.getState();

    // Apply folder updates
    const folderChanges = changes.Folder;
    if (folderChanges) {
      if (Array.isArray(folderChanges.updated)) {
        for (const row of folderChanges.updated) {
          const id = asString(row.id);
          if (!id || !isOwnedOrInSharedSpace(row)) continue;
          const folder = normalizeFolder({
            id,
            name: asString(row.name, "Untitled folder"),
            createdAtIso: asString(row.created_date, new Date().toISOString()),
            updatedAtIso: asString(row.updated_date, asString(row.created_date, new Date().toISOString())),
            isPinned: asBool(row.is_pinned),
            spaceId: asString(row.space_id),
            createdBy: asString(row.created_by),
          });
          const exists = filesStore.folders.some((f) => f.id === id);
          if (exists) filesStore.updateFolder(id, folder);
          else filesStore.addFolder(folder);
          sync.setEntityUpdatedAt("Folder", id, folder.updatedAtIso || folder.createdAtIso);
        }
      }
      if (Array.isArray(folderChanges.deleted)) {
        for (const del of folderChanges.deleted) {
          filesStore.removeFolder(del.record_id);
          sync.removeEntityUpdatedAt("Folder", del.record_id);
        }
      }
    }

    // Apply VaultItem updates
    const itemChanges = changes.VaultItem;
    if (itemChanges) {
      if (Array.isArray(itemChanges.updated)) {
        for (const row of itemChanges.updated) {
          const id = asString(row.id);
          if (!id || !isOwnedOrInSharedSpace(row)) continue;
          if (isOnlyofficeRelayTempTitle(asString(row.title))) continue;
          const item = normalizeItem({
            id,
            title: asString(row.title, "Untitled item"),
            itemType: asString(row.item_type, "note") as FileItemType,
            folderId: asString(row.folder_id),
            createdAtIso: asString(row.created_date, new Date().toISOString()),
            updatedAtIso: asString(row.updated_date, asString(row.created_date, new Date().toISOString())),
            notes: asString(row.notes),
            tags: asArray(row.tags),
            isPinned: asBool(row.is_pinned),
            isFavorite: asBool(row.is_favorite),
            storedFileUrl: asString(row.stored_file_url),
            sourceUrl: asString(row.source_url),
            localPath: asString(row.local_path),
            fileExtension: asString(row.file_extension),
            contentText: asString(row.content_text),
            spaceId: asString(row.space_id),
            createdBy: asString(row.created_by),
          });
          const exists = useFilesStore.getState().items.some((i) => i.id === id);
          if (exists) useFilesStore.getState().updateItem(id, item);
          else useFilesStore.getState().addItem(item);
          sync.setEntityUpdatedAt("VaultItem", id, item.updatedAtIso || item.createdAtIso);
        }
      }
      if (Array.isArray(itemChanges.deleted)) {
        for (const del of itemChanges.deleted) {
          useFilesStore.getState().removeItem(del.record_id);
          sync.removeEntityUpdatedAt("VaultItem", del.record_id);
        }
      }
    }

    // Apply EmailItem updates
    const emailChanges = changes.EmailItem;
    if (emailChanges) {
      const emails = [...remoteData.emails];
      if (Array.isArray(emailChanges.updated)) {
        for (const row of emailChanges.updated) {
          const id = asString(row.id);
          if (!id || !isOwnedByCurrentUser(row)) continue;
          const idx = emails.findIndex((e) => asString(e.id) === id);
          if (idx >= 0) emails[idx] = row;
          else emails.unshift(row);
          sync.setEntityUpdatedAt("EmailItem", id, asString(row.updated_date, asString(row.created_date, "")));
        }
      }
      if (Array.isArray(emailChanges.deleted)) {
        for (const del of emailChanges.deleted) {
          const idx = emails.findIndex((e) => asString(e.id) === del.record_id);
          if (idx >= 0) emails.splice(idx, 1);
          sync.removeEntityUpdatedAt("EmailItem", del.record_id);
        }
      }
      remoteData.setEmails(emails);
    }

    // Apply CalendarEvent updates
    const eventChanges = changes.CalendarEvent;
    if (eventChanges) {
      const events = [...remoteData.events];
      if (Array.isArray(eventChanges.updated)) {
        for (const row of eventChanges.updated) {
          const id = asString(row.id);
          if (!id || !isOwnedByCurrentUser(row)) continue;
          const idx = events.findIndex((e) => asString(e.id) === id);
          if (idx >= 0) events[idx] = row;
          else events.unshift(row);
          sync.setEntityUpdatedAt("CalendarEvent", id, asString(row.updated_date, asString(row.created_date, "")));
        }
      }
      if (Array.isArray(eventChanges.deleted)) {
        for (const del of eventChanges.deleted) {
          const idx = events.findIndex((e) => asString(e.id) === del.record_id);
          if (idx >= 0) events.splice(idx, 1);
          sync.removeEntityUpdatedAt("CalendarEvent", del.record_id);
        }
      }
      remoteData.setEvents(events);
    }

    // Apply Space updates
    const spaceChanges = changes.Space;
    if (spaceChanges) {
      const spaces = [...remoteData.spaces];
      if (Array.isArray(spaceChanges.updated)) {
        for (const row of spaceChanges.updated) {
          const id = asString(row.id);
          if (!id || !spaceAllowed(id)) continue;
          if (asString(row.space_type) !== "shared") continue;
          const idx = spaces.findIndex((s) => asString(s.id) === id);
          if (idx >= 0) spaces[idx] = row;
          else spaces.unshift(row);
          sync.setEntityUpdatedAt("Space", id, asString(row.updated_date, asString(row.created_date, "")));
        }
      }
      if (Array.isArray(spaceChanges.deleted)) {
        for (const del of spaceChanges.deleted) {
          const idx = spaces.findIndex((s) => asString(s.id) === del.record_id);
          if (idx >= 0) spaces.splice(idx, 1);
          sync.removeEntityUpdatedAt("Space", del.record_id);
        }
      }
      remoteData.setSpaces(spaces);
    }

    // Apply GatherPack updates
    const packChanges = changes.GatherPack;
    if (packChanges) {
      const packs = [...remoteData.packs];
      if (Array.isArray(packChanges.updated)) {
        for (const row of packChanges.updated) {
          const id = asString(row.id);
          if (!id || !isOwnedByCurrentUser(row)) continue;
          const idx = packs.findIndex((p) => asString(p.id) === id);
          if (idx >= 0) packs[idx] = row;
          else packs.unshift(row);
          sync.setEntityUpdatedAt("GatherPack", id, asString(row.updated_date, asString(row.created_date, "")));
        }
      }
      if (Array.isArray(packChanges.deleted)) {
        for (const del of packChanges.deleted) {
          const idx = packs.findIndex((p) => asString(p.id) === del.record_id);
          if (idx >= 0) packs.splice(idx, 1);
          sync.removeEntityUpdatedAt("GatherPack", del.record_id);
        }
      }
      remoteData.setPacks(packs);
    }

    useFilesStore.getState().persist();
  } catch (err) {
    console.warn("delta sync failed:", err);
  }
}

let remotePollId: number | null = null;

export function startRemotePolling(): void {
  stopRemotePolling();
  remotePollId = window.setInterval(() => {
    void syncRemoteDelta();
  }, 15000);
}

export function stopRemotePolling(): void {
  if (remotePollId !== null) {
    window.clearInterval(remotePollId);
    remotePollId = null;
  }
}
