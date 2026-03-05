import { useCallback, useMemo, useState } from "react";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { useAuthStore } from "../../stores/authStore";
import { uploadSelectedFilesToFolder } from "../../services/fileOps";
import { useT } from "../../i18n";
import FolderCard from "../lists/FolderCard";
import ItemRow from "../lists/ItemRow";

type CategoryFilter = "all" | "recent" | "shared" | "pinned";

function sortByRecentlyOpened<T extends { openedAt?: string; createdAtIso: string }>(a: T, b: T): number {
  const aTime = a.openedAt || "";
  const bTime = b.openedAt || "";
  if (aTime && bTime) return bTime.localeCompare(aTime);
  if (aTime) return -1;
  if (bTime) return 1;
  return b.createdAtIso.localeCompare(a.createdAtIso);
}

export default function FilesTab() {
  const folders = useFilesStore((s) => s.folders);
  const items = useFilesStore((s) => s.items);
  const activeFolderId = useFilesStore((s) => s.activeFolderId);
  const setActiveFolderId = useFilesStore((s) => s.setActiveFolderId);
  const openNewModal = useUiStore((s) => s.openNewModal);
  const personalSpaceId = useAuthStore((s) => s.personalSpaceId);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const t = useT();

  const activeFolder = folders.find((f) => f.id === activeFolderId);

  const fileItems = useMemo(() => items.filter((i) => i.itemType !== "link"), [items]);

  const recentItems = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    return fileItems.filter((i) => {
      const d = i.openedAt || i.createdAtIso;
      return d && d >= cutoff.toISOString();
    });
  }, [fileItems]);

  const sharedItems = useMemo(
    () => fileItems.filter((i) => i.spaceId && i.spaceId !== personalSpaceId),
    [fileItems, personalSpaceId],
  );

  const pinnedItems = useMemo(() => fileItems.filter((i) => i.isPinned), [fileItems]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const i of fileItems) for (const tag of i.tags) set.add(tag);
    return [...set].sort();
  }, [fileItems]);

  const visibleItems = useMemo(() => {
    let base = activeFolderId
      ? fileItems.filter((i) => i.folderId === activeFolderId)
      : categoryFilter === "recent"
        ? recentItems
        : categoryFilter === "shared"
          ? sharedItems
          : categoryFilter === "pinned"
            ? pinnedItems
            : fileItems;
    if (selectedTags.size > 0) {
      base = base.filter((i) => [...selectedTags].every((tag) => i.tags.includes(tag)));
    }
    return [...base].sort(sortByRecentlyOpened);
  }, [items, activeFolderId, categoryFilter, recentItems, sharedItems, pinnedItems, selectedTags]);

  const handleUpload = useCallback(() => {
    void uploadSelectedFilesToFolder(activeFolderId || "");
  }, [activeFolderId]);

  if (activeFolder) {
    return (
      <section className="tab-panel">
        <div className="files-folder-head">
          <div className="files-folder-crumb">
            ⌂ <span>›</span> <span>{activeFolder.name}</span>
          </div>
          <div className="actions-row file-head-actions">
            <button type="button" className="ghost" onClick={handleUpload}>{t("files.upload")}</button>
            <button type="button" onClick={openNewModal}>{t("files.new")}</button>
          </div>
        </div>
        <div className="files-folder-toolbar">
          <button type="button" className="ghost" onClick={() => setActiveFolderId("")}>
            {t("files.back")}
          </button>
        </div>
        <h2 className="files-folder-page-title">{activeFolder.name}</h2>
        <div className="files-items">
          {visibleItems.length === 0 ? (
            <div className="dash-card"><p>{t("files.noItemsInFolder")}</p></div>
          ) : (
            visibleItems.map((item) => <ItemRow key={item.id} item={item} />)
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="tab-panel">
      <div className="tab-head-row">
        <div>
          <h2 className="page-title">{t("files.title")}</h2>
          <p className="page-subtitle">{t("files.subtitle")}</p>
        </div>
        <div className="actions-row file-head-actions">
          <button type="button" className="ghost" onClick={handleUpload}>{t("files.upload")}</button>
          <button type="button" onClick={openNewModal}>{t("files.new")}</button>
        </div>
      </div>
      <div className="files-category-cards">
        <button
          type="button"
          className={`files-category-card cat-recent${categoryFilter === "recent" ? " active" : ""}`}
          onClick={() => setCategoryFilter(categoryFilter === "recent" ? "all" : "recent")}
        >
          <span className="cat-icon">&#128337;</span>
          <div>
            <div className="cat-label">{t("files.catRecent")}</div>
            <div className="cat-count">{recentItems.length} {t("files.catItems")}</div>
          </div>
        </button>
        <button
          type="button"
          className={`files-category-card cat-shared${categoryFilter === "shared" ? " active" : ""}`}
          onClick={() => setCategoryFilter(categoryFilter === "shared" ? "all" : "shared")}
        >
          <span className="cat-icon">&#128101;</span>
          <div>
            <div className="cat-label">{t("files.catShared")}</div>
            <div className="cat-count">{sharedItems.length} {t("files.catItems")}</div>
          </div>
        </button>
        <button
          type="button"
          className={`files-category-card cat-pinned${categoryFilter === "pinned" ? " active" : ""}`}
          onClick={() => setCategoryFilter(categoryFilter === "pinned" ? "all" : "pinned")}
        >
          <span className="cat-icon">{"\uD83D\uDCCC"}</span>
          <div>
            <div className="cat-label">{t("files.catPinned")}</div>
            <div className="cat-count">{pinnedItems.length} {t("files.catItems")}</div>
          </div>
        </button>
      </div>

      {allTags.length > 0 && (
        <div className="tag-filter-row">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`tag-chip${selectedTags.has(tag) ? " active" : ""}`}
              onClick={() => {
                setSelectedTags((prev) => {
                  const next = new Set(prev);
                  if (next.has(tag)) next.delete(tag); else next.add(tag);
                  return next;
                });
              }}
            >
              {tag}
            </button>
          ))}
          {selectedTags.size > 0 && (
            <button type="button" className="tag-chip tag-chip-clear" onClick={() => setSelectedTags(new Set())}>
              {"\u2715"}
            </button>
          )}
        </div>
      )}

      <div>
        {categoryFilter === "all" && (
          <>
            <h4 className="section-label">{t("files.folders")}</h4>
            <div className="files-folders">
              {folders.length === 0 ? (
                <div className="dash-card"><p>{t("files.noFolders")}</p></div>
              ) : (
                folders.map((folder) => (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    onClick={() => setActiveFolderId(folder.id)}
                  />
                ))
              )}
            </div>
          </>
        )}
        <h4 className="section-label">{t("files.files")}</h4>
        <div className="files-items">
          {visibleItems.length === 0 ? (
            <div className="dash-card"><p>{t("files.noItems")}</p></div>
          ) : (
            visibleItems.map((item) => <ItemRow key={item.id} item={item} />)
          )}
        </div>
      </div>
    </section>
  );
}
