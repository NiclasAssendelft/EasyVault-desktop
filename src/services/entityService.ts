import { entityCreate, entityUpdate, entityDelete, callDesktopSave, invokeBase44Function } from "../api";
import { getAuthToken } from "../storage";
import { asString, isNotFoundError, type EntityName } from "./helpers";
import { useSyncStore } from "../stores/syncStore";

export function extractUnsupportedFieldsFromError(err: unknown, payloadKeys: string[]): string[] {
  const text = String(err).toLowerCase();
  if (!text) return [];
  const matches = new Set<string>();
  for (const key of payloadKeys) {
    if (text.includes(`"${key.toLowerCase()}"`) || text.includes(`'${key.toLowerCase()}'`) || text.includes(` ${key.toLowerCase()} `)) {
      matches.add(key);
    }
  }
  if (!text.includes("unknown") && !text.includes("does not exist") && !text.includes("invalid") && !text.includes("column")) {
    return [];
  }
  return Array.from(matches);
}

export async function safeEntityCreate<T = Record<string, unknown>>(
  entity: EntityName,
  payload: Record<string, unknown>
): Promise<T> {
  const sync = useSyncStore.getState();
  let candidate = sync.sanitizePayload(entity, payload);
  while (true) {
    try {
      return await entityCreate<T>(entity, candidate);
    } catch (err) {
      const unsupported = extractUnsupportedFieldsFromError(err, Object.keys(candidate));
      if (unsupported.length === 0) throw err;
      for (const field of unsupported) sync.addUnsupportedField(entity, field);
      candidate = useSyncStore.getState().sanitizePayload(entity, candidate);
      if (Object.keys(candidate).length === 0) throw err;
    }
  }
}

export async function safeEntityUpdate(
  entity: EntityName,
  id: string,
  payload: Record<string, unknown>,
  expectedUpdatedAt?: string
): Promise<Record<string, unknown> | null> {
  const sync = useSyncStore.getState();
  let candidate = sync.sanitizePayload(entity, payload);
  const lastKnownUpdatedDate = expectedUpdatedAt || sync.getEntityUpdatedAt(entity, id);
  while (true) {
    try {
      if (lastKnownUpdatedDate) {
        const result = await callDesktopSave<Record<string, unknown>>(entity, id, candidate, lastKnownUpdatedDate);
        if (!result.ok) {
          const serverDate = result.serverUpdatedDate || "(unknown)";
          throw new Error(`conflict: record changed on server at ${serverDate}`);
        }
        const nextUpdatedAt = asString(result.record.updated_date, asString(result.record.created_date));
        if (nextUpdatedAt) sync.setEntityUpdatedAt(entity, id, nextUpdatedAt);
        return result.record;
      }
      await entityUpdate(entity, id, candidate);
      return null;
    } catch (err) {
      const unsupported = extractUnsupportedFieldsFromError(err, Object.keys(candidate));
      if (unsupported.length === 0) throw err;
      for (const field of unsupported) sync.addUnsupportedField(entity, field);
      candidate = useSyncStore.getState().sanitizePayload(entity, candidate);
      if (Object.keys(candidate).length === 0) return null;
    }
  }
}

export async function deleteRemoteEntity(entity: "Folder" | "VaultItem" | "EmailItem" | "CalendarEvent" | "Space", id: string): Promise<void> {
  let desktopDeleteErr: unknown = null;
  try {
    await invokeBase44Function("desktopDelete", { entity_name: entity, id });
    return;
  } catch (err) {
    desktopDeleteErr = err;
  }
  try {
    await entityDelete(entity, id);
  } catch (entityDeleteErr) {
    if (isNotFoundError(desktopDeleteErr) || isNotFoundError(entityDeleteErr)) {
      return;
    }
    throw new Error(
      `desktopDelete failed: ${String(desktopDeleteErr)} | entityDelete fallback failed: ${String(entityDeleteErr)}`
    );
  }
}

export function canUseRemoteData(): boolean {
  return Boolean(getAuthToken());
}
