import type { DesktopItem } from "../../services/helpers";
import { formatRelativeTime } from "../../services/helpers";
import { useUiStore } from "../../stores/uiStore";
import { useFilesStore } from "../../stores/filesStore";
import { useT } from "../../i18n";

interface Props {
  item: DesktopItem;
}

const TYPE_ICONS: Record<string, string> = {
  note: "📝",
  link: "🔗",
  file_reference: "📎",
  email_reference: "✉",
  uploaded_file: "📄",
  managed_file: "📄",
};

export default function ItemRow({ item }: Props) {
  const setFileActionTargetId = useUiStore((s) => s.setFileActionTargetId);
  const folders = useFilesStore((s) => s.folders);
  const folder = folders.find((f) => f.id === item.folderId);
  const icon = TYPE_ICONS[item.itemType] || "📄";
  const t = useT();

  return (
    <article className="file-row group" onClick={() => setFileActionTargetId(item.id)}>
      <div className="file-row-icon">{icon}</div>
      <div className="file-row-body">
        <p className="file-row-title">
          {item.isUploading ? "⏳ " : ""}
          {item.title}
        </p>
        <p className="file-row-sub">
          {item.itemType}
          {folder ? ` • ${folder.name}` : ""}
          {(item.openedAt || item.createdAtIso) ? ` • ${formatRelativeTime(item.openedAt || item.createdAtIso)}` : ""}
          {item.isPinned ? ` • ${t("list.pinned")}` : ""}
          {item.isFavorite ? " • ★" : ""}
        </p>
      </div>
    </article>
  );
}
