import type { AdapterItem } from "../editors/types";
import { t } from "../i18n";
import type { TKey } from "../i18n";

// ─── Constants ───────────────────────────────────────────────────────────────

export const SUPPORTED_IMPORT_EXT = new Set(["pdf", "docx", "xlsx", "pptx", "png", "jpg", "jpeg"]);
export const FILES_FOLDERS_KEY = "ev.files.folders";
export const FILES_ITEMS_KEY = "ev.files.items";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FileItemType =
  | "note"
  | "link"
  | "file_reference"
  | "email_reference"
  | "uploaded_file"
  | "managed_file";

export interface DesktopFolder {
  id: string;
  name: string;
  createdAtIso: string;
  updatedAtIso?: string;
  notes?: string;
  isPinned: boolean;
  isFavorite?: boolean;
  isDeleting?: boolean;
  spaceId?: string;
  createdBy?: string;
  parentFolderId?: string;
}

export interface DesktopItem {
  id: string;
  title: string;
  itemType: FileItemType;
  folderId: string;
  createdAtIso: string;
  updatedAtIso?: string;
  notes: string;
  tags: string[];
  isPinned: boolean;
  isFavorite: boolean;
  isImportant?: boolean;
  storedFileUrl?: string;
  sourceUrl?: string;
  localPath?: string;
  fileExtension?: string;
  isUploading?: boolean;
  isDeleting?: boolean;
  contentText?: string;
  spaceId?: string;
  createdBy?: string;
  openedAt?: string;
  /**
   * Live ONLYOFFICE co-authors, maintained server-side by the status-1
   * callback (`vault_items.editing_users`). Rides along with delta sync.
   */
  editingUsers: string[];
  /** When editing_users was last written. Empty = unknown age (old backend). */
  editingUsersAt: string;
  /** Exclusive lock holder for the native-open path (`vault_items.locked_by`). */
  lockedBy: string;
  /** ISO timestamp the exclusive lock was taken (`vault_items.locked_at`). */
  lockedAt: string;
}

/**
 * Raw PostgREST spellings `normalizeItem` also accepts, so a caller can hand
 * over a server row untouched instead of hand-mapping every column.
 */
interface RawItemFields {
  editing_users?: unknown;
  editing_users_at?: unknown;
  locked_by?: unknown;
  locked_at?: unknown;
}

export type PreviewKind = "note" | "link" | "image" | "pdf" | "office" | "other";
export type PreviewMode = "preview" | "edit";

export type ActionTarget =
  | { kind: "folder"; id: string; entity: "Folder" }
  | { kind: "item"; id: string; entity: "VaultItem" | "EmailItem" | "CalendarEvent" | "Space" | "GatherPack" };

export type EntityName = ActionTarget["entity"];

export type TabName = "home" | "files" | "links" | "email" | "calendar" | "vault" | "workspaces" | "queue" | "settings";

// ─── Pure helpers ────────────────────────────────────────────────────────────

export function loadJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asBool(value: unknown): boolean {
  return value === true;
}

export function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

export function normalizeFolder(input: Partial<DesktopFolder>): DesktopFolder {
  return {
    id: input.id || crypto.randomUUID(),
    name: input.name || "Untitled folder",
    createdAtIso: input.createdAtIso || new Date().toISOString(),
    updatedAtIso: input.updatedAtIso || input.createdAtIso || new Date().toISOString(),
    notes: input.notes || "",
    isPinned: Boolean(input.isPinned),
    isFavorite: Boolean(input.isFavorite),
    isDeleting: Boolean(input.isDeleting),
    spaceId: input.spaceId || "",
    createdBy: input.createdBy || "",
    parentFolderId: input.parentFolderId || "",
  };
}

export function normalizeItem(input: Partial<DesktopItem> & RawItemFields): DesktopItem {
  return {
    id: input.id || crypto.randomUUID(),
    title: input.title || "Untitled item",
    itemType: (input.itemType as FileItemType) || "note",
    folderId: input.folderId || "",
    createdAtIso: input.createdAtIso || new Date().toISOString(),
    updatedAtIso: input.updatedAtIso || input.createdAtIso || new Date().toISOString(),
    notes: input.notes || "",
    tags: Array.isArray(input.tags) ? input.tags : [],
    isPinned: Boolean(input.isPinned),
    isFavorite: Boolean(input.isFavorite),
    isImportant: Boolean(input.isImportant),
    storedFileUrl: input.storedFileUrl || "",
    sourceUrl: input.sourceUrl || "",
    localPath: input.localPath || "",
    fileExtension: input.fileExtension || "",
    isUploading: Boolean(input.isUploading),
    isDeleting: Boolean(input.isDeleting),
    contentText: input.contentText || "",
    spaceId: input.spaceId || "",
    createdBy: input.createdBy || "",
    // Accept both the camelCase app shape and the raw PostgREST column names —
    // these three arrive from the server and used to be dropped on the floor.
    editingUsers: input.editingUsers ? asArray(input.editingUsers) : asArray(input.editing_users),
    editingUsersAt: asString(input.editingUsersAt) || asString(input.editing_users_at),
    lockedBy: input.lockedBy || asString(input.locked_by),
    lockedAt: input.lockedAt || asString(input.locked_at),
  };
}

