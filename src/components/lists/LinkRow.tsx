import { openUrl } from "@tauri-apps/plugin-opener";
import type { DesktopItem } from "../../services/helpers";
import { formatRelativeTime } from "../../services/helpers";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import RowMenu from "../RowMenu";

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

const STATUS_MAP: Record<string, string> = {
  "status:unread": "unread",
  "status:read": "read",
};

export default function LinkRow({ item }: { item: DesktopItem }) {
  const openSaveLinkModal = useUiStore((s) => s.openSaveLinkModal);
  const openDeleteModal = useUiStore((s) => s.openDeleteModal);
  const t = useT();

  const domain = extractDomain(item.sourceUrl || "");
  const userTags = (item.tags || []).filter((tg) => !tg.startsWith("status:"));
  const statusTag = (item.tags || []).find((tg) => tg.startsWith("status:"));
  const statusLabel = statusTag ? STATUS_MAP[statusTag] : null;
  const needsDesc = !item.notes?.trim();
  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : null;

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (item.sourceUrl) openUrl(item.sourceUrl).catch(() => {});
  }

  function handleRowClick() {
    if (item.sourceUrl) openUrl(item.sourceUrl).catch(() => {});
  }

  return (
    <article className="file-row link-row group" onClick={handleRowClick}>
      <div className="link-row-icon-wrap">
        {faviconUrl
          ? <img className="link-favicon" src={faviconUrl} width={16} height={16} alt="" />
          : <div className="file-type-badge" style={{ background: "#0891b2" }}>URL</div>
        }
      </div>

      <div className="file-row-body">
        <p className="file-row-title">
          {item.title}
          {item.isPinned && <span className="file-pin-badge">{t("list.pinned")}</span>}
          {needsDesc && <span className="link-needs-desc-badge">{t("links.needsDesc")}</span>}
          {statusLabel && (
            <span className={`link-status-badge link-status-${statusLabel}`}>
              {statusLabel === "unread" ? t("links.filterUnread") : t("links.filterRead")}
            </span>
          )}
        </p>
        <div className="file-row-meta">
          {domain && <span className="link-domain-pill">{domain}</span>}
          <p className="file-row-sub">{formatRelativeTime(item.createdAtIso)}</p>
        </div>
        {item.notes && <p className="link-row-desc">{item.notes}</p>}
        {userTags.length > 0 && (
          <div className="link-row-tags">
            {userTags.map((tag) => <span key={tag} className="link-tag-chip">{tag}</span>)}
          </div>
        )}
      </div>

      <RowMenu
        items={[
          { key: "open", label: t("linkMenu.open"), onSelect: handleOpen },
          {
            key: "edit",
            label: t("linkMenu.edit"),
            onSelect: (e) => { e.stopPropagation(); openSaveLinkModal(item.id); },
          },
          {
            key: "delete",
            label: t("menu.delete"),
            danger: true,
            separatorBefore: true,
            onSelect: (e) => {
              e.stopPropagation();
              openDeleteModal({ kind: "item", id: item.id, entity: "VaultItem" });
            },
          },
        ]}
      />
    </article>
  );
}
