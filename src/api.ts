import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_FUNCTIONS_URL,
  SUPABASE_URL,
} from "./config";
import { CHUNK_SIZE } from "./config";
import type { ActiveEditSession, CheckoutPayload, ResolvedCheckout } from "./types";
import { getAuthToken, getRefreshToken, getExtensionToken, saveLogin, getDeviceId } from "./storage";

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
  SpaceMember: "space_members",
};

// ── Edge Function name mapping ──────────────────────────────────────
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
  onlyofficeEditorSession: "onlyoffice-editor-session",
  onlyofficeCallback: "onlyoffice-callback",
  onlyofficeCommit: "onlyoffice-commit",
  gatherRelated: "gather-related",
  suggestTags: "suggest-tags",
  syncGmail: "sync-gmail",
  syncOutlookEmails: "sync-outlook-emails",
  syncOutlookCalendar: "sync-outlook-calendar",
  outlookOauthStart: "outlook-oauth-start",
  outlookStatus: "outlook-status",
  outlookDisconnect: "outlook-disconnect",
  spaceInvite: "space-invite",
  spaceRemoveMember: "space-remove-member",
  spaceMessages: "space-messages",
  spaceUpdateRole: "space-update-role",
  spaceActivity: "space-activity",
  spaceTasks: "space-tasks",
  fileComments: "file-comments",
  spaceInviteLink: "space-invite-link",
};

// ── Supabase field mapping (created_at → created_date for desktop app) ──
function emailFromJwt(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return (payload.email as string) || "";
  } catch {
    return "";
  }
}

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

let _refreshPromise: Promise<string> | null = null;

async function refreshSupabaseToken(): Promise<string> {
  const rt = getRefreshToken();
  if (!rt) {
    triggerAutoLogout();
    throw new Error("No refresh token available — please re-login");
  }
  const url = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
  const res = await fetch(url, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: rt }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string };
  if (!res.ok || !data.access_token) {
    triggerAutoLogout();
    throw new Error("Token refresh failed — please re-login");
  }
  const email = localStorage.getItem("easyvault_email") || "";
  saveLogin(data.access_token, email, data.refresh_token || rt);
  return data.access_token;
}

/** Callback for auto-logout; set by the app shell via `setAutoLogoutHandler`. */
let _autoLogoutHandler: (() => void) | null = null;

/** Register a callback to be called when token refresh fails. */
export function setAutoLogoutHandler(handler: () => void): void {
  _autoLogoutHandler = handler;
}

function triggerAutoLogout(): void {
  if (_autoLogoutHandler) _autoLogoutHandler();
}

/** Refresh the JWT if expired, deduplicating concurrent calls. */
export async function ensureFreshToken(): Promise<string> {
  const token = getAuthToken();
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload.exp && payload.exp * 1000 > Date.now() + 30000) {
        return token; // Still valid (with 30s buffer)
      }
    } catch { /* fall through to refresh */ }
  }
  if (!_refreshPromise) {
    _refreshPromise = refreshSupabaseToken().finally(() => { _refreshPromise = null; });
  }
  return _refreshPromise;
}

function withAuthToken(explicitToken?: string): string {
  if (explicitToken) return explicitToken;
  const stored = localStorage.getItem("easyvault_token");
  if (!stored) throw new Error("Missing auth token");
  return stored;
}

// ── Supabase PostgREST helpers ──────────────────────────────────────

