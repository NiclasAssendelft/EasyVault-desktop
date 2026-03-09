import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { DesktopFolder } from "../../services/helpers";
import { formatRelativeTime } from "../../services/helpers";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { safeEntityUpdate } from "../../services/entityService";
import { useT } from "../../i18n";

interface Props {
  folder: DesktopFolder;
  onClick: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export default function FolderCard({ folder, onClick, selectMode, selected, onToggleSelect }: Props) {
  const openManageModal = useUiStore((s) => s.openManageModal);
  const openDeleteModal = useUiStore((s) => s.openDeleteModal);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
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
    <article
      className={`folder-card group${folder.isPinned ? " folder-pinned" : ""}${selected ? " file-row-selected" : ""}`}
      onClick={() => {
        if (selectMode && onToggleSelect) { onToggleSelect(folder.id); return; }
        onClick();
      }}
    >
      {selectMode && (
        <input
          type="checkbox"
          className="file-select-check"
          checked={!!selected}
          onChange={() => onToggleSelect?.(folder.id)}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className="folder-icon-box">📁</div>
      <div className="folder-card-body">
        <p className="folder-card-name">
          {folder.name}
          {folder.isPinned && <span className="file-pin-badge">{t("list.pinned")}</span>}
        </p>
        <p className="folder-card-sub">
          {formatRelativeTime(folder.createdAtIso)}
        </p>
      </div>
      <div className="row-menu">
        <button ref={btnRef} className="row-menu-btn" onClick={(e) => {
          e.stopPropagation();
          if (!menuOpen && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
          }
          setMenuOpen(!menuOpen);
        }}>&#x22EE;</button>
        {menuOpen && createPortal(
          <div ref={menuRef} className="row-menu-dropdown open" style={{ position: "fixed", top: menuPos.top, right: menuPos.right, left: "auto" }}>
            <button onClick={(e) => {
              e.stopPropagation();
              const next = !folder.isPinned;
              useFilesStore.getState().updateFolder(folder.id, { isPinned: next });
              useFilesStore.getState().persist();
              void safeEntityUpdate("Folder", folder.id, { is_pinned: next });
              setMenuOpen(false);
            }}>{folder.isPinned ? t("menu.unpin") : t("menu.pin")}</button>
            <button onClick={(e) => { e.stopPropagation(); openManageModal({ kind: "folder", id: folder.id, entity: "Folder" }, folder.createdAtIso); setMenuOpen(false); }}>{t("menu.manage")}</button>
            <hr />
            <button className="danger" onClick={(e) => { e.stopPropagation(); openDeleteModal({ kind: "folder", id: folder.id, entity: "Folder" }); setMenuOpen(false); }}>{t("menu.delete")}</button>
          </div>,
          document.body,
        )}
      </div>
    </article>
  );
}
