import type { DesktopFolder } from "../../services/helpers";
import { formatRelativeTime } from "../../services/helpers";
import { useFilesStore } from "../../stores/filesStore";
import { useT } from "../../i18n";

interface Props {
  folder: DesktopFolder;
  onClick: () => void;
}

export default function FolderCard({ folder, onClick }: Props) {
  const items = useFilesStore((s) => s.items);
  const itemCount = items.filter((i) => i.folderId === folder.id).length;
  const t = useT();

  return (
    <article
      className={`folder-card group${folder.isPinned ? " folder-pinned" : ""}`}
      onClick={onClick}
    >
      <div className="folder-icon-box">📂</div>
      <div className="folder-card-body">
        <p className="folder-card-name">
          {folder.name}
          {folder.isPinned && <span className="file-pin-badge">{t("list.pinned")}</span>}
        </p>
        <p className="folder-card-sub">
          {t("files.itemCount", { count: itemCount })}
          {" · "}
          {formatRelativeTime(folder.createdAtIso)}
        </p>
      </div>
    </article>
  );
}
