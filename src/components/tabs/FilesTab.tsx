import { useCallback, useMemo, useState } from "react";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { useAuthStore } from "../../stores/authStore";
import { uploadSelectedFilesToFolder } from "../../services/fileOps";
import { deleteRemoteEntity, safeEntityUpdate } from "../../services/entityService";
import { useSyncStore } from "../../stores/syncStore";
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
  const setStatus = useUiStore((s) => s.setStatus);
  const personalSpaceId = useAuthStore((s) => s.personalSpaceId);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
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

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setMovePickerOpen(false);
  }, []);

  const selectAllVisible = useCallback(() => {
    const allIds = new Set<string>();
    if (categoryFilter === "all" && !activeFolderId) {
      for (const f of folders) allIds.add(f.id);
    }
    for (const i of visibleItems) allIds.add(i.id);
    setSelectedIds(allIds);
  }, [folders, visibleItems, categoryFilter, activeFolderId]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    const store = useFilesStore.getState();
    const syncStore = useSyncStore.getState();
    let count = 0;
    for (const id of selectedIds) {
      try {
        const isFolder = store.folders.some((f) => f.id === id);
        if (isFolder) {
          store.updateFolder(id, { isDeleting: true });
          await deleteRemoteEntity("Folder", id);
          const childItems = store.items.filter((i) => i.folderId === id);
          for (const child of childItems) store.updateItem(child.id, { folderId: "" });
          store.removeFolder(id);
          syncStore.removeEntityUpdatedAt("Folder", id);
        } else {
          store.updateItem(id, { isDeleting: true });
          await deleteRemoteEntity("VaultItem", id);
          store.removeItem(id);
          syncStore.removeEntityUpdatedAt("VaultItem", id);
        }
        count++;
      } catch (err) {
        console.warn(`Bulk delete failed for ${id}:`, err);
      }
    }
    store.persist();
    setStatus(t("files.bulkDeleteDone", { count: String(count) }));
    setBulkBusy(false);
    exitSelectMode();
  }, [selectedIds, bulkBusy, exitSelectMode, setStatus, t]);

  const handleBulkMove = useCallback(async (targetFolderId: string) => {
    if (selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    const store = useFilesStore.getState();
    let count = 0;
    for (const id of selectedIds) {
      const isFolder = store.folders.some((f) => f.id === id);
      if (isFolder) continue; // can't move folders into folders
      try {
        store.updateItem(id, { folderId: targetFolderId });
        await safeEntityUpdate("VaultItem", id, { folder_id: targetFolderId });
        count++;
      } catch (err) {
        console.warn(`Bulk move failed for ${id}:`, err);
      }
    }
    store.persist();
    setStatus(t("files.bulkMoveDone", { count: String(count) }));
    setBulkBusy(false);
    exitSelectMode();
  }, [selectedIds, bulkBusy, exitSelectMode, setStatus, t]);

  // Bulk action bar component
  const bulkBar = selectMode && (
    <div className="bulk-action-bar">
      <span className="bulk-count">{selectedIds.size} selected</span>
      <button type="button" className="ghost" onClick={selectAllVisible}>{t("files.selectAll")}</button>
      <button
        type="button"
        className="danger"
        disabled={selectedIds.size === 0 || bulkBusy}
        onClick={() => void handleBulkDelete()}
      >
        {bulkBusy ? t("files.deleting") : t("files.deleteSelected", { count: String(selectedIds.size) })}
      </button>
      <div className="bulk-move-wrap">
        <button
          type="button"
          disabled={selectedIds.size === 0 || bulkBusy}
          onClick={() => setMovePickerOpen(!movePickerOpen)}
        >
          {t("files.moveSelected")}
        </button>
        {movePickerOpen && (
          <div className="bulk-move-dropdown">
            <div className="bulk-move-label">{t("files.moveTo")}</div>
            <button type="button" onClick={() => { void handleBulkMove(""); setMovePickerOpen(false); }}>
              {t("files.rootLevel")}
            </button>
            {folders.map((f) => (
              <button key={f.id} type="button" onClick={() => { void handleBulkMove(f.id); setMovePickerOpen(false); }}>
                📁 {f.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="ghost" onClick={exitSelectMode}>{t("files.cancel")}</button>
    </div>
  );

  if (activeFolder) {
    return (
      <section className="tab-panel">
        <div className="files-folder-head">
          <div className="files-folder-crumb">
            ⌂ <span>›</span> <span>{activeFolder.name}</span>
          </div>
          <div className="actions-row file-head-actions">
            <button type="button" className={`ghost${selectMode ? " active" : ""}`} onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}>{t("files.select")}</button>
            <button type="button" className="ghost" onClick={handleUpload}>{t("files.upload")}</button>
            <button type="button" onClick={openNewModal}>{t("files.new")}</button>
          </div>
        </div>
        <div className="files-folder-toolbar">
          <button type="button" className="ghost" onClick={() => { exitSelectMode(); setActiveFolderId(""); }}>
            {t("files.back")}
          </button>
        </div>
        <h2 className="files-folder-page-title">{activeFolder.name}</h2>
        <div className="files-items">
          {visibleItems.length === 0 ? (
            <div className="dash-card"><p>{t("files.noItemsInFolder")}</p></div>
          ) : (
            visibleItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                selectMode={selectMode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={toggleSelect}
              />
            ))
          )}
        </div>
        {bulkBar}
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
          <button type="button" className={`ghost${selectMode ? " active" : ""}`} onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}>{t("files.select")}</button>
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
                    selectMode={selectMode}
                    selected={selectedIds.has(folder.id)}
                    onToggleSelect={toggleSelect}
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
            visibleItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                selectMode={selectMode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={toggleSelect}
              />
            ))
          )}
        </div>
      </div>
      {bulkBar}
    </section>
  );
}
