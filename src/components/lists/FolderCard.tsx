import type { DesktopFolder } from "../../services/helpers";
import { formatRelativeTime } from "../../services/helpers";

interface Props {
  folder: DesktopFolder;
  onClick: () => void;
}

export default function FolderCard({ folder, onClick }: Props) {
  return (
    <article className="folder-card" onClick={onClick}>
      <div className="folder-card-icon">📁</div>
      <div className="folder-card-body">
        <p className="folder-card-name">{folder.name}</p>
        <p className="folder-card-sub">
          {formatRelativeTime(folder.createdAtIso)}
          {folder.isPinned ? " • pinned" : ""}
        </p>
      </div>
    </article>
  );
}
