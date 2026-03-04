import { useState } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useFilesStore } from "../../stores/filesStore";
import { useAuthStore } from "../../stores/authStore";
import { safeEntityCreate } from "../../services/entityService";
import { refreshAccessScope } from "../../services/deltaSyncService";
import { asString, normalizeFolder, normalizeItem, type FileItemType } from "../../services/helpers";
import { useSyncStore } from "../../stores/syncStore";
import { useT } from "../../i18n";
import type { TKey } from "../../i18n";

const ITEM_TYPES: { value: FileItemType; labelKey: TKey }[] = [
  { value: "note", labelKey: "new.typeNote" },
  { value: "link", labelKey: "new.typeLink" },
  { value: "file_reference", labelKey: "new.typeFileRef" },
  { value: "email_reference", labelKey: "new.typeEmailRef" },
];

export default function NewModal() {
  const open = useUiStore((s) => s.newModalOpen);
  const close = useUiStore((s) => s.closeNewModal);
  const createMode = useUiStore((s) => s.createMode);
  const setCreateMode = useUiStore((s) => s.setCreateMode);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const folders = useFilesStore((s) => s.folders);
  const addFolder = useFilesStore((s) => s.addFolder);
  const addItem = useFilesStore((s) => s.addItem);
  const persist = useFilesStore((s) => s.persist);
  const t = useT();

  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<FileItemType>("note");
  const [folderId, setFolderId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  function resetForm() {
    setName(""); setItemType("note"); setFolderId(""); setFeedback(""); setSubmitting(false);
  }
  function handleClose() { resetForm(); close(); }
  function handlePickFolder() { resetForm(); setCreateMode("folder"); }
  function handlePickItem() { resetForm(); setCreateMode("item"); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) { setFeedback(t("new.nameRequired")); return; }
    setSubmitting(true); setFeedback("");
    const { personalSpaceId } = useAuthStore.getState();

    try {
      if (createMode === "folder") {
        const duplicate = useFilesStore.getState().folders.some(
          (f) => f.name.toLowerCase() === trimmedName.toLowerCase()
        );
        if (duplicate) { setFeedback(t("new.duplicateFolder")); setSubmitting(false); return; }

        const result = await safeEntityCreate<Record<string, unknown>>("Folder", {
          name: trimmedName, space_id: personalSpaceId, parent_folder_id: "",
        });
        const newFolder = normalizeFolder({
          id: asString(result.id, crypto.randomUUID()), name: trimmedName,
          createdAtIso: asString(result.created_date, new Date().toISOString()),
          updatedAtIso: asString(result.updated_date, asString(result.created_date, new Date().toISOString())),
          spaceId: personalSpaceId, createdBy: asString(result.created_by),
        });
        const updatedAt = newFolder.updatedAtIso || newFolder.createdAtIso;
        useSyncStore.getState().setEntityUpdatedAt("Folder", newFolder.id, updatedAt);
        addFolder(newFolder); persist();
        try { await refreshAccessScope(); } catch { /* non-critical */ }
        setActiveTab("files"); handleClose();
      } else if (createMode === "item") {
        const result = await safeEntityCreate<Record<string, unknown>>("VaultItem", {
          title: trimmedName, item_type: itemType, folder_id: folderId,
          space_id: personalSpaceId, source: "desktop_manual",
        });
        const newItem = normalizeItem({
          id: asString(result.id, crypto.randomUUID()), title: trimmedName, itemType, folderId,
          createdAtIso: asString(result.created_date, new Date().toISOString()),
          updatedAtIso: asString(result.updated_date, asString(result.created_date, new Date().toISOString())),
          spaceId: personalSpaceId, createdBy: asString(result.created_by),
        });
        const updatedAt = newItem.updatedAtIso || newItem.createdAtIso;
        useSyncStore.getState().setEntityUpdatedAt("VaultItem", newItem.id, updatedAt);
        addItem(newItem); persist();
        try { await refreshAccessScope(); } catch { /* non-critical */ }
        setActiveTab("files"); handleClose();
      }
    } catch (err) {
      setFeedback(t("new.error", { error: String(err) })); setSubmitting(false);
    }
  }

  return (
    <div className="modal">
      <div className="modal-backdrop" onClick={handleClose} />
      <div className="modal-panel">
        <div className="modal-head">
          <h3>{createMode === "folder" ? t("new.titleFolder") : createMode === "item" ? t("new.titleItem") : t("new.titleCreate")}</h3>
          <button type="button" className="ghost" onClick={handleClose}>&#x2715;</button>
        </div>

        {createMode === null && (
          <div className="modal-chooser">
            <button type="button" className="ghost" onClick={handlePickFolder}>{t("new.newFolder")}</button>
            <button type="button" className="ghost" onClick={handlePickItem}>{t("new.newItem")}</button>
          </div>
        )}

        {createMode === "folder" && (
          <form className="form" onSubmit={handleSubmit}>
            <label>{t("new.folderNameLabel")}</label>
            <input type="text" placeholder={t("new.folderNamePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            {feedback && <p className="feedback-text">{feedback}</p>}
            <div className="actions-row">
              <button type="button" className="ghost" onClick={() => { resetForm(); setCreateMode(null); }}>{t("new.back")}</button>
              <button type="submit" disabled={submitting}>{submitting ? t("new.creating") : t("new.createFolder")}</button>
            </div>
          </form>
        )}

        {createMode === "item" && (
          <form className="form" onSubmit={handleSubmit}>
            <label>{t("new.itemNameLabel")}</label>
            <input type="text" placeholder={t("new.itemNamePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <label>{t("new.itemTypeLabel")}</label>
            <select value={itemType} onChange={(e) => setItemType(e.target.value as FileItemType)}>
              {ITEM_TYPES.map((tp) => (
                <option key={tp.value} value={tp.value}>{t(tp.labelKey)}</option>
              ))}
            </select>
            <label>{t("new.folderLabel")}</label>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">{t("new.rootFolder")}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            {feedback && <p className="feedback-text">{feedback}</p>}
            <div className="actions-row">
              <button type="button" className="ghost" onClick={() => { resetForm(); setCreateMode(null); }}>{t("new.back")}</button>
              <button type="submit" disabled={submitting}>{submitting ? t("new.creating") : t("new.createItem")}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
