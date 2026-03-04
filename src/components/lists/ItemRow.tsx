import type { DesktopItem } from "../../services/helpers";
import { formatRelativeTime } from "../../services/helpers";
import { useUiStore } from "../../stores/uiStore";
import { useFilesStore } from "../../stores/filesStore";
import { useT } from "../../i18n";

interface Props {
  item: DesktopItem;
}

// Extension → icon config (macOS-style colored doc badges)
const EXT_CONFIG: Record<string, { label: string; color: string }> = {
  // Microsoft Office
  doc:  { label: "DOC",  color: "#2b579a" },
  docx: { label: "DOC",  color: "#2b579a" },
  xls:  { label: "XLS",  color: "#217346" },
  xlsx: { label: "XLS",  color: "#217346" },
  ppt:  { label: "PPT",  color: "#d24726" },
  pptx: { label: "PPT",  color: "#d24726" },
  // PDF
  pdf:  { label: "PDF",  color: "#e5252a" },
  // Images
  png:  { label: "PNG",  color: "#8b5cf6" },
  jpg:  { label: "JPG",  color: "#8b5cf6" },
  jpeg: { label: "JPG",  color: "#8b5cf6" },
  gif:  { label: "GIF",  color: "#8b5cf6" },
  svg:  { label: "SVG",  color: "#8b5cf6" },
  webp: { label: "IMG",  color: "#8b5cf6" },
  // Text / code
  txt:  { label: "TXT",  color: "#6b7280" },
  md:   { label: "MD",   color: "#6b7280" },
  csv:  { label: "CSV",  color: "#059669" },
  json: { label: "JSON", color: "#eab308" },
  html: { label: "HTML", color: "#e34f26" },
  // Media
  mp4:  { label: "MP4",  color: "#7c3aed" },
  mp3:  { label: "MP3",  color: "#ec4899" },
  wav:  { label: "WAV",  color: "#ec4899" },
  // Archives
  zip:  { label: "ZIP",  color: "#78716c" },
  rar:  { label: "RAR",  color: "#78716c" },
};

// Fallback by item type (for items without a file extension)
const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  note:            { label: "NOTE", color: "#7c3aed" },
  link:            { label: "URL",  color: "#0891b2" },
  file_reference:  { label: "REF",  color: "#d97706" },
  email_reference: { label: "MAIL", color: "#db2777" },
  uploaded_file:   { label: "FILE", color: "#2563eb" },
  managed_file:    { label: "FILE", color: "#059669" },
};

function getIconConfig(item: DesktopItem): { label: string; color: string } {
  if (item.fileExtension) {
    const ext = item.fileExtension.replace(/^\./, "").toLowerCase();
    if (EXT_CONFIG[ext]) return EXT_CONFIG[ext];
  }
  return TYPE_CONFIG[item.itemType] || { label: "FILE", color: "#4f46e5" };
}

function fileExtLabel(item: DesktopItem): string | null {
  if (!item.fileExtension) return null;
  const ext = item.fileExtension.replace(/^\./, "").toLowerCase();
  return ext.length > 0 && ext.length <= 5 ? `.${ext}` : null;
}

export default function ItemRow({ item }: Props) {
  const setFileActionTargetId = useUiStore((s) => s.setFileActionTargetId);
  const folders = useFilesStore((s) => s.folders);
  const folder = folders.find((f) => f.id === item.folderId);
  const cfg = getIconConfig(item);
  const extLabel = fileExtLabel(item);
  const t = useT();

  return (
    <article className="file-row group" onClick={() => setFileActionTargetId(item.id)}>
      <div className="file-type-badge" style={{ background: cfg.color }}>
        {cfg.label}
      </div>
      <div className="file-row-body">
        <p className="file-row-title">
          {item.isUploading && <span className="file-uploading-pulse" />}
          {item.title}
          {item.isPinned && <span className="file-pin-badge">{t("list.pinned")}</span>}
          {item.isFavorite && <span className="file-fav-star">★</span>}
        </p>
        <div className="file-row-meta">
          <p className="file-row-sub">
            {item.itemType}
            {folder ? ` · ${folder.name}` : ""}
            {(item.openedAt || item.createdAtIso) ? ` · ${formatRelativeTime(item.openedAt || item.createdAtIso)}` : ""}
          </p>
          {extLabel && <span className="file-ext-badge">{extLabel}</span>}
        </div>
      </div>
    </article>
  );
}
