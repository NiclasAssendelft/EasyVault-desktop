import { entityCreate, entityUpdate, entityDelete, callDesktopSave, invokeEdgeFunction } from "../api";
import { getAuthToken } from "../storage";
import { asString, isNotFoundError, type EntityName } from "./helpers";
import { useSyncStore } from "../stores/syncStore";

/**
 * Fields the adaptive-schema retry loop must NEVER learn as "unsupported".
 *
 * The loop exists to tolerate an evolving Supabase schema: when an error names
 * a column, that field is remembered as unsupported (STICKY for the whole
 * session — in-memory, cleared only on logout) and the write is retried
 * without it. Harmless for cosmetic columns (`is_pinned`, `is_favorite`);
 * catastrophic for columns that carry meaning.
 *
 * FAILURE MODE this guards — silent team→personal downgrade: for a few minutes
 * after a migration adds a column, PostgREST answers
 *   PGRST204: Could not find the 'space_id' column of 'calendar_events'
 *             in the schema cache
 * (a routine Supabase schema-cache blip). That message contains "column" and
 * the single-quoted extractor matches `space_id`, so the loop would learn it,
 * strip it, and retry — creating a PERSONAL event while the UI reports
 * success, and silently downgrading every team event for the rest of the
 * session. `space_id` on Folder/VaultItem is the same bug class (a file meant
 * for a shared space silently lands in the personal one), and CalendarEvent's
 * `all_day` is too (an all-day event silently becomes a midnight
 * point-in-time event). For these, fail loudly instead of writing wrong data.
 */
const NEVER_STRIP_ANY_ENTITY: ReadonlySet<string> = new Set(["space_id"]);

/** Per-entity additions to NEVER_STRIP_ANY_ENTITY. */
const NEVER_STRIP_BY_ENTITY: Partial<Record<EntityName, ReadonlySet<string>>> = {
  CalendarEvent: new Set(["all_day"]),
};

function neverStripFields(entity: EntityName, fields: string[]): string[] {
  const perEntity = NEVER_STRIP_BY_ENTITY[entity];
  return fields.filter((field) => NEVER_STRIP_ANY_ENTITY.has(field) || Boolean(perEntity?.has(field)));
}

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
      const loadBearing = neverStripFields(entity, unsupported);
      if (loadBearing.length > 0) {
        // Stripping these would silently write semantically different data
        // (e.g. a team event created as personal). Surface the real error —
        // a visible failure the user can retry beats silent wrong data.
        console.warn(`${entity} write blamed load-bearing field(s) ${loadBearing.join(", ")}; refusing to strip and retry`, err);
        throw err;
      }
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
      const loadBearing = neverStripFields(entity, unsupported);
      if (loadBearing.length > 0) {
        // Same guard as safeEntityCreate: retrying without these would move an
        // event/file out of its space (or flip all_day) while reporting success.
        console.warn(`${entity} update blamed load-bearing field(s) ${loadBearing.join(", ")}; refusing to strip and retry`, err);
        throw err;
      }
      for (const field of unsupported) sync.addUnsupportedField(entity, field);
      candidate = useSyncStore.getState().sanitizePayload(entity, candidate);
      if (Object.keys(candidate).length === 0) {
        // Every field was stripped as unsupported — no write would happen.
        // Throw instead of returning null so the edit is not silently dropped.
        throw new Error(`Update dropped for ${entity}: no supported fields remain after sanitizing (last error: ${String(err)})`);
      }
    }
  }
}

export async function deleteRemoteEntity(entity: "Folder" | "VaultItem" | "EmailItem" | "CalendarEvent" | "Space" | "GatherPack", id: string): Promise<void> {
  let desktopDeleteErr: unknown = null;
  try {
    await invokeEdgeFunction("desktopDelete", { entity_name: entity, id });
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
