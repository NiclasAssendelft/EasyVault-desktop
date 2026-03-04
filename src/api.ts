import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  APP_API_BASE_URL,
  BACKEND,
  CHECKOUT_FUNCTION_URL,
  FILE_LOCK_FUNCTION_URL,
  FILE_VERSIONS_FUNCTION_URL,
  LOGIN_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_FUNCTIONS_URL,
  SUPABASE_URL,
  UPLOAD_CHUNK_URL,
  UPLOAD_COMPLETE_URL,
  UPLOAD_INIT_URL,
} from "./config";
import { CHUNK_SIZE } from "./config";
import type { ActiveEditSession, CheckoutPayload, ResolvedCheckout } from "./types";
import { getApiKey } from "./storage";

// ── Entity name → Supabase table name mapping ──────────────────────
const TABLE_MAP: Record<string, string> = {
  Folder: "folders",
  VaultItem: "vault_items",
  EmailItem: "email_items",
  CalendarEvent: "calendar_events",
  Space: "spaces",
  GatherPack: "gather_packs",
  GatherPackItem: "gather_pack_items",
  Tag: "tags",
  ItemTag: "item_tags",
  Session: "sessions",
  SessionItem: "session_items",
  SavedSearch: "saved_searches",
  DeletedRecord: "deleted_records",
};

// ── Base44 function → Supabase Edge Function name mapping ──────────
const EDGE_FUNCTION_MAP: Record<string, string> = {
  deltaSync: "delta-sync",
  desktopSave: "desktop-save",
  desktopDelete: "desktop-delete",
  getAccessibleSpaces: "get-accessible-spaces",
  fileCheckout: "file-checkout",
  fileLock: "file-lock",
  fileVersions: "file-versions",
  extensionAuth: "extension-auth",
  extensionUploadInit: "upload-init",
  extensionUploadChunk: "upload-chunk",
  extensionUploadComplete: "upload-complete",
};

// ── Supabase field mapping (created_at → created_date for desktop app) ──
function mapSupabaseRecord<T>(record: Record<string, unknown>): T {
  return {
    ...record,
    created_date: record.created_at ?? record.created_date,
    updated_date: record.updated_at ?? record.updated_date,
  } as T;
}

function mapSupabaseRecords<T>(records: Record<string, unknown>[]): T[] {
  return records.map((r) => mapSupabaseRecord<T>(r));
}

// ── Helpers ─────────────────────────────────────────────────────────

function hasRequiredCheckoutFields(data: CheckoutPayload): data is ResolvedCheckout {
  return Boolean(data.download_url && data.edit_session_id && data.file_metadata?.name);
}

function extractUploadId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const nested = obj.data as Record<string, unknown> | undefined;
  const uploadId = obj.upload_id ?? nested?.upload_id;
  return typeof uploadId === "string" && uploadId.length > 0 ? uploadId : null;
}

export function extractFileUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const nestedData = obj.data as Record<string, unknown> | undefined;
  const nestedResult = obj.result as Record<string, unknown> | undefined;
  const nestedFile = obj.file as Record<string, unknown> | undefined;
  const nestedItem = obj.item as Record<string, unknown> | undefined;

  const direct =
    obj.file_url ??
    obj.fileUrl ??
    obj.download_url ??
    obj.downloadUrl ??
    obj.url ??
    obj.public_url ??
    obj.publicUrl ??
    obj.storage_url ??
    obj.storageUrl ??
    obj.upload_url ??
    obj.uploadUrl ??
    obj.path ??
    obj.file_path ??
    obj.filePath ??
    nestedData?.file_url ??
    nestedData?.fileUrl ??
    nestedData?.url ??
    nestedResult?.file_url ??
    nestedResult?.fileUrl ??
    nestedResult?.url ??
    nestedFile?.url ??
    nestedFile?.file_url ??
    nestedItem?.stored_file_url ??
    nestedItem?.file_url ??
    nestedItem?.url;

  return typeof direct === "string" && direct.length > 0 ? direct : null;
}

function guessMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Headers ─────────────────────────────────────────────────────────

