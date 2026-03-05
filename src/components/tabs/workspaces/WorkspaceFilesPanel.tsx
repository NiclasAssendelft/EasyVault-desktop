import { useState, useMemo } from "react";
import { useT } from "../../../i18n";
import { useUiStore } from "../../../stores/uiStore";
import type { DesktopItem, DesktopFolder } from "../../../services/helpers";
import { safeEntityCreate } from "../../../services/entityService";

type FilterMode = "all" | "pinned" | "recent";
type ViewMode = "list" | "grid";

interface WorkspaceFilesPanelProps {
  spaceId: string;
  spaceItems: DesktopItem[];
  spaceFolders: DesktopFolder[];
  canEdit: boolean;
  onUpload: () => void;
  onDrop: (e: React.DragEvent) => void;
}

export default function WorkspaceFilesPanel({
  spaceId,
  spaceItems,
  spaceFolders,
  canEdit,
  onUpload,
  onDrop,
}: WorkspaceFilesPanelProps) {
  const tr = useT();
  const setFileActionTargetId = useUiStore((s) => s.setFileActionTargetId);

  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [fileSearch, setFileSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);

  const filteredItems = useMemo(() => {
    let items = spaceItems;

    if (filterMode === "pinned") {
      items = items.filter((i) => i.isPinned);
    } else if (filterMode === "recent") {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      items = items.filter((i) => new Date(i.updatedAtIso || i.createdAtIso).getTime() > cutoff);
    }

    if (fileSearch.trim()) {
      const q = fileSearch.toLowerCase();
      items = items.filter((i) => i.title.toLowerCase().includes(q));
    }

    return items;
  }, [spaceItems, filterMode, fileSearch]);

  const filteredFolders = useMemo(() => {
    if (filterMode === "pinned" || filterMode === "recent") return [];
    if (!fileSearch.trim()) return spaceFolders;
    const q = fileSearch.toLowerCase();
    return spaceFolders.filter((f) => f.name.toLowerCase().includes(q));
  }, [spaceFolders, fileSearch, filterMode]);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || creatingFolder) return;
    setCreatingFolder(true);
    try {
      await safeEntityCreate("Folder", { name: newFolderName.trim(), space_id: spaceId });
      setNewFolderName("");
      setShowNewFolder(false);
    } catch {
      /* ignore */
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    onDrop(e);
  };

  const fileIcon = (item: DesktopItem) => {
    if (item.itemType === "note") return "\u{1F4DD}";
    if (item.itemType === "link") return "\u{1F517}";
    return "\u{1F4CE}";
  };

  const isEmpty = filteredFolders.length === 0 && filteredItems.length === 0;

  return (
    <div
      className={`space-files-drop${dragOver ? " drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ display: "flex", gap: 16 }}
    >
      {/* Left Mini-Sidebar */}
      <div className="ws-files-sidebar" style={{ minWidth: 160, flexShrink: 0 }}>
        <div style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={filterMode === "all" ? "active" : ""}
            onClick={() => setFilterMode("all")}
            style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 2 }}
          >
            {tr("workspaces.filterAll")}
          </button>
          <button
            type="button"
            className={filterMode === "pinned" ? "active" : ""}
            onClick={() => setFilterMode("pinned")}
            style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 2 }}
          >
            {tr("workspaces.filterPinned")}
          </button>
          <button
            type="button"
            className={filterMode === "recent" ? "active" : ""}
            onClick={() => setFilterMode("recent")}
            style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 2 }}
          >
            {tr("workspaces.filterRecent")}
          </button>
        </div>
        {filterMode === "all" && spaceFolders.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 4px", textTransform: "uppercase" }}>
              {tr("workspaces.folders")}
            </p>
            {spaceFolders.map((f) => (
              <div key={f.id} style={{ fontSize: 13, padding: "3px 0", color: "var(--fg)" }}>
                {"\u{1F4C1}"} {f.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Toolbar */}
        <div className="space-files-toolbar" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            className="space-files-search"
            placeholder={tr("workspaces.searchFiles")}
            value={fileSearch}
            onChange={(e) => setFileSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className={viewMode === "list" ? "active" : "ghost"}
            onClick={() => setViewMode("list")}
            title={tr("workspaces.listView")}
            style={{ padding: "4px 8px" }}
          >
            {"\u2630"}
          </button>
          <button
            type="button"
            className={viewMode === "grid" ? "active" : "ghost"}
            onClick={() => setViewMode("grid")}
            title={tr("workspaces.gridView")}
            style={{ padding: "4px 8px" }}
          >
            {"\u25A6"}
          </button>
          {canEdit && (
            <>
              <button type="button" onClick={onUpload}>
                {tr("workspaces.upload")}
              </button>
              <button type="button" onClick={() => setShowNewFolder(true)}>
                {tr("workspaces.newFolder")}
              </button>
            </>
          )}
        </div>

        {/* New Folder Inline Input */}
        {showNewFolder && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              placeholder={tr("workspaces.folderName")}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") {
                  setShowNewFolder(false);
                  setNewFolderName("");
                }
              }}
              autoFocus
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={handleCreateFolder}
              disabled={creatingFolder || !newFolderName.trim()}
            >
              {tr("workspaces.create")}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setShowNewFolder(false);
                setNewFolderName("");
              }}
            >
              {tr("workspaces.cancel")}
            </button>
          </div>
        )}

        {dragOver && (
          <div className="space-files-drag-hint">{tr("workspaces.dragFiles")}</div>
        )}

        {/* Empty State */}
        {isEmpty && !dragOver && (
          <div className="dash-card" style={{ textAlign: "center", padding: 32 }}>
            <p style={{ marginBottom: 16 }}>{tr("workspaces.noFiles")}</p>
            {canEdit && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button type="button" onClick={onUpload}>
                  {tr("workspaces.upload")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* List View */}
        {!isEmpty && viewMode === "list" && (
          <div className="files-items">
            {filteredFolders.map((folder) => (
              <article key={folder.id} className="file-row group">
                <div className="file-row-icon">{"\u{1F4C1}"}</div>
                <div className="file-row-body">
                  <p className="file-row-title">{folder.name}</p>
                </div>
              </article>
            ))}
            {filteredItems.map((item) => (
              <article
                key={item.id}
                className="file-row group"
                style={{ cursor: "pointer" }}
                onClick={() => setFileActionTargetId(item.id)}
              >
                <div className="file-row-icon">{fileIcon(item)}</div>
                <div className="file-row-body">
                  <p className="file-row-title">{item.title}</p>
                  <p className="file-row-sub">{item.itemType}</p>
                </div>
                {item.isPinned && (
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{"\u{1F4CC}"}</span>
                )}
              </article>
            ))}
          </div>
        )}

        {/* Grid View */}
        {!isEmpty && viewMode === "grid" && (
          <div className="ws-grid-view">
            {filteredFolders.map((folder) => (
              <div key={folder.id} className="ws-grid-card">
                <div style={{ fontSize: 28, marginBottom: 8 }}>{"\u{1F4C1}"}</div>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0, wordBreak: "break-word" }}>
                  {folder.name}
                </p>
              </div>
            ))}
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="ws-grid-card"
                style={{ cursor: "pointer" }}
                onClick={() => setFileActionTargetId(item.id)}
              >
                <div style={{ fontSize: 28, marginBottom: 8 }}>{fileIcon(item)}</div>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0, wordBreak: "break-word" }}>
                  {item.title}
                </p>
                <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 0" }}>
                  {item.itemType}
                </p>
                {item.isPinned && (
                  <span style={{ position: "absolute", top: 6, right: 8, fontSize: 12 }}>
                    {"\u{1F4CC}"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
