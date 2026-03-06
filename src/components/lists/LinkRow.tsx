import { useState, useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DesktopItem } from "../../services/helpers";
import { formatRelativeTime } from "../../services/helpers";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
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

  const domain = extractDomain(item.sourceUrl || "");
  const userTags = (item.tags || []).filter((tg) => !tg.startsWith("status:"));
  const statusTag = (item.tags || []).find((tg) => tg.startsWith("status:"));
  const statusLabel = statusTag ? STATUS_MAP[statusTag] : null;
  const needsDesc = !item.notes?.trim();
  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : null;

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (item.sourceUrl) openUrl(item.sourceUrl).catch(() => {});
    setMenuOpen(false);
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

      <div className="row-menu">
        <button ref={btnRef} className="row-menu-btn" onClick={(e) => {
          e.stopPropagation();
          if (!menuOpen && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setMenuPos({ top: r.bottom + 4, left: r.right });
          }
          setMenuOpen(!menuOpen);
        }}>&#x22EE;</button>
        {menuOpen && (
          <div ref={menuRef} className="row-menu-dropdown open" style={{ position: "fixed", top: menuPos.top, left: "auto", right: window.innerWidth - menuPos.left }}>
            <button onClick={handleOpen}>{t("linkMenu.open")}</button>
            <button onClick={(e) => { e.stopPropagation(); openSaveLinkModal(item.id); setMenuOpen(false); }}>{t("linkMenu.edit")}</button>
            <hr />
            <button className="danger" onClick={(e) => { e.stopPropagation(); openDeleteModal({ kind: "item", id: item.id, entity: "VaultItem" }); setMenuOpen(false); }}>
              {t("menu.delete")}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
