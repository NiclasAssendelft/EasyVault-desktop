import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import FolderCard from "../lists/FolderCard";
import ItemRow from "../lists/ItemRow";

export default function FilesTab() {
  const folders = useFilesStore((s) => s.folders);
  const items = useFilesStore((s) => s.items);
  const activeFolderId = useFilesStore((s) => s.activeFolderId);
  const setActiveFolderId = useFilesStore((s) => s.setActiveFolderId);
  const openNewModal = useUiStore((s) => s.openNewModal);

  const activeFolder = folders.find((f) => f.id === activeFolderId);
  const visibleItems = activeFolderId
    ? items.filter((i) => i.folderId === activeFolderId)
    : items;

  if (activeFolder) {
    return (
      <section className="tab-panel">
        <div className="files-folder-head">
          <div className="files-folder-crumb">
            ⌂ <span>›</span> <span>{activeFolder.name}</span>
          </div>
          <div className="actions-row file-head-actions">
            <button type="button" className="ghost">Upload</button>
            <button type="button" onClick={openNewModal}>+ New</button>
          </div>
        </div>
        <div className="files-folder-toolbar">
          <button type="button" className="ghost" onClick={() => setActiveFolderId("")}>
            ← Back
          </button>
        </div>
        <h2 className="files-folder-page-title">{activeFolder.name}</h2>
        <div className="files-items">
          {visibleItems.length === 0 ? (
            <div className="dash-card"><p>No items in this folder</p></div>
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
          <h2 className="page-title">Files</h2>
          <p className="page-subtitle">Folders and files</p>
        </div>
        <div className="actions-row file-head-actions">
          <button type="button" className="ghost">Upload</button>
          <button type="button" onClick={openNewModal}>+ New</button>
        </div>
      </div>
      <div>
        <h4 className="section-label">Folders</h4>
        <div className="files-folders">
          {folders.length === 0 ? (
            <div className="dash-card"><p>No folders yet</p></div>
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
        <h4 className="section-label">Files & Items</h4>
        <p className="files-scope-label">Showing all folders</p>
        <div className="files-items">
          {items.length === 0 ? (
            <div className="dash-card"><p>No items yet</p></div>
          ) : (
            items.map((item) => <ItemRow key={item.id} item={item} />)
          )}
        </div>
      </div>
    </section>
  );
}
