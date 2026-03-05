import { useState, useEffect } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useFilesStore } from "../../stores/filesStore";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { safeEntityUpdate } from "../../services/entityService";
import { syncRemoteDelta } from "../../services/deltaSyncService";
import { asString, asArray } from "../../services/helpers";
import { useSyncStore } from "../../stores/syncStore";
import { useT } from "../../i18n";

export default function ManageModal() {
  const target = useUiStore((s) => s.manageTarget);
  const baselineUpdatedAt = useUiStore((s) => s.manageTargetBaselineUpdatedAt);
  const close = useUiStore((s) => s.closeManageModal);
  const t = useT();

  const [nameVal, setNameVal] = useState("");
  const [notesVal, setNotesVal] = useState("");
  const [tagsVal, setTagsVal] = useState("");
  const [isPinnedVal, setIsPinnedVal] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    if (target.entity === "Folder") {
      const folder = useFilesStore.getState().folders.find((f) => f.id === target.id);
      setNameVal(folder?.name || ""); setNotesVal(""); setTagsVal(""); setIsPinnedVal(folder?.isPinned || false);
    } else if (target.entity === "VaultItem") {
      const item = useFilesStore.getState().items.find((i) => i.id === target.id);
      setNameVal(item?.title || ""); setNotesVal(item?.notes || ""); setTagsVal((item?.tags || []).join(", ")); setIsPinnedVal(item?.isPinned || false);
    } else if (target.entity === "EmailItem") {
      const row = useRemoteDataStore.getState().emails.find((e) => asString(e.id) === target.id);
      setNameVal(row ? asString(row.subject) : ""); setNotesVal(row ? asString(row.snippet) : ""); setTagsVal(row ? asArray(row.tags).join(", ") : "");
    } else if (target.entity === "CalendarEvent") {
      const row = useRemoteDataStore.getState().events.find((e) => asString(e.id) === target.id);
      setNameVal(row ? asString(row.title) : ""); setNotesVal(row ? asString(row.description) : ""); setTagsVal(row ? asArray(row.tags).join(", ") : "");
    } else if (target.entity === "Space") {
      const row = useRemoteDataStore.getState().spaces.find((s) => asString(s.id) === target.id);
      setNameVal(row ? asString(row.name) : ""); setNotesVal(row ? asString(row.description) : ""); setTagsVal("");
    }
    setFeedback(""); setSaving(false);
  }, [target]);

  if (!target) return null;

  const entityType = target.entity;
  const showNotes = entityType !== "Folder";
  const showTags = entityType !== "Folder" && entityType !== "Space";
  const showPin = entityType === "Folder" || entityType === "VaultItem" || entityType === "GatherPack";

  function getNameLabel(): string {
    if (entityType === "EmailItem") return t("manage.subject");
    if (entityType === "CalendarEvent") return t("manage.eventTitle");
    if (entityType === "Space") return t("manage.spaceName");
    return t("manage.name");
  }

  function getNotesLabel(): string {
    if (entityType === "EmailItem") return t("manage.snippet");
    if (entityType === "CalendarEvent" || entityType === "Space") return t("manage.description");
    return t("manage.notes");
  }

  function getModalTitle(): string {
    if (entityType === "CalendarEvent") return t("manage.titleEvent");
    if (entityType === "EmailItem") return t("manage.titleEmail");
    if (entityType === "Space") return t("manage.titleSpace");
    if (entityType === "Folder") return t("manage.titleFolder");
    if (entityType === "GatherPack") return t("manage.titleGatherPack");
    return t("manage.titleVaultItem");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = nameVal.trim();
    if (!trimmedName) { setFeedback(t("manage.nameRequired")); return; }
    setSaving(true); setFeedback("");

    try {
      const currentTarget = target;
      if (!currentTarget) return;

      let payload: Record<string, unknown> = {};
      if (entityType === "Folder") {
        payload = { name: trimmedName, is_pinned: isPinnedVal };
      } else if (entityType === "VaultItem") {
        const tags = tagsVal.split(",").map((tg) => tg.trim()).filter(Boolean);
        payload = { title: trimmedName, notes: notesVal, tags, is_pinned: isPinnedVal };
      } else if (entityType === "EmailItem") {
        const tags = tagsVal.split(",").map((tg) => tg.trim()).filter(Boolean);
        payload = { subject: trimmedName, snippet: notesVal, tags };
      } else if (entityType === "CalendarEvent") {
        const tags = tagsVal.split(",").map((tg) => tg.trim()).filter(Boolean);
        payload = { title: trimmedName, description: notesVal, tags };
      } else if (entityType === "Space") {
        payload = { name: trimmedName, description: notesVal };
      }

      const result = await safeEntityUpdate(entityType, currentTarget.id, payload, baselineUpdatedAt);

      if (entityType === "Folder") {
        useFilesStore.getState().updateFolder(currentTarget.id, { name: trimmedName, isPinned: isPinnedVal });
        useFilesStore.getState().persist();
        if (result) {
          const updatedAt = asString(result.updated_date, asString(result.created_date));
          if (updatedAt) useSyncStore.getState().setEntityUpdatedAt("Folder", currentTarget.id, updatedAt);
        }
      } else if (entityType === "VaultItem") {
        const tags = tagsVal.split(",").map((tg) => tg.trim()).filter(Boolean);
        useFilesStore.getState().updateItem(currentTarget.id, { title: trimmedName, notes: notesVal, tags, isPinned: isPinnedVal });
        useFilesStore.getState().persist();
        if (result) {
          const updatedAt = asString(result.updated_date, asString(result.created_date));
          if (updatedAt) useSyncStore.getState().setEntityUpdatedAt("VaultItem", currentTarget.id, updatedAt);
        }
      } else {
        await syncRemoteDelta();
      }

      close();
    } catch (err) {
      setFeedback(t("manage.error", { error: String(err) })); setSaving(false);
    }
  }

  return (
    <div className="modal">
      <div className="modal-backdrop" onClick={close} />
      <div className="modal-panel">
        <div className="modal-head">
          <h3>{getModalTitle()}</h3>
          <button type="button" className="ghost" onClick={close}>&#x2715;</button>
        </div>
        <form className="form" onSubmit={handleSubmit}>
          <label>{getNameLabel()}</label>
          <input type="text" placeholder={t("manage.enterPlaceholder", { label: getNameLabel().toLowerCase() })} value={nameVal} onChange={(e) => setNameVal(e.target.value)} autoFocus />
          {showNotes && (
            <>
              <label>{getNotesLabel()}</label>
              <input type="text" placeholder={t("manage.optionalPlaceholder", { label: getNotesLabel().toLowerCase() })} value={notesVal} onChange={(e) => setNotesVal(e.target.value)} />
            </>
          )}
          {showTags && (
            <>
              <label>{t("manage.tagsLabel")}</label>
              <input type="text" placeholder={t("manage.tagsPlaceholder")} value={tagsVal} onChange={(e) => setTagsVal(e.target.value)} />
            </>
          )}
          {showPin && (
            <label className="inline-checkbox">
              <input type="checkbox" checked={isPinnedVal} onChange={(e) => setIsPinnedVal(e.target.checked)} />
              {t("manage.pinLabel")}
            </label>
          )}
          {feedback && <p className="feedback-text">{feedback}</p>}
          <div className="actions-row">
            <button type="button" className="ghost" onClick={close}>{t("manage.cancel")}</button>
            <button type="submit" disabled={saving}>{saving ? t("manage.saving") : t("manage.saveChanges")}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
