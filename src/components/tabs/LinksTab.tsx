import { useMemo, useState } from "react";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { useAuthStore } from "../../stores/authStore";
import { useT } from "../../i18n";
import LinkRow from "../lists/LinkRow";

type StatusFilter = "" | "status:unread" | "status:reference" | "status:done";
type LocationFilter = "all" | "personal" | "hub";

export default function LinksTab() {
  const items = useFilesStore((s) => s.items);
  const personalSpaceId = useAuthStore((s) => s.personalSpaceId);
  const openSaveLinkModal = useUiStore((s) => s.openSaveLinkModal);
  const openImportLinksModal = useUiStore((s) => s.openImportLinksModal);
  const t = useT();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [locationFilter, setLocationFilter] = useState<LocationFilter>("all");

  const links = useMemo(() => {
    let result = items.filter((i) => i.itemType === "link");

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((i) =>
        i.title.toLowerCase().includes(q) ||
        (i.notes || "").toLowerCase().includes(q) ||
        (i.sourceUrl || "").toLowerCase().includes(q) ||
        (i.tags || []).some((tag) => tag.toLowerCase().includes(q))
      );
    }

    if (statusFilter) {
      result = result.filter((i) => (i.tags || []).includes(statusFilter));
    }

    if (locationFilter === "personal") {
      result = result.filter((i) => !i.spaceId || i.spaceId === personalSpaceId);
    } else if (locationFilter === "hub") {
      result = result.filter((i) => i.spaceId && i.spaceId !== personalSpaceId);
    }

    return [...result].sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
  }, [items, search, statusFilter, locationFilter, personalSpaceId]);

  return (
    <section className="tab-panel">
      <div className="tab-head-row">
        <div>
          <h2 className="page-title">{t("links.title")}</h2>
          <p className="page-subtitle">{t("links.subtitle")}</p>
        </div>
        <div className="actions-row">
          <button type="button" className="ghost" onClick={openImportLinksModal}>{t("links.import")}</button>
          <button type="button" onClick={() => openSaveLinkModal()}>{t("links.new")}</button>
        </div>
      </div>

      <div className="links-search-row">
        <input
          type="text"
          className="links-search-input"
          placeholder={t("links.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="links-filter-row">
        {(["", "status:unread", "status:reference", "status:done"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            className={`links-filter-pill${statusFilter === s ? " active" : ""}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === "" ? t("links.filterAll")
              : s === "status:unread" ? t("links.filterUnread")
              : s === "status:reference" ? t("links.filterReference")
              : t("links.filterDone")}
          </button>
        ))}
        <span className="links-filter-divider">|</span>
        {(["all", "personal", "hub"] as LocationFilter[]).map((l) => (
          <button
            key={l}
            type="button"
            className={`links-filter-pill${locationFilter === l ? " active" : ""}`}
            onClick={() => setLocationFilter(l)}
          >
            {l === "all" ? t("links.filterAll")
              : l === "personal" ? t("links.filterPersonal")
              : t("links.filterHub")}
          </button>
        ))}
      </div>

      <div className="files-items">
        {links.length === 0 ? (
          <div className="dash-card"><p>{t("links.noLinks")}</p></div>
        ) : (
          links.map((item) => <LinkRow key={item.id} item={item} />)
        )}
      </div>
    </section>
  );
}
