import { useState } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useFilesStore } from "../../stores/filesStore";
import { useAuthStore } from "../../stores/authStore";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { usePreviewEditStore } from "../../stores/previewEditStore";
import { useSyncStore } from "../../stores/syncStore";
import { downloadFile } from "../../api";
import { getSavedEmail } from "../../storage";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { fileKindFromItem, asString, getPreviewUrlForItem } from "../../services/helpers";

function canEditBySpace(spaceId: string, createdBy: string): boolean {
  const me = getSavedEmail().trim().toLowerCase();
  const { personalSpaceId } = useAuthStore.getState();
  const { spaces } = useRemoteDataStore.getState();

  if (!spaceId) return true;

  if (spaceId === personalSpaceId) {
    if (!me || !createdBy) return true;
    return createdBy.toLowerCase() === me;
  }

  const row = spaces.find((s) => asString(s.id) === spaceId);
  if (!row) return false;

  if (me && asString(row.created_by).toLowerCase() === me) return true;

  const members = Array.isArray(row.members) ? row.members : [];
  const member = members.find(
    (m) => m && typeof m === "object" && asString((m as Record<string, unknown>).email).toLowerCase() === me
  );
  const role = asString((member as Record<string, unknown>)?.role).toLowerCase();
  return role === "owner" || role === "editor";
}

export default function FileActionModal() {
  const targetId = useUiStore((s) => s.fileActionTargetId);
  const close = useUiStore((s) => s.closeFileActionModal);
  const openManageModal = useUiStore((s) => s.openManageModal);

  const [status, setStatus] = useState("");

  if (!targetId) return null;

  const item = useFilesStore.getState().items.find((i) => i.id === targetId);
  if (!item) return null;

  const kind = fileKindFromItem(item);
  const canEdit = canEditBySpace(item.spaceId || "", item.createdBy || "");
  const baselineUpdatedAt = useSyncStore.getState().getEntityUpdatedAt("VaultItem", item.id);

  function handlePreview() {
    if (!item) return;
    close();
    usePreviewEditStore.getState().open(item.id, "preview", kind, canEdit, {
      noteDraft: item.contentText || item.notes,
      linkUrlDraft: item.sourceUrl || "",
      linkNotesDraft: item.notes,
    });
  }

  async function handleOpenNative() {
    if (!item) return;
    const previewUrl = getPreviewUrlForItem(item);
    if (!previewUrl) {
      setStatus("No file URL available for this item.");
      return;
    }
    try {
      setStatus("Downloading...");
      const bytes = await downloadFile(previewUrl);
      const savedPath = await invoke<string>("save_file_to_workspace", {
        filename: item.title,
        data: Array.from(bytes),
      });
      setStatus("Opening...");
      await openPath(savedPath);
      close();
    } catch (err) {
      setStatus(`Failed: ${String(err)}`);
    }
  }

  function handleEditInApp() {
    if (!item) return;
    close();
    usePreviewEditStore.getState().open(item.id, "edit", kind, canEdit, {
      noteDraft: item.contentText || item.notes,
      linkUrlDraft: item.sourceUrl || "",
      linkNotesDraft: item.notes,
    });
  }

  function handleManage() {
    if (!item) return;
    close();
    openManageModal({ kind: "item", id: item.id, entity: "VaultItem" }, baselineUpdatedAt);
  }

  return (
    <div className="modal">
      <div className="modal-backdrop" onClick={close} />
      <div className="modal-panel file-action-panel">
        <div className="modal-head">
          <h3>{item.title}</h3>
          <button type="button" className="ghost" onClick={close}>&#x2715;</button>
        </div>
        {status && <p className="files-scope-label">{status}</p>}
        <div className="file-action-list">
          <button type="button" className="ghost" onClick={handlePreview}>Preview</button>
          <button type="button" className="ghost" onClick={handleOpenNative}>Open Native</button>
          <button type="button" className="ghost" onClick={handleEditInApp}>Edit in App</button>
          <button type="button" className="ghost" onClick={handleManage} disabled={!canEdit}>Manage</button>
        </div>
      </div>
    </div>
  );
}
