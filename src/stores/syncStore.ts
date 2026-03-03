import { create } from "zustand";
import type { EntityName } from "../services/helpers";

interface SyncState {
  lastDeltaSyncIso: string;
  remotePollId: number | null;
  remoteUpdatedAtByEntity: Record<string, Map<string, string>>;
  unsupportedFieldsByEntity: Record<EntityName, Set<string>>;
  schemaFieldsByEntity: Record<EntityName, Set<string> | null>;
  schemaLoadedAt: string;
  schemaVersion: string;
  schemaFunctionCount: number;
  setLastDeltaSyncIso: (iso: string) => void;
  setRemotePollId: (id: number | null) => void;
  setEntityUpdatedAt: (entity: string, id: string, updatedAtIso: string) => void;
  getEntityUpdatedAt: (entity: string, id: string) => string;
  removeEntityUpdatedAt: (entity: string, id: string) => void;
  clearEntityUpdatedAt: (entity: string) => void;
  isFieldSupported: (entity: EntityName, field: string) => boolean;
  sanitizePayload: (entity: EntityName, payload: Record<string, unknown>) => Record<string, unknown>;
  addUnsupportedField: (entity: EntityName, field: string) => void;
  setSchemaFields: (entity: EntityName, fields: Set<string>) => void;
  setSchemaInfo: (loadedAt: string, version: string, functionCount: number) => void;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  lastDeltaSyncIso: "",
  remotePollId: null,
  remoteUpdatedAtByEntity: {
    Folder: new Map<string, string>(),
    VaultItem: new Map<string, string>(),
    EmailItem: new Map<string, string>(),
    CalendarEvent: new Map<string, string>(),
    Space: new Map<string, string>(),
    GatherPack: new Map<string, string>(),
  },
  unsupportedFieldsByEntity: {
    Folder: new Set<string>(["notes", "is_favorite"]),
    VaultItem: new Set<string>(["is_important"]),
    EmailItem: new Set<string>(),
    CalendarEvent: new Set<string>(["is_pinned", "is_favorite"]),
    Space: new Set<string>(),
    GatherPack: new Set<string>(),
  },
  schemaFieldsByEntity: {
    Folder: null,
    VaultItem: null,
    EmailItem: null,
    CalendarEvent: null,
    Space: null,
    GatherPack: null,
  },
  schemaLoadedAt: "",
  schemaVersion: "",
  schemaFunctionCount: 0,
  setLastDeltaSyncIso: (iso) => set({ lastDeltaSyncIso: iso }),
  setRemotePollId: (id) => set({ remotePollId: id }),
  setEntityUpdatedAt: (entity, id, updatedAtIso) => {
    if (!id || !updatedAtIso) return;
    const map = get().remoteUpdatedAtByEntity[entity];
    if (map) map.set(id, updatedAtIso);
  },
  getEntityUpdatedAt: (entity, id) => {
    const map = get().remoteUpdatedAtByEntity[entity];
    return map?.get(id) || "";
  },
  removeEntityUpdatedAt: (entity, id) => {
    const map = get().remoteUpdatedAtByEntity[entity];
    if (map) map.delete(id);
  },
  clearEntityUpdatedAt: (entity) => {
    const map = get().remoteUpdatedAtByEntity[entity];
    if (map) map.clear();
  },
  isFieldSupported: (entity, field) => {
    const { schemaFieldsByEntity, unsupportedFieldsByEntity } = get();
    const schemaFields = schemaFieldsByEntity[entity];
    if (schemaFields && !schemaFields.has(field)) return false;
    return !unsupportedFieldsByEntity[entity].has(field);
  },
  sanitizePayload: (entity, payload) => {
    const blocked = get().unsupportedFieldsByEntity[entity];
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!blocked.has(key)) cleaned[key] = value;
    }
    return cleaned;
  },
  addUnsupportedField: (entity, field) => {
    get().unsupportedFieldsByEntity[entity].add(field);
  },
  setSchemaFields: (entity, fields) => {
    const next = { ...get().schemaFieldsByEntity };
    next[entity] = fields;
    set({ schemaFieldsByEntity: next });
  },
  setSchemaInfo: (loadedAt, version, functionCount) => {
    set({ schemaLoadedAt: loadedAt, schemaVersion: version, schemaFunctionCount: functionCount });
  },
}));