export function baseHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    api_key: getApiKey(),
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function supabaseHeaders(token?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  };
}

function supabaseRestHeaders(token?: string): Record<string, string> {
  return {
    ...supabaseHeaders(token),
    Prefer: "return=representation",
  };
}

function withAuthToken(explicitToken?: string): string {
  if (explicitToken) return explicitToken;
  const stored = localStorage.getItem("easyvault_token");
  if (!stored) throw new Error("Missing auth token");
  return stored;
}

function unwrapData<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)) {
    return ((payload as Record<string, unknown>).data as T) ?? (payload as T);
  }
  return payload as T;
}

// ── Base44 helpers (kept for fallback) ──────────────────────────────

async function postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
  const res = await tauriFetch(url, {
    method: "POST",
    headers: baseHeaders(withAuthToken(token)),
    body: JSON.stringify(body ?? {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}): ${JSON.stringify(payload)}`);
  }
  return unwrapData<T>(payload);
}

function entityOpCandidates(entityName: string, op: string): string[] {
  return [
    `${APP_API_BASE_URL}/entities/${entityName}/${op}`,
    `${APP_API_BASE_URL}/entities/${entityName}/${op}/`,
    `${APP_API_BASE_URL}/entity/${entityName}/${op}`,
    `${APP_API_BASE_URL}/entity/${entityName}/${op}/`,
  ];
}

type CandidateRequest = {
  url: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function uniqueCandidates(candidates: CandidateRequest[]): CandidateRequest[] {
  const seen = new Set<string>();
  const unique: CandidateRequest[] = [];
  for (const c of candidates) {
    const key = `${c.method} ${c.url} ${c.body === undefined ? "" : JSON.stringify(c.body)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  return unique;
}

function recordMatchesFilters(record: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(filters)) {
    const actual = record[key];
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) return false;
      const expectedNorm = expected.map((v) => JSON.stringify(v)).sort();
      const actualNorm = actual.map((v) => JSON.stringify(v)).sort();
      if (expectedNorm.length !== actualNorm.length) return false;
      for (let i = 0; i < expectedNorm.length; i += 1) {
        if (expectedNorm[i] !== actualNorm[i]) return false;
      }
      continue;
    }
    if (expected && typeof expected === "object") {
      return false;
    }
    if (actual !== expected) return false;
  }
  return true;
}

async function requestJsonCandidates<T>(candidates: CandidateRequest[], token?: string): Promise<T> {
  let lastErr: unknown = null;
  const attempts: string[] = [];
  const unique = uniqueCandidates(candidates);
  for (const c of unique) {
    attempts.push(`${c.method} ${c.url}`);
    const res = await tauriFetch(c.url, {
      method: c.method,
      headers: c.method === "GET" ? { Authorization: `Bearer ${withAuthToken(token)}`, api_key: getApiKey() } : baseHeaders(withAuthToken(token)),
      body: c.body === undefined ? undefined : JSON.stringify(c.body),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) return unwrapData<T>(payload);
    if (res.status === 404 || res.status === 405) {
      lastErr = `Request failed (${res.status}) @ ${c.method} ${c.url}: ${JSON.stringify(payload)}`;
      continue;
    }
    throw new Error(`Request failed (${res.status}) @ ${c.method} ${c.url}: ${JSON.stringify(payload)}`);
  }
  const preview = attempts.slice(0, 14).join("\n");
  const rest = attempts.length > 14 ? `\n...and ${attempts.length - 14} more` : "";
  throw new Error(`${String(lastErr ?? "All candidate routes failed")}\nTried:\n${preview}${rest}`);
}

// ── Supabase PostgREST helpers ──────────────────────────────────────

function sortToPostgrest(sort: string): string {
  // Base44 format: "-created_date" → PostgREST: "created_at.desc"
  const desc = sort.startsWith("-");
  const field = sort.replace(/^-/, "");
  // Map Base44 field names to Supabase column names
  const fieldMap: Record<string, string> = {
    created_date: "created_at",
    updated_date: "updated_at",
    "-created_date": "created_at",
    "-updated_date": "updated_at",
  };
  const col = fieldMap[field] || field;
  return `${col}.${desc ? "desc" : "asc"}`;
}

function filtersToPostgrest(filters: Record<string, unknown>): string {
  const params: string[] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    params.push(`${key}=eq.${encodeURIComponent(String(value))}`);
  }
  return params.join("&");
}

