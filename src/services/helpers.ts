import type { AdapterItem } from "../editors/types";

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
  };
}

export function normalizeItem(input: Partial<DesktopItem>): DesktopItem {
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

export function toDisplayName(email: string): string {
  if (!email) return "User";
  const local = email.split("@")[0] || "";
  return local
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "User";
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
