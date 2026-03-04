import type { DesktopFolder } from "../../services/helpers";
import { formatRelativeTime } from "../../services/helpers";
import { useT } from "../../i18n";

interface Props {
  folder: DesktopFolder;
  onClick: () => void;
}

export default function FolderCard({ folder, onClick }: Props) {
  const t = useT();
  return (
    <article className="folder-card" onClick={onClick}>
      <div className="folder-card-icon">📁</div>
      <div className="folder-card-body">
        <p className="folder-card-name">{folder.name}</p>
        <p className="folder-card-sub">
          {formatRelativeTime(folder.createdAtIso)}
          {folder.isPinned ? ` • ${t("list.pinned")}` : ""}
        </p>
      </div>
    </article>
  );
}