// ── Core API Functions ──────────────────────────────────────────────

export async function invokeBase44Function<T = unknown>(
  name: string,
  payload: Record<string, unknown> = {},
  token?: string
): Promise<T> {
  const edgeName = EDGE_FUNCTION_MAP[name];

  // If we have a Supabase Edge Function for this, use it
  if (BACKEND === "supabase" && edgeName) {
    const url = `${SUPABASE_FUNCTIONS_URL}/${edgeName}`;
    const res = await tauriFetch(url, {
      method: "POST",
      headers: supabaseHeaders(SUPABASE_ANON_KEY),
      body: JSON.stringify({ ...payload, token: token || withAuthToken() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${name} failed (${res.status}): ${JSON.stringify(data)}`);
    }
    return data as T;
  }

  // Fallback to Base44 for unmigrated functions
  return postJson<T>(`${APP_API_BASE_URL}/functions/${name}`, payload, token);
}

// ── Delta Sync ──────────────────────────────────────────────────────

type DeltaSyncEntityChange<T = Record<string, unknown>> = {
  updated: T[];
  deleted: Array<{ record_id?: string; deleted_at?: string }>;
};

type DeltaSyncResponse<T = Record<string, unknown>> = {
  version?: string;
  server_time?: string;
  changes?: Record<string, DeltaSyncEntityChange<T>>;
  pagination?: {
    page?: number;
    has_more?: boolean;
  };
};

type DesktopSaveConflict<T = Record<string, unknown>> = {
  ok: false;
  status: 409;
  error: "conflict";
  currentRecord: T | null;
  serverUpdatedDate: string;
};

type DesktopSaveSuccess<T = Record<string, unknown>> = {
  ok: true;
  record: T;
};

export async function callDeltaSync(
  sinceTimestamp: string,
  entities?: string[],
  page = 0,
  token?: string
): Promise<DeltaSyncResponse> {
  const payload: Record<string, unknown> = { since_timestamp: sinceTimestamp, page };
  if (Array.isArray(entities) && entities.length > 0) payload.entities = entities;
  return invokeBase44Function<DeltaSyncResponse>("deltaSync", payload, token);
}

// ── Desktop Save (conflict-aware update) ────────────────────────────

export async function callDesktopSave<T = Record<string, unknown>>(
  entityName: string,
  id: string,
  patch: Record<string, unknown>,
  lastKnownUpdatedDate: string,
  token?: string
): Promise<DesktopSaveSuccess<T> | DesktopSaveConflict<T>> {
  if (BACKEND === "supabase") {
    const url = `${SUPABASE_FUNCTIONS_URL}/desktop-save`;
    const res = await tauriFetch(url, {
      method: "POST",
      headers: supabaseHeaders(SUPABASE_ANON_KEY),
      body: JSON.stringify({
        entity_name: entityName,
        id,
        patch,
        last_known_updated_date: lastKnownUpdatedDate,
        token: token || withAuthToken(),
      }),
    });

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 409) {
      return {
        ok: false,
        status: 409,
        error: "conflict",
        currentRecord: ((payload.current_record as T | undefined) ?? null),
        serverUpdatedDate: String(payload.server_updated_date ?? ""),
      };
    }
    if (!res.ok) {
      throw new Error(`desktopSave failed (${res.status}): ${JSON.stringify(payload)}`);
    }
    const record = (payload.record as T | undefined) ?? (payload as unknown as T);
    return { ok: true, record };
  }

  // Base44 path
  const url = `${APP_API_BASE_URL}/functions/desktopSave`;
  const res = await tauriFetch(url, {
    method: "POST",
    headers: baseHeaders(withAuthToken(token)),
    body: JSON.stringify({
      entity_name: entityName,
      id,
      patch,
      last_known_updated_date: lastKnownUpdatedDate,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 409) {
    return {
      ok: false,
      status: 409,
      error: "conflict",
      currentRecord: ((payload.current_record as T | undefined) ?? null),
      serverUpdatedDate: String(payload.server_updated_date ?? ""),
    };
  }
  if (!res.ok) {
    throw new Error(`desktopSave failed (${res.status}): ${JSON.stringify(payload)}`);
  }
  const record = ((payload.record as T | undefined) ?? (payload.data as T | undefined) ?? (payload as unknown as T));
  return { ok: true, record };
}

// ── Entity CRUD ─────────────────────────────────────────────────────

export async function entityList<T = Record<string, unknown>>(
  entityName: string,
  sort: string = "-created_date",
  limit = 200,
  token?: string
): Promise<T[]> {
  if (BACKEND === "supabase") {
    const table = TABLE_MAP[entityName];
    if (table) {
      const order = sortToPostgrest(sort);
      const url = `${SUPABASE_URL}/rest/v1/${table}?order=${order}&limit=${limit}&select=*`;
      const res = await tauriFetch(url, {
        method: "GET",
        headers: supabaseRestHeaders(withAuthToken(token)),
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(`entityList ${entityName} failed (${res.status}): ${JSON.stringify(data)}`);
      return mapSupabaseRecords<T>(Array.isArray(data) ? data : []);
    }
  }

  // Base44 fallback
  const candidates: CandidateRequest[] = [
    ...entityOpCandidates(entityName, "list").map((url) => ({ url, method: "POST" as const, body: { sort, limit } })),
    ...entityOpCandidates(entityName, "list").map((url) => ({ url, method: "POST" as const, body: { order: sort, limit } })),
    ...entityOpCandidates(entityName, "list").map((url) => ({ url, method: "POST" as const, body: { filters: {}, sort, limit } })),
    {
      url: `${APP_API_BASE_URL}/entities/${entityName}?sort=${encodeURIComponent(sort)}&limit=${encodeURIComponent(String(limit))}`,
      method: "GET",
    },
    {
      url: `${APP_API_BASE_URL}/entities/${entityName}/?sort=${encodeURIComponent(sort)}&limit=${encodeURIComponent(String(limit))}`,
      method: "GET",
    },
    {
      url: `${APP_API_BASE_URL}/entity/${entityName}?sort=${encodeURIComponent(sort)}&limit=${encodeURIComponent(String(limit))}`,
      method: "GET",
    },
    {
      url: `${APP_API_BASE_URL}/entity/${entityName}/?sort=${encodeURIComponent(sort)}&limit=${encodeURIComponent(String(limit))}`,
      method: "GET",
    },
  ];

  try {
    return await requestJsonCandidates<T[]>(candidates, token);
  } catch {
    return entityFilter<T>(entityName, {}, sort, limit, token);
  }
}

export async function entityFilter<T = Record<string, unknown>>(
  entityName: string,
  filters: Record<string, unknown> = {},
  sort: string = "-created_date",
  limit = 200,
  token?: string
): Promise<T[]> {
  if (BACKEND === "supabase") {
    const table = TABLE_MAP[entityName];
    if (table) {
      const order = sortToPostgrest(sort);
      const filterParams = filtersToPostgrest(filters);
      const sep = filterParams ? "&" : "";
      const url = `${SUPABASE_URL}/rest/v1/${table}?order=${order}&limit=${limit}&select=*${sep}${filterParams}`;
      const res = await tauriFetch(url, {
        method: "GET",
        headers: supabaseRestHeaders(withAuthToken(token)),
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(`entityFilter ${entityName} failed (${res.status}): ${JSON.stringify(data)}`);
      return mapSupabaseRecords<T>(Array.isArray(data) ? data : []);
    }
  }

  // Base44 fallback
  const candidates: CandidateRequest[] = [
    ...entityOpCandidates(entityName, "filter").map((url) => ({ url, method: "POST" as const, body: { filters, sort, limit } })),
    ...entityOpCandidates(entityName, "filter").map((url) => ({ url, method: "POST" as const, body: { query: filters, sort, limit } })),
    ...entityOpCandidates(entityName, "filter").map((url) => ({ url, method: "POST" as const, body: { ...filters, sort, limit } })),
    {
      url: `${APP_API_BASE_URL}/entities/${entityName}/filter`,
      method: "POST",
      body: { filters, sort, limit },
    },
    {
      url: `${APP_API_BASE_URL}/entities/${entityName}/filter/`,
      method: "POST",
      body: { filters, sort, limit },
    },
    {
      url: `${APP_API_BASE_URL}/entity/${entityName}/filter`,
      method: "POST",
      body: { filters, sort, limit },
    },
    {
      url: `${APP_API_BASE_URL}/entity/${entityName}/filter/`,
      method: "POST",
      body: { filters, sort, limit },
    },
  ];
  try {
    return await requestJsonCandidates<T[]>(candidates, token);
  } catch {
    const all = await entityList<Record<string, unknown>>(entityName, sort, Math.max(limit, 500), token);
    const filtered = all.filter((row) => recordMatchesFilters(row, filters));
    return filtered.slice(0, limit) as T[];
  }
}

export async function entityGet<T = Record<string, unknown>>(entityName: string, id: string, token?: string): Promise<T> {
  if (BACKEND === "supabase") {
    const table = TABLE_MAP[entityName];
    if (table) {
      const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&select=*`;
      const res = await tauriFetch(url, {
        method: "GET",
        headers: supabaseRestHeaders(withAuthToken(token)),
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(`entityGet ${entityName} failed (${res.status}): ${JSON.stringify(data)}`);
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) throw new Error(`${entityName} not found: ${id}`);
      return mapSupabaseRecord<T>(rows[0]);
    }
  }

  // Base44 fallback
  const candidates: CandidateRequest[] = [
    ...entityOpCandidates(entityName, "get").map((url) => ({ url, method: "POST" as const, body: { id } })),
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}`, method: "GET" },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}/`, method: "GET" },
  ];
  return requestJsonCandidates<T>(candidates, token);
}

export async function entityCreate<T = Record<string, unknown>>(
  entityName: string,
  data: Record<string, unknown>,
  token?: string
): Promise<T> {
  if (BACKEND === "supabase") {
    const table = TABLE_MAP[entityName];
    if (table) {
      // Add created_by from token email (service will handle via RLS)
      const email = localStorage.getItem("easyvault_email") || "";
      const payload = { ...data, created_by: email };
      const url = `${SUPABASE_URL}/rest/v1/${table}`;
      const res = await tauriFetch(url, {
        method: "POST",
        headers: supabaseRestHeaders(withAuthToken(token)),
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`entityCreate ${entityName} failed (${res.status}): ${JSON.stringify(result)}`);
      const rows = Array.isArray(result) ? result : [result];
      return mapSupabaseRecord<T>(rows[0]);
    }
  }

  // Base44 fallback
  const candidates: CandidateRequest[] = [
    ...entityOpCandidates(entityName, "create").map((url) => ({ url, method: "POST" as const, body: data })),
    ...entityOpCandidates(entityName, "create").map((url) => ({ url, method: "POST" as const, body: { data } })),
    { url: `${APP_API_BASE_URL}/entities/${entityName}`, method: "POST", body: data },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/`, method: "POST", body: data },
    { url: `${APP_API_BASE_URL}/entities/${entityName}`, method: "POST", body: { data } },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/`, method: "POST", body: { data } },
  ];
  return requestJsonCandidates<T>(candidates, token);
}

export async function entityUpdate<T = Record<string, unknown>>(
  entityName: string,
  id: string,
  data: Record<string, unknown>,
  token?: string
): Promise<T> {
  if (BACKEND === "supabase") {
    const table = TABLE_MAP[entityName];
    if (table) {
      const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
      const res = await tauriFetch(url, {
        method: "PATCH",
        headers: supabaseRestHeaders(withAuthToken(token)),
        body: JSON.stringify(data),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`entityUpdate ${entityName} failed (${res.status}): ${JSON.stringify(result)}`);
      const rows = Array.isArray(result) ? result : [result];
      return mapSupabaseRecord<T>(rows[0]);
    }
  }

  // Base44 fallback
  const patchData = { id, ...data };
  const candidates: CandidateRequest[] = [
    ...entityOpCandidates(entityName, "update").map((url) => ({ url, method: "POST" as const, body: patchData })),
    ...entityOpCandidates(entityName, "update").map((url) => ({ url, method: "POST" as const, body: { id, data } })),
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}`, method: "PATCH", body: data },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}/`, method: "PATCH", body: data },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}`, method: "POST", body: data },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}/`, method: "POST", body: data },
  ];
  return requestJsonCandidates<T>(candidates, token);
}

