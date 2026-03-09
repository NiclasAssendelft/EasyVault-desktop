import { useState, useEffect, useRef } from "react";
import type { DesktopItem } from "../../services/helpers";
import { formatRelativeTime } from "../../services/helpers";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { safeEntityUpdate } from "../../services/entityService";
import { useT } from "../../i18n";

interface Props {
  item: DesktopItem;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
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

export default function ItemRow({ item, selectMode, selected, onToggleSelect }: Props) {
  const setFileActionTargetId = useUiStore((s) => s.setFileActionTargetId);
  const openManageModal = useUiStore((s) => s.openManageModal);
  const openDeleteModal = useUiStore((s) => s.openDeleteModal);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const cfg = getIconConfig(item);
  const extLabel = fileExtLabel(item);
  const t = useT();

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <article className={`file-row group${selected ? " file-row-selected" : ""}`} onClick={() => {
      if (selectMode && onToggleSelect) { onToggleSelect(item.id); return; }
      setFileActionTargetId(item.id);
    }}>
      {selectMode && (
        <input
          type="checkbox"
          className="file-select-check"
          checked={!!selected}
          onChange={() => onToggleSelect?.(item.id)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
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
            {(item.openedAt || item.createdAtIso) ? formatRelativeTime(item.openedAt || item.createdAtIso) : ""}
          </p>
          {extLabel && <span className="file-ext-badge">{extLabel}</span>}
        </div>
      </div>
      <div className="row-menu">
        <button ref={btnRef} className="row-menu-btn" onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(!menuOpen);
        }}>&#x22EE;</button>
        {menuOpen && (
          <div ref={menuRef} className="row-menu-dropdown open">
            <button onClick={(e) => {
              e.stopPropagation();
              const next = !item.isPinned;
              useFilesStore.getState().updateItem(item.id, { isPinned: next });
              useFilesStore.getState().persist();
              void safeEntityUpdate("VaultItem", item.id, { is_pinned: next });
              setMenuOpen(false);
            }}>{item.isPinned ? t("menu.unpin") : t("menu.pin")}</button>
            <button onClick={(e) => { e.stopPropagation(); openManageModal({ kind: "item", id: item.id, entity: "VaultItem" }, item.updatedAtIso || item.createdAtIso); setMenuOpen(false); }}>{t("menu.manage")}</button>
            <hr />
            <button className="danger" onClick={(e) => { e.stopPropagation(); openDeleteModal({ kind: "item", id: item.id, entity: "VaultItem" }); setMenuOpen(false); }}>{t("menu.delete")}</button>
          </div>
        )}
      </div>
    </article>
  );
}
