import type { DesktopFolder } from "../../services/helpers";
import { formatRelativeTime } from "../../services/helpers";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { safeEntityUpdate } from "../../services/entityService";
import { useT } from "../../i18n";
import { IconFolder } from "../icons";
import RowMenu from "../RowMenu";

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
  const t = useT();

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
      <div className="folder-icon-box"><IconFolder size={20} /></div>
      <div className="folder-card-body">
        <p className="folder-card-name">
          {folder.name}
          {folder.isPinned && <span className="file-pin-badge">{t("list.pinned")}</span>}
        </p>
        <p className="folder-card-sub">
          {formatRelativeTime(folder.createdAtIso)}
        </p>
      </div>
      <RowMenu
        items={[
          {
            key: "pin",
            label: folder.isPinned ? t("menu.unpin") : t("menu.pin"),
            onSelect: (e) => {
              e.stopPropagation();
              const next = !folder.isPinned;
              useFilesStore.getState().updateFolder(folder.id, { isPinned: next });
              useFilesStore.getState().persist();
              void safeEntityUpdate("Folder", folder.id, { is_pinned: next });
            },
          },
          {
            key: "manage",
            label: t("menu.manage"),
            onSelect: (e) => {
              e.stopPropagation();
              openManageModal({ kind: "folder", id: folder.id, entity: "Folder" }, folder.createdAtIso);
            },
          },
          {
            key: "delete",
            label: t("menu.delete"),
            danger: true,
            separatorBefore: true,
            onSelect: (e) => {
              e.stopPropagation();
              openDeleteModal({ kind: "folder", id: folder.id, entity: "Folder" });
            },
          },
        ]}
      />
    </article>
  );
}