export async function entityDelete(entityName: string, id: string, token?: string): Promise<void> {
  if (BACKEND === "supabase") {
    const table = TABLE_MAP[entityName];
    if (table) {
      const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
      const res = await tauriFetch(url, {
        method: "DELETE",
        headers: supabaseRestHeaders(withAuthToken(token)),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(`entityDelete ${entityName} failed (${res.status}): ${JSON.stringify(data)}`);
      }
      return;
    }
  }

  // Base44 fallback
  const deleteOpUrls = entityOpCandidates(entityName, "delete");
  const deleteOpUrlsWithSlash = deleteOpUrls.map(withTrailingSlash);
  const candidates: CandidateRequest[] = [
    ...deleteOpUrls.map((url) => ({ url, method: "POST" as const, body: { id } })),
    ...deleteOpUrls.map((url) => ({ url, method: "POST" as const, body: { record_id: id } })),
    ...deleteOpUrls.map((url) => ({ url, method: "POST" as const, body: { ids: [id] } })),
    ...deleteOpUrls.map((url) => ({ url, method: "DELETE" as const, body: { id } })),
    ...deleteOpUrls.map((url) => ({ url, method: "DELETE" as const, body: { record_id: id } })),
    ...deleteOpUrls.map((url) => ({ url, method: "DELETE" as const, body: { ids: [id] } })),
    { url: `${APP_API_BASE_URL}/entities/${entityName}/delete`, method: "POST", body: { id } },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/delete/`, method: "POST", body: { id } },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/delete`, method: "DELETE", body: { id } },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/delete/`, method: "DELETE", body: { id } },
    { url: `${APP_API_BASE_URL}/entity/${entityName}/delete`, method: "POST", body: { id } },
    { url: `${APP_API_BASE_URL}/entity/${entityName}/delete/`, method: "POST", body: { id } },
    { url: `${APP_API_BASE_URL}/entity/${entityName}/delete`, method: "DELETE", body: { id } },
    { url: `${APP_API_BASE_URL}/entity/${entityName}/delete/`, method: "DELETE", body: { id } },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}/delete`, method: "POST", body: {} },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}/delete/`, method: "POST", body: {} },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}/delete`, method: "DELETE", body: {} },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}/delete/`, method: "DELETE", body: {} },
    { url: `${APP_API_BASE_URL}/entity/${entityName}/${id}/delete`, method: "POST", body: {} },
    { url: `${APP_API_BASE_URL}/entity/${entityName}/${id}/delete/`, method: "POST", body: {} },
    { url: `${APP_API_BASE_URL}/entity/${entityName}/${id}/delete`, method: "DELETE", body: {} },
    { url: `${APP_API_BASE_URL}/entity/${entityName}/${id}/delete/`, method: "DELETE", body: {} },
    ...deleteOpUrlsWithSlash.map((url) => ({ url: `${url}${id}`, method: "POST" as const, body: {} })),
    ...deleteOpUrlsWithSlash.map((url) => ({ url: `${url}${id}/`, method: "POST" as const, body: {} })),
    ...deleteOpUrlsWithSlash.map((url) => ({ url: `${url}${id}`, method: "DELETE" as const, body: {} })),
    ...deleteOpUrlsWithSlash.map((url) => ({ url: `${url}${id}/`, method: "DELETE" as const, body: {} })),
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}`, method: "DELETE" },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}/`, method: "DELETE" },
    { url: `${APP_API_BASE_URL}/entity/${entityName}/${id}`, method: "DELETE" },
    { url: `${APP_API_BASE_URL}/entity/${entityName}/${id}/`, method: "DELETE" },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/delete/${id}`, method: "POST", body: {} },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/delete/${id}/`, method: "POST", body: {} },
    { url: `${APP_API_BASE_URL}/entity/${entityName}/delete/${id}`, method: "POST", body: {} },
    { url: `${APP_API_BASE_URL}/entity/${entityName}/delete/${id}/`, method: "POST", body: {} },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}`, method: "POST", body: { action: "delete" } },
    { url: `${APP_API_BASE_URL}/entities/${entityName}/${id}/`, method: "POST", body: { action: "delete" } },
  ];
  await requestJsonCandidates<unknown>(candidates, token);
}

