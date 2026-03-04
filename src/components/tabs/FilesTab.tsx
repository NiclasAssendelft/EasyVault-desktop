import { useCallback, useMemo } from "react";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { uploadSelectedFilesToFolder } from "../../services/fileOps";
import { useT } from "../../i18n";
import FolderCard from "../lists/FolderCard";
import ItemRow from "../lists/ItemRow";

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
  const t = useT();

  const activeFolder = folders.find((f) => f.id === activeFolderId);
  const visibleItems = useMemo(() => {
    const filtered = activeFolderId
      ? items.filter((i) => i.folderId === activeFolderId)
      : items;
    return [...filtered].sort(sortByRecentlyOpened);
  }, [items, activeFolderId]);

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
      <div>
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
        <h4 className="section-label">{t("files.filesAndItems")}</h4>
        <p className="files-scope-label">{t("files.showingAll")}</p>
        <div className="files-items">
          {items.length === 0 ? (
            <div className="dash-card"><p>{t("files.noItems")}</p></div>
          ) : (
            items.map((item) => <ItemRow key={item.id} item={item} />)
          )}
        </div>
      </div>
    </section>
  );
}