export function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function fileKindFromItem(item: DesktopItem): PreviewKind {
  if (item.itemType === "note") return "note";
  if (item.itemType === "link") return "link";
  const ext = (item.fileExtension || extOf(item.title)).toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return "image";
  if (ext === "docx" || ext === "xlsx" || ext === "pptx") return "office";
  return "other";
}

export function onlyofficeDocumentTypeForExt(ext: string): string {
  const lc = ext.toLowerCase().replace(/^\./, "");
  if (["docx", "doc", "odt", "rtf", "txt"].includes(lc)) return "word";
  if (["xlsx", "xls", "ods", "csv"].includes(lc)) return "cell";
  if (["pptx", "ppt", "odp"].includes(lc)) return "slide";
  return "word";
}

export function formatRelativeTime(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

/**
 * Per-space color palette. Every hue clears 4.5:1 contrast against the dark
 * panel surfaces (#0a0a0f / #111118), so a value is safe as a dot, a border
 * *and* as small text. Order is load-bearing: changing it re-colors spaces.
 */
const SPACE_COLORS = [
  "#60a5fa", // blue
  "#a78bfa", // violet
  "#34d399", // emerald
  "#fb923c", // orange
  "#f472b6", // pink
  "#22d3ee", // cyan
  "#facc15", // amber
  "#f87171", // red
  "#4ade80", // green
  "#c084fc", // purple
] as const;

/** Neutral for personal (space-less) rows — the muted-text tier, 7:1 on the panel. */
const PERSONAL_SPACE_COLOR = "#a1a1aa";

/**
 * Deterministic space → color. Same space id yields the same hue forever with
 * no storage, so a team event is recognizable by color across every surface.
 * The personal sentinel (`space_id === ""`) always gets the neutral.
 */
export function spaceColor(spaceId: string): string {
  if (!spaceId) return PERSONAL_SPACE_COLOR;
  let hash = 0;
  for (let i = 0; i < spaceId.length; i++) hash = spaceId.charCodeAt(i) + ((hash << 5) - hash);
  return SPACE_COLORS[Math.abs(hash) % SPACE_COLORS.length];
}

/**
 * Owner check for a raw `spaces` row: the creator, or a `members[]` entry with
 * role `owner`. Email comparison is lowercased because RLS `auth_email()` and
 * stored `created_by` are both lowercase-normalized.
 */
export function isSpaceOwner(space: Record<string, unknown>, me: string): boolean {
  if (!me) return false;
  if (asString(space.created_by).toLowerCase() === me) return true;
  const members = space.members;
  if (!Array.isArray(members)) return false;
  return members.some((m) => {
    if (!m || typeof m !== "object") return false;
    const row = m as Record<string, unknown>;
    return asString(row.email).toLowerCase() === me && asString(row.role) === "owner";
  });
}

export function toDisplayName(email: string): string {
  if (!email) return "User";
  const local = email.split("@")[0] || "";
  return local
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "User";
}

// ─── Co-editing presence ─────────────────────────────────────────────────────

/**
 * One live co-author of a document. `id` is whatever the server stored in
 * `editing_users`; ONLYOFFICE reports the `editorConfig.user.id` values it was
 * handed, so that is an email today but could become an opaque hash. `name` is
 * `""` when the id cannot be turned into something a human recognizes — such a
 * participant still counts toward presence, it just has no name or initials.
 */
export interface EditorPresence {
  id: string;
  name: string;
}

/** A long run of hex with no separators is an opaque id, not a person. */
const OPAQUE_ID_RE = /^[0-9a-f]{16,}$/i;

/** Best-effort human name for an `editing_users` entry; `""` if it is opaque. */
export function editorDisplayName(entry: string): string {
  const raw = entry.trim();
  if (!raw) return "";
  if (raw.includes("@")) return toDisplayName(raw);
  if (OPAQUE_ID_RE.test(raw) || raw.length > 24) return "";
  return toDisplayName(raw);
}

/**
 * Live co-authors of `item`, **current user excluded**, deduped.
 *
 * Presence answers "who *else* is in this document right now" — you already
 * know you are there, and a solo editor reading "1 person is editing" is pure
 * noise. Every surface (file row, preview modal) uses this one exclusion so the
 * avatar stack and the count never disagree.
 */
/**
 * Presence older than this is ignored. A crashed document server or a dropped
 * network never sends the disconnect callback, so editing_users can stay
 * non-empty forever. Note the rule is the OPPOSITE of a stale lock: unknown
 * age (no timestamp — an older backend) means IGNORE, because a wrongly-shown
 * avatar is noise while a wrongly-ignored lock costs a file.
 */
export const PRESENCE_STALE_MS = 30 * 60 * 1000;

export function presenceEditors(item: DesktopItem, me: string): EditorPresence[] {
  const at = Date.parse(item.editingUsersAt || "");
  if (!Number.isFinite(at) || Date.now() - at >= PRESENCE_STALE_MS) return [];
  const mine = me.trim().toLowerCase();
  const seen = new Set<string>();
  const editors: EditorPresence[] = [];
  for (const entry of item.editingUsers || []) {
    const id = (entry || "").trim();
    if (!id) continue;
    const key = id.toLowerCase();
    if (key === mine || seen.has(key)) continue;
    seen.add(key);
    editors.push({ id, name: editorDisplayName(id) });
  }
  // Named participants lead, so the first avatar is the name the sentence uses.
  return [...editors.filter((e) => e.name), ...editors.filter((e) => !e.name)];
}

export interface PresenceLabel {
  key: TKey;
  vars: Record<string, string | number>;
}

/**
 * Translation key + vars for the presence sentence. Returns the key rather than
 * the string so each caller renders through its own `useT()` and re-renders on
 * a locale switch. `null` when nobody else is in the document.
 */
export function presenceLabel(editors: EditorPresence[]): PresenceLabel | null {
  if (editors.length === 0) return null;
  const named = editors.find((e) => e.name);
  if (!named) return { key: "presence.anonymous", vars: { count: editors.length } };
  if (editors.length === 1) return { key: "presence.editing", vars: { name: named.name } };
  return { key: "presence.editingWithOthers", vars: { name: named.name, count: editors.length - 1 } };
}

// ─── Exclusive locks (native-open path) ──────────────────────────────────────

/**
 * A lock older than this is treated as abandoned, and the open proceeds.
 * 4 hours mirrors `file-checkout`'s own `edit_sessions.expires_at` window, so a
 * client never takes over a lock the backend still considers alive.
 */
export const LOCK_STALE_MS = 4 * 60 * 60 * 1000;

export interface LockInfo {
  lockedBy: string;
  lockedAt: string;
}

/** Unknown or unparseable age counts as live — never take over blind. */
export function isLockStale(lockedAt: string, nowMs: number = Date.now()): boolean {
  if (!lockedAt) return false;
  const taken = new Date(lockedAt).getTime();
  if (Number.isNaN(taken)) return false;
  return nowMs - taken >= LOCK_STALE_MS;
}

/**
 * Pull the lock holder out of a `file-checkout` 409. The edge function answers
 * `{error, locked_by, locked_at}` and `api.ts`'s `checkoutFile` stringifies that
 * body into the `Error` message — so the identity survives, but only as text
 * inside the message. Returns `null` when the error is not a lock conflict.
 */
export function parseLockConflict(err: unknown): LockInfo | null {
  const msg = String(err);
  if (!msg.includes("(409)")) return null;
  const start = msg.indexOf("{");
  if (start < 0) return { lockedBy: "", lockedAt: "" };
  try {
    const body = JSON.parse(msg.slice(start)) as Record<string, unknown>;
    return { lockedBy: asString(body.locked_by), lockedAt: asString(body.locked_at) };
  } catch {
    return { lockedBy: "", lockedAt: "" };
  }
}

/**
 * Display name for a lock holder. Falls back to a neutral "someone" rather than
 * blaming the system — the whole point of the lock copy rewrite.
 */
export function lockHolderName(lockedBy: string): string {
  return lockedBy ? toDisplayName(lockedBy) : t("lock.someone");
}

/** 409 body first, the item's own delta-synced columns as the fallback source. */
export function resolveLockInfo(
  conflict: LockInfo | null,
  fileId: string,
  items: readonly DesktopItem[],
): LockInfo {
  const cached = items.find((i) => i.id === fileId);
  return {
    lockedBy: conflict?.lockedBy || cached?.lockedBy || "",
    lockedAt: conflict?.lockedAt || cached?.lockedAt || "",
  };
}

export function toAdapterItem(item: DesktopItem): AdapterItem {
  return {
    id: item.id,
    title: item.title,
    itemType: item.itemType,
    folderId: item.folderId,
    createdAtIso: item.createdAtIso,
    updatedAtIso: item.updatedAtIso,
    notes: item.notes,
    tags: item.tags || [],
    storedFileUrl: item.storedFileUrl,
    sourceUrl: item.sourceUrl,
    localPath: item.localPath,
    fileExtension: item.fileExtension,
    contentText: item.contentText,
    spaceId: item.spaceId,
    createdBy: item.createdBy,
  };
}

export function isNotFoundError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return msg.includes("request failed (404)") || msg.includes("record not found") || msg.includes("not found");
}

export function isOnlyofficeRelayTempTitle(title: string): boolean {
  const t = (title || "").trim().toLowerCase();
  return (
    t.startsWith("onlyoffice_") &&
    (t.endsWith(".docx") || t.endsWith(".xlsx") || t.endsWith(".pptx"))
  );
}

export function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fileSignature(name: string, size: number): string {
  return `${name}|${size}`;
}

export function getPreviewUrlForItem(item: DesktopItem | AdapterItem): string {
  if ("storedFileUrl" in item && item.storedFileUrl) return item.storedFileUrl;
  if ("sourceUrl" in item && item.sourceUrl) return item.sourceUrl;
  return "";
}
