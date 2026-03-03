import { useState, useEffect } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useFilesStore } from "../../stores/filesStore";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { safeEntityUpdate } from "../../services/entityService";
import { syncRemoteDelta } from "../../services/deltaSyncService";
import { asString, asArray } from "../../services/helpers";
import { useSyncStore } from "../../stores/syncStore";

export default function ManageModal() {
  const target = useUiStore((s) => s.manageTarget);
  const baselineUpdatedAt = useUiStore((s) => s.manageTargetBaselineUpdatedAt);
  const close = useUiStore((s) => s.closeManageModal);

  const [nameVal, setNameVal] = useState("");
  const [notesVal, setNotesVal] = useState("");
  const [tagsVal, setTagsVal] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  // Pre-populate fields when target changes
  useEffect(() => {
    if (!target) return;

    if (target.entity === "Folder") {
      const folder = useFilesStore.getState().folders.find((f) => f.id === target.id);
      setNameVal(folder?.name || "");
      setNotesVal("");
      setTagsVal("");
    } else if (target.entity === "VaultItem") {
      const item = useFilesStore.getState().items.find((i) => i.id === target.id);
      setNameVal(item?.title || "");
      setNotesVal(item?.notes || "");
      setTagsVal((item?.tags || []).join(", "));
    } else if (target.entity === "EmailItem") {
      const row = useRemoteDataStore.getState().emails.find((e) => asString(e.id) === target.id);
      setNameVal(row ? asString(row.subject) : "");
      setNotesVal(row ? asString(row.snippet) : "");
      setTagsVal(row ? asArray(row.tags).join(", ") : "");
    } else if (target.entity === "CalendarEvent") {
      const row = useRemoteDataStore.getState().events.find((e) => asString(e.id) === target.id);
      setNameVal(row ? asString(row.title) : "");
      setNotesVal(row ? asString(row.description) : "");
      setTagsVal(row ? asArray(row.tags).join(", ") : "");
    } else if (target.entity === "Space") {
      const row = useRemoteDataStore.getState().spaces.find((s) => asString(s.id) === target.id);
      setNameVal(row ? asString(row.name) : "");
      setNotesVal(row ? asString(row.description) : "");
      setTagsVal("");
    }
    setFeedback("");
    setSaving(false);
  }, [target]);

  if (!target) return null;

  const entityType = target.entity;
  const showNotes = entityType !== "Folder";
  const showTags = entityType !== "Folder" && entityType !== "Space";

  function getNameLabel(): string {
    if (entityType === "EmailItem") return "Subject";
    if (entityType === "CalendarEvent") return "Title";
    if (entityType === "Space") return "Space Name";
    return "Name";
  }

  function getNotesLabel(): string {
    if (entityType === "EmailItem") return "Snippet";
    if (entityType === "CalendarEvent") return "Description";
    if (entityType === "Space") return "Description";
    return "Notes";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = nameVal.trim();
    if (!trimmedName) {
      setFeedback("Name is required.");
      return;
    }

    setSaving(true);
    setFeedback("");

    try {
      const currentTarget = target;
      if (!currentTarget) return;

      let payload: Record<string, unknown> = {};

      if (entityType === "Folder") {
        payload = { name: trimmedName };
      } else if (entityType === "VaultItem") {
        const tags = tagsVal.split(",").map((t) => t.trim()).filter(Boolean);
        payload = { title: trimmedName, notes: notesVal, tags };
      } else if (entityType === "EmailItem") {
        const tags = tagsVal.split(",").map((t) => t.trim()).filter(Boolean);
        payload = { subject: trimmedName, snippet: notesVal, tags };
      } else if (entityType === "CalendarEvent") {
        const tags = tagsVal.split(",").map((t) => t.trim()).filter(Boolean);
        payload = { title: trimmedName, description: notesVal, tags };
      } else if (entityType === "Space") {
        payload = { name: trimmedName, description: notesVal };
      }

      const result = await safeEntityUpdate(entityType, currentTarget.id, payload, baselineUpdatedAt);

      // Update local stores
      if (entityType === "Folder") {
        useFilesStore.getState().updateFolder(currentTarget.id, { name: trimmedName });
        useFilesStore.getState().persist();
        if (result) {
          const updatedAt = asString(result.updated_date, asString(result.created_date));
          if (updatedAt) useSyncStore.getState().setEntityUpdatedAt("Folder", currentTarget.id, updatedAt);
        }
      } else if (entityType === "VaultItem") {
        const tags = tagsVal.split(",").map((t) => t.trim()).filter(Boolean);
        useFilesStore.getState().updateItem(currentTarget.id, { title: trimmedName, notes: notesVal, tags });
        useFilesStore.getState().persist();
        if (result) {
          const updatedAt = asString(result.updated_date, asString(result.created_date));
          if (updatedAt) useSyncStore.getState().setEntityUpdatedAt("VaultItem", currentTarget.id, updatedAt);
        }
      } else {
        // For EmailItem, CalendarEvent, Space: sync remote delta to refresh
        await syncRemoteDelta();
      }

      close();
    } catch (err) {
      setFeedback(`Error: ${String(err)}`);
      setSaving(false);
    }
  }

  return (
    <div className="modal">
      <div className="modal-backdrop" onClick={close} />
      <div className="modal-panel">
        <div className="modal-head">
          <h3>Manage {entityType === "CalendarEvent" ? "Event" : entityType === "EmailItem" ? "Email" : entityType}</h3>
          <button type="button" className="ghost" onClick={close}>&#x2715;</button>
        </div>
        <form className="form" onSubmit={handleSubmit}>
          <label>{getNameLabel()}</label>
          <input
            type="text"
            placeholder={`Enter ${getNameLabel().toLowerCase()}...`}
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            autoFocus
          />
          {showNotes && (
            <>
              <label>{getNotesLabel()}</label>
              <input
                type="text"
                placeholder={`Optional ${getNotesLabel().toLowerCase()}...`}
                value={notesVal}
                onChange={(e) => setNotesVal(e.target.value)}
              />
            </>
          )}
          {showTags && (
            <>
              <label>Tags (comma separated)</label>
              <input
                type="text"
                placeholder="tag1, tag2"
                value={tagsVal}
                onChange={(e) => setTagsVal(e.target.value)}
              />
            </>
          )}
          {feedback && <p className="feedback-text">{feedback}</p>}
          <div className="actions-row">
            <button type="button" className="ghost" onClick={close}>Cancel</button>
            <button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