function sortToPostgrest(sort: string): string {
  const desc = sort.startsWith("-");
  const field = sort.replace(/^-/, "");
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

export async function invokeEdgeFunction<T = unknown>(
  name: string,
  payload: Record<string, unknown> = {},
  token?: string
): Promise<T> {
  const edgeName = EDGE_FUNCTION_MAP[name];
  if (!edgeName) {
    throw new Error(`No Edge Function mapped for "${name}"`);
  }
  const url = `${SUPABASE_FUNCTIONS_URL}/${edgeName}`;
  // Use anon key as Bearer so Supabase infrastructure accepts the request.
  // Pass the actual user token in the body for resolveUser() to validate.
  // Prefer extension token (never expires) over JWT.
  const userToken = token || getExtensionToken() || getAuthToken() || "";
  const res = await tauriFetch(url, {
    method: "POST",
    headers: supabaseHeaders(SUPABASE_ANON_KEY),
    body: JSON.stringify({ ...payload, token: userToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${name} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data as T;
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
  return invokeEdgeFunction<DeltaSyncResponse>("deltaSync", payload, token);
}

// ── Desktop Save (conflict-aware update) ────────────────────────────

export async function callDesktopSave<T = Record<string, unknown>>(
  entityName: string,
  id: string,
  patch: Record<string, unknown>,
  lastKnownUpdatedDate: string,
  token?: string
): Promise<DesktopSaveSuccess<T> | DesktopSaveConflict<T>> {
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

// ── Entity CRUD ─────────────────────────────────────────────────────

export async function entityList<T = Record<string, unknown>>(
  entityName: string,
  sort: string = "-created_date",
  limit = 200,
  token?: string
): Promise<T[]> {
  const table = TABLE_MAP[entityName];
  if (!table) throw new Error(`Unknown entity: ${entityName}`);
  const freshToken = token || await ensureFreshToken();
  const order = sortToPostgrest(sort);
  const url = `${SUPABASE_URL}/rest/v1/${table}?order=${order}&limit=${limit}&select=*`;
  const res = await tauriFetch(url, {
    method: "GET",
    headers: supabaseRestHeaders(freshToken),
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) {
    throw new Error(`entityList ${entityName} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return mapSupabaseRecords<T>(Array.isArray(data) ? data : []);
}

export async function entityFilter<T = Record<string, unknown>>(
  entityName: string,
  filters: Record<string, unknown> = {},
  sort: string = "-created_date",
  limit = 200,
  token?: string
): Promise<T[]> {
  const table = TABLE_MAP[entityName];
  if (!table) throw new Error(`Unknown entity: ${entityName}`);
  const freshToken = token || await ensureFreshToken();
  const order = sortToPostgrest(sort);
  const filterParams = filtersToPostgrest(filters);
  const sep = filterParams ? "&" : "";
  const url = `${SUPABASE_URL}/rest/v1/${table}?order=${order}&limit=${limit}&select=*${sep}${filterParams}`;
  const res = await tauriFetch(url, {
    method: "GET",
    headers: supabaseRestHeaders(freshToken),
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) {
    throw new Error(`entityFilter ${entityName} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return mapSupabaseRecords<T>(Array.isArray(data) ? data : []);
}

export async function entityGet<T = Record<string, unknown>>(entityName: string, id: string, token?: string): Promise<T> {
  const table = TABLE_MAP[entityName];
  if (!table) throw new Error(`Unknown entity: ${entityName}`);
  const freshToken = token || await ensureFreshToken();
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&select=*`;
  const res = await tauriFetch(url, {
    method: "GET",
    headers: supabaseRestHeaders(freshToken),
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error(`entityGet ${entityName} failed (${res.status}): ${JSON.stringify(data)}`);
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) throw new Error(`${entityName} not found: ${id}`);
  return mapSupabaseRecord<T>(rows[0]);
}

export async function entityCreate<T = Record<string, unknown>>(
  entityName: string,
  data: Record<string, unknown>,
  token?: string
): Promise<T> {
  const table = TABLE_MAP[entityName];
  if (!table) throw new Error(`Unknown entity: ${entityName}`);
  const freshToken = token || await ensureFreshToken();
  // Add created_by for tables that have the column
  const noCreatedBy = new Set(["space_members", "item_tags"]);
  // Use email from JWT so it exactly matches auth_email() used by RLS policies
  const email = emailFromJwt(freshToken) || localStorage.getItem("easyvault_email") || "";
  const payload = noCreatedBy.has(table) ? { ...data } : { ...data, created_by: email };
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await tauriFetch(url, {
    method: "POST",
    headers: supabaseRestHeaders(freshToken),
    body: JSON.stringify(payload),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`entityCreate ${entityName} failed (${res.status}): ${JSON.stringify(result)}`);
  const rows = Array.isArray(result) ? result : [result];
  return mapSupabaseRecord<T>(rows[0]);
}

export async function entityUpdate<T = Record<string, unknown>>(
  entityName: string,
  id: string,
  data: Record<string, unknown>,
  token?: string
): Promise<T> {
  const table = TABLE_MAP[entityName];
  if (!table) throw new Error(`Unknown entity: ${entityName}`);
  const freshToken = token || await ensureFreshToken();
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
  const res = await tauriFetch(url, {
    method: "PATCH",
    headers: supabaseRestHeaders(freshToken),
    body: JSON.stringify(data),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`entityUpdate ${entityName} failed (${res.status}): ${JSON.stringify(result)}`);
  const rows = Array.isArray(result) ? result : [result];
  return mapSupabaseRecord<T>(rows[0]);
}

export async function entityDelete(entityName: string, id: string, token?: string): Promise<void> {
  const table = TABLE_MAP[entityName];
  if (!table) throw new Error(`Unknown entity: ${entityName}`);
  const freshToken = token || await ensureFreshToken();
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
  const res = await tauriFetch(url, {
    method: "DELETE",
    headers: supabaseRestHeaders(freshToken),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`entityDelete ${entityName} failed (${res.status}): ${JSON.stringify(data)}`);
  }
}

// ── Signup ──────────────────────────────────────────────────────────

export async function signup(email: string, password: string): Promise<string> {
  const url = `${SUPABASE_URL}/auth/v1/signup`;
  const res = await fetch(url, {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    id?: string;
    identities?: unknown[];
  };
  if (!res.ok) {
    const msg = (data as Record<string, unknown>).msg || (data as Record<string, unknown>).error_description || (data as Record<string, unknown>).error || "Signup failed";
    throw new Error(String(msg));
  }
  // Supabase returns empty identities if user already exists (email confirmation disabled)
  if (data.identities && Array.isArray(data.identities) && data.identities.length === 0) {
    throw new Error("An account with this email already exists");
  }
  if (!data.access_token) {
    throw new Error("Account created — please check your email to confirm, then sign in");
  }
  if (data.refresh_token) {
    localStorage.setItem("easyvault_refresh_token", data.refresh_token);
  }
  return data.access_token;
}

// ── Login ───────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<string> {
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
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error_description?: string; error?: string; msg?: string };
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.msg || data.error || "";
    throw new Error(detail || `login failed (${res.status})`);
  }
  // Store refresh token for auto-refresh
  if (data.refresh_token) {
    localStorage.setItem("easyvault_refresh_token", data.refresh_token);
  }
  return data.access_token;
}

// ── File Operations ─────────────────────────────────────────────────

export async function checkoutFile(fileId: string, requestToken: string): Promise<ResolvedCheckout> {
  const url = `${SUPABASE_FUNCTIONS_URL}/file-checkout`;
  const headers = supabaseHeaders(SUPABASE_ANON_KEY);

  const res = await tauriFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      token: requestToken,
      fileId,
      device_id: getDeviceId(),
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

  const initUrl = `${SUPABASE_FUNCTIONS_URL}/upload-init`;
  const initHeaders = supabaseHeaders(SUPABASE_ANON_KEY);

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

  const chunkUrl = `${SUPABASE_FUNCTIONS_URL}/upload-chunk`;

  for (let i = 0; i < totalChunks; i += 1) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, bytes.length);
    const chunkBytes = bytes.slice(start, end);

    const form = new FormData();
    form.append("token", token);
    form.append("upload_id", uploadId);
    form.append("chunk_index", String(i));
    form.append("chunk", new Blob([chunkBytes], { type: "application/octet-stream" }), filename);

    const chunkHeaders: Record<string, string> = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    };
    const chunkRes = await tauriFetch(chunkUrl, {
      method: "POST",
      headers: chunkHeaders,
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
    const completeUrl = `${SUPABASE_FUNCTIONS_URL}/upload-complete`;
    const completeHeaders = supabaseHeaders(SUPABASE_ANON_KEY);

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
  const url = `${SUPABASE_FUNCTIONS_URL}/file-versions`;
  const headers = supabaseHeaders(SUPABASE_ANON_KEY);

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
  const url = `${SUPABASE_FUNCTIONS_URL}/file-versions`;
  const headers = supabaseHeaders(SUPABASE_ANON_KEY);

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
  const url = `${SUPABASE_FUNCTIONS_URL}/file-lock`;
  const headers = supabaseHeaders(SUPABASE_ANON_KEY);

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