// ── Login ───────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<string> {
  if (BACKEND === "supabase") {
    const url = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
    const res = await fetch(url, {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string };
    if (!res.ok || !data.access_token) {
      throw new Error(`login failed (${res.status})`);
    }
    return data.access_token;
  }

  // Base44
  const res = await fetch(LOGIN_URL, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`login failed (${res.status})`);
  }
  return data.access_token;
}

// ── File Operations ─────────────────────────────────────────────────

export async function checkoutFile(fileId: string, requestToken: string): Promise<ResolvedCheckout> {
  const url = BACKEND === "supabase"
    ? `${SUPABASE_FUNCTIONS_URL}/file-checkout`
    : CHECKOUT_FUNCTION_URL;

  const headers = BACKEND === "supabase"
    ? supabaseHeaders(SUPABASE_ANON_KEY)
    : baseHeaders(requestToken);

  const res = await tauriFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      token: requestToken,
      fileId,
      device_id: "easyvault-desktop-mac",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as CheckoutPayload;
  if (!res.ok) {
    throw new Error(`Checkout failed (${res.status}): ${JSON.stringify(data)}`);
  }
  if (!hasRequiredCheckoutFields(data)) {
    throw new Error(`Checkout response missing required fields: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function downloadFile(downloadUrl: string): Promise<Uint8Array> {
  const res = await tauriFetch(downloadUrl, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function uploadViaChunkApi(session: ActiveEditSession, bytes: Uint8Array): Promise<string> {
  return uploadFileWithToken(session.extensionToken, session.filename, bytes);
}

export async function uploadFileWithToken(
  token: string,
  filename: string,
  bytes: Uint8Array,
  onProgress?: (pct: number) => void
): Promise<string> {
  const totalChunks = Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE));
  const mimeType = guessMimeType(filename);

  const initUrl = BACKEND === "supabase"
    ? `${SUPABASE_FUNCTIONS_URL}/upload-init`
    : UPLOAD_INIT_URL;
  const initHeaders = BACKEND === "supabase"
    ? supabaseHeaders(SUPABASE_ANON_KEY)
    : baseHeaders();

  const initRes = await tauriFetch(initUrl, {
    method: "POST",
    headers: initHeaders,
    body: JSON.stringify({
      token,
      filename,
      file_name: filename,
      file_size: bytes.length,
      mime_type: mimeType,
      chunk_size: CHUNK_SIZE,
      total_chunks: totalChunks,
    }),
  });
  const initData = await initRes.json().catch(() => ({}));
  if (!initRes.ok) {
    throw new Error(`Upload init failed (${initRes.status}): ${JSON.stringify(initData)}`);
  }

  const uploadId = extractUploadId(initData);
  if (!uploadId) {
    throw new Error(`Upload init missing upload_id: ${JSON.stringify(initData)}`);
  }

  let fileUrl = extractFileUrl(initData);
  const chunkUrls: string[] = [];

  const chunkUrl = BACKEND === "supabase"
    ? `${SUPABASE_FUNCTIONS_URL}/upload-chunk`
    : UPLOAD_CHUNK_URL;

  for (let i = 0; i < totalChunks; i += 1) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, bytes.length);
    const chunkBytes = bytes.slice(start, end);

    const form = new FormData();
    form.append("token", token);
    form.append("upload_id", uploadId);
    form.append("chunk_index", String(i));
    form.append("chunk", new Blob([chunkBytes], { type: "application/octet-stream" }), filename);

    const chunkRes = await tauriFetch(chunkUrl, {
      method: "POST",
      body: form,
    });
    const chunkData = await chunkRes.json().catch(() => ({}));
    if (!chunkRes.ok) {
      throw new Error(`Upload chunk ${i} failed (${chunkRes.status}): ${JSON.stringify(chunkData)}`);
    }

    const maybeUrl = extractFileUrl(chunkData);
    if (maybeUrl) {
      chunkUrls.push(maybeUrl);
      fileUrl = maybeUrl;
    }
    if (onProgress) {
      onProgress(Math.round(((i + 1) / totalChunks) * 100));
    }
  }

  let completeData: unknown = null;
  if (!fileUrl) {
    const completeUrl = BACKEND === "supabase"
      ? `${SUPABASE_FUNCTIONS_URL}/upload-complete`
      : UPLOAD_COMPLETE_URL;
    const completeHeaders = BACKEND === "supabase"
      ? supabaseHeaders(SUPABASE_ANON_KEY)
      : baseHeaders();

    const completeRes = await tauriFetch(completeUrl, {
      method: "POST",
      headers: completeHeaders,
      body: JSON.stringify({
        token,
        upload_id: uploadId,
        filename,
        total_chunks: totalChunks,
        chunk_urls: chunkUrls,
        chunkUrls,
        chunk_urls_csv: chunkUrls.join(","),
      }),
    });

    completeData = await completeRes.json().catch(() => ({}));
    if (!completeRes.ok) {
      throw new Error(`Upload complete failed (${completeRes.status}): ${JSON.stringify(completeData)}`);
    }

    fileUrl = extractFileUrl(completeData);
  }

  if (!fileUrl) {
    throw new Error(`Upload completed but no file_url returned. complete_response=${JSON.stringify(completeData)}`);
  }

  return fileUrl;
}

export async function createNewVersion(session: ActiveEditSession, fileUrl: string, checksum: string): Promise<void> {
  const url = BACKEND === "supabase"
    ? `${SUPABASE_FUNCTIONS_URL}/file-versions`
    : FILE_VERSIONS_FUNCTION_URL;
  const headers = BACKEND === "supabase"
    ? supabaseHeaders(SUPABASE_ANON_KEY)
    : baseHeaders(session.authToken);

  const res = await tauriFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      token: session.extensionToken,
      fileId: session.fileId,
      file_url: fileUrl,
      checksum,
      edit_session_id: session.editSessionId,
      change_summary: "Auto-synced from EasyVault Desktop",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Create version failed (${res.status}): ${JSON.stringify(data)}`);
  }
}

export async function listVersions(
  token: string,
  fileId: string
): Promise<Array<Record<string, unknown>>> {
  const url = BACKEND === "supabase"
    ? `${SUPABASE_FUNCTIONS_URL}/file-versions`
    : FILE_VERSIONS_FUNCTION_URL;
  const headers = BACKEND === "supabase"
    ? supabaseHeaders(SUPABASE_ANON_KEY)
    : baseHeaders(token);

  const res = await tauriFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      token,
      fileId,
      action: "list",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { versions?: Array<Record<string, unknown>> };
  if (!res.ok) {
    throw new Error(`List versions failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data.versions || [];
}

export async function callFileLock(token: string, fileId: string, action: "lock" | "unlock"): Promise<void> {
  const url = BACKEND === "supabase"
    ? `${SUPABASE_FUNCTIONS_URL}/file-lock`
    : FILE_LOCK_FUNCTION_URL;
  const headers = BACKEND === "supabase"
    ? supabaseHeaders(SUPABASE_ANON_KEY)
    : baseHeaders(token);

  const res = await tauriFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ token, fileId, action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`fileLock ${action} failed (${res.status}): ${JSON.stringify(data)}`);
  }
}
