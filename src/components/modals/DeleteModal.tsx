import { useState } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useFilesStore } from "../../stores/filesStore";
import { deleteRemoteEntity } from "../../services/entityService";
import { syncRemoteDelta } from "../../services/deltaSyncService";
import { useSyncStore } from "../../stores/syncStore";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { asString } from "../../services/helpers";
import { useT } from "../../i18n";

export default function DeleteModal() {
  const target = useUiStore((s) => s.deleteTarget);
  const closeDeleteModal = useUiStore((s) => s.closeDeleteModal);
  const t = useT();

  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState("");

  if (!target) return null;

  function getEntityName(): string {
    if (target!.kind === "folder") {
      const folder = useFilesStore.getState().folders.find((f) => f.id === target!.id);
      return folder?.name || t("delete.thisFolder");
    }
    if (target!.entity === "VaultItem") {
      const item = useFilesStore.getState().items.find((i) => i.id === target!.id);
      return item?.title || t("delete.thisItem");
    }
    if (target!.entity === "EmailItem") {
      const row = useRemoteDataStore.getState().emails.find((e) => asString(e.id) === target!.id);
      return row ? asString(row.subject, t("delete.thisEmail")) : t("delete.thisEmail");
    }
    if (target!.entity === "CalendarEvent") {
      const row = useRemoteDataStore.getState().events.find((e) => asString(e.id) === target!.id);
      return row ? asString(row.title, t("delete.thisEvent")) : t("delete.thisEvent");
    }
    if (target!.entity === "Space") {
      const row = useRemoteDataStore.getState().spaces.find((s) => asString(s.id) === target!.id);
      return row ? asString(row.name, t("delete.thisSpace")) : t("delete.thisSpace");
    }
    if (target!.entity === "GatherPack") {
      const row = useRemoteDataStore.getState().packs.find((p) => asString(p.id) === target!.id);
      return row ? asString(row.title, t("delete.thisPack")) : t("delete.thisPack");
    }
    return t("delete.thisItem");
  }

  function forceClose() { setDeleting(false); setFeedback(""); closeDeleteModal(); }

  async function handleDelete() {
    if (!target) return;
    setDeleting(true); setFeedback("");

    try {
      if (target.entity === "Folder") {
        useFilesStore.getState().updateFolder(target.id, { isDeleting: true });
        await deleteRemoteEntity("Folder", target.id);
        const items = useFilesStore.getState().items.filter((i) => i.folderId === target.id);
        for (const item of items) useFilesStore.getState().updateItem(item.id, { folderId: "" });
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
      } else if (target.entity === "GatherPack") {
        await deleteRemoteEntity("GatherPack", target.id);
        const store = useRemoteDataStore.getState();
        store.setPacks(store.packs.filter((p) => asString(p.id) !== target.id));
        useSyncStore.getState().removeEntityUpdatedAt("GatherPack", target.id);
        forceClose();
      } else {
        await deleteRemoteEntity(target.entity, target.id);
        useSyncStore.getState().removeEntityUpdatedAt(target.entity, target.id);
        await syncRemoteDelta();
        forceClose();
      }
    } catch (err) {
      if (target.entity === "Folder") useFilesStore.getState().updateFolder(target.id, { isDeleting: false });
      else if (target.entity === "VaultItem") useFilesStore.getState().updateItem(target.id, { isDeleting: false });
      setFeedback(t("delete.failed", { error: String(err) }));
      setDeleting(false);
    }
  }

  return (
    <div className="modal">
      <div className="modal-backdrop" onClick={deleting ? undefined : forceClose} />
      <div className="modal-panel">
        <div className="modal-head">
          <h3>{target.kind === "folder" ? t("delete.titleFolder") : t("delete.titleItem")}</h3>
        </div>
        <p className="files-scope-label">
          {t("delete.confirmPre")} <strong>{getEntityName()}</strong>{t("delete.confirmPost")}
        </p>
        {feedback && <p className="feedback-text">{feedback}</p>}
        <div className="actions-row">
          <button type="button" className="ghost" onClick={forceClose} disabled={deleting}>{t("delete.cancel")}</button>
          <button type="button" onClick={handleDelete} disabled={deleting}>{deleting ? t("delete.deleting") : t("delete.submit")}</button>
        </div>
      </div>
    </div>
  );
}
