import { useState } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useFilesStore } from "../../stores/filesStore";
import { deleteRemoteEntity } from "../../services/entityService";
import { syncRemoteDelta } from "../../services/deltaSyncService";
import { useSyncStore } from "../../stores/syncStore";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { asString } from "../../services/helpers";

export default function DeleteModal() {
  const target = useUiStore((s) => s.deleteTarget);
  const closeDeleteModal = useUiStore((s) => s.closeDeleteModal);

  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState("");

  if (!target) return null;

  function getEntityName(): string {
    if (target!.kind === "folder") {
      const folder = useFilesStore.getState().folders.find((f) => f.id === target!.id);
      return folder?.name || "this folder";
    }
    if (target!.entity === "VaultItem") {
      const item = useFilesStore.getState().items.find((i) => i.id === target!.id);
      return item?.title || "this item";
    }
    if (target!.entity === "EmailItem") {
      const row = useRemoteDataStore.getState().emails.find((e) => asString(e.id) === target!.id);
      return row ? asString(row.subject, "this email") : "this email";
    }
    if (target!.entity === "CalendarEvent") {
      const row = useRemoteDataStore.getState().events.find((e) => asString(e.id) === target!.id);
      return row ? asString(row.title, "this event") : "this event";
    }
    if (target!.entity === "Space") {
      const row = useRemoteDataStore.getState().spaces.find((s) => asString(s.id) === target!.id);
      return row ? asString(row.name, "this space") : "this space";
    }
    return "this item";
  }

  function forceClose() {
    setDeleting(false);
    setFeedback("");
    closeDeleteModal();
  }

  async function handleDelete() {
    if (!target) return;
    setDeleting(true);
    setFeedback("");

    try {
      if (target.entity === "Folder") {
        useFilesStore.getState().updateFolder(target.id, { isDeleting: true });

        await deleteRemoteEntity("Folder", target.id);

        // Move items in this folder to root
        const items = useFilesStore.getState().items.filter((i) => i.folderId === target.id);
        for (const item of items) {
          useFilesStore.getState().updateItem(item.id, { folderId: "" });
        }

        useFilesStore.getState().removeFolder(target.id);
        useSyncStore.getState().removeEntityUpdatedAt("Folder", target.id);
        useFilesStore.getState().persist();

        forceClose();
      } else if (target.entity === "VaultItem") {
        useFilesStore.getState().updateItem(target.id, { isDeleting: true });

        await deleteRemoteEntity("VaultItem", target.id);

        useFilesStore.getState().removeItem(target.id);
        useSyncStore.getState().removeEntityUpdatedAt("VaultItem", target.id);
        useFilesStore.getState().persist();

        forceClose();
      } else {
        // EmailItem, CalendarEvent, Space
        await deleteRemoteEntity(target.entity, target.id);
        useSyncStore.getState().removeEntityUpdatedAt(target.entity, target.id);
        await syncRemoteDelta();

        forceClose();
      }
    } catch (err) {
      // Re-enable on error
      if (target.entity === "Folder") {
        useFilesStore.getState().updateFolder(target.id, { isDeleting: false });
      } else if (target.entity === "VaultItem") {
        useFilesStore.getState().updateItem(target.id, { isDeleting: false });
      }
      setFeedback(`Delete failed: ${String(err)}`);
      setDeleting(false);
    }
  }

  return (
    <div className="modal">
      <div className="modal-backdrop" onClick={deleting ? undefined : forceClose} />
      <div className="modal-panel">
        <div className="modal-head">
          <h3>Delete {target.kind === "folder" ? "Folder" : "Item"}?</h3>
        </div>
        <p className="files-scope-label">
          Are you sure you want to delete <strong>{getEntityName()}</strong>? This action cannot be undone.
        </p>
        {feedback && <p className="feedback-text">{feedback}</p>}
        <div className="actions-row">
          <button type="button" className="ghost" onClick={forceClose} disabled={deleting}>Cancel</button>
          <button type="button" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
