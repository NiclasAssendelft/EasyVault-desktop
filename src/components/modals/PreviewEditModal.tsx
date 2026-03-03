import { useState, useEffect, useRef, useCallback } from "react";
import { usePreviewEditStore } from "../../stores/previewEditStore";
import { useFilesStore } from "../../stores/filesStore";
import { useSyncStore } from "../../stores/syncStore";
import { safeEntityUpdate } from "../../services/entityService";
import { syncRemoteDelta } from "../../services/deltaSyncService";
import {
  fileKindFromItem,
  asString,
  toAdapterItem,
  getPreviewUrlForItem,
  formatRelativeTime,
  type PreviewKind,
} from "../../services/helpers";
import {
  callDesktopSave,
  downloadFile,
  uploadFileWithToken,
  checkoutFile,
  listVersions,
  createNewVersion,
  sha256Hex,
} from "../../api";
import { getAuthToken, getPreferredUploadToken } from "../../storage";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { pdfNutrientAdapter } from "../../editors/pdf.nutrient.adapter";
import { imagePinturaAdapter } from "../../editors/image.pintura.adapter";
import { officeOnlyofficeAdapter } from "../../editors/office.onlyoffice.adapter";
import type { EditorAdapter, AdapterRenderContext, AdapterSaveContext } from "../../editors/types";

function adapterForKind(kind: PreviewKind): EditorAdapter | null {
  if (kind === "pdf") return pdfNutrientAdapter;
  if (kind === "image") return imagePinturaAdapter;
  if (kind === "office") return officeOnlyofficeAdapter;
  return null;
}

export default function PreviewEditModal() {
  const targetId = usePreviewEditStore((s) => s.targetId);
  const mode = usePreviewEditStore((s) => s.mode);
  const kind = usePreviewEditStore((s) => s.kind);
  const canEdit = usePreviewEditStore((s) => s.canEdit);
  const savingGlobal = usePreviewEditStore((s) => s.saving);
  const noteDraft = usePreviewEditStore((s) => s.noteDraft);
  const linkUrlDraft = usePreviewEditStore((s) => s.linkUrlDraft);
  const linkNotesDraft = usePreviewEditStore((s) => s.linkNotesDraft);
  const closeStore = usePreviewEditStore((s) => s.close);
  const setMode = usePreviewEditStore((s) => s.setMode);
  const setSaving = usePreviewEditStore((s) => s.setSaving);
  const setNoteDraft = usePreviewEditStore((s) => s.setNoteDraft);
  const setLinkUrlDraft = usePreviewEditStore((s) => s.setLinkUrlDraft);
  const setLinkNotesDraft = usePreviewEditStore((s) => s.setLinkNotesDraft);

  const [statusText, setStatusText] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const adapterRenderedRef = useRef(false);

  const item = useFilesStore((s) => s.items.find((i) => i.id === targetId));

  // Render adapter-based editors
  useEffect(() => {
    if (!targetId || !item || !bodyRef.current) return;
    const adapter = adapterForKind(kind);
    if (!adapter) return;

    // Only render adapter once per open (or when mode changes)
    adapterRenderedRef.current = true;
    const adapterItem = toAdapterItem(item);
    const ctx: AdapterRenderContext = {
      item: adapterItem,
      bodyEl: bodyRef.current,
      draft: {},
      setStatus: setStatusText,
      getPreviewUrl: getPreviewUrlForItem,
      featureFlags: {
        nutrient: true,
        onlyoffice: true,
        pintura: true,
      },
    };

    if (mode === "preview") {
      adapter.openPreview(ctx);
    } else {
      adapter.openEditor(ctx);
    }

    return () => {
      // Cleanup: clear the body element
      if (bodyRef.current) {
        bodyRef.current.innerHTML = "";
      }
      adapterRenderedRef.current = false;
    };
  }, [targetId, kind, mode, item]);

  const handleClose = useCallback(() => {
    closeStore();
    setStatusText("");
  }, [closeStore]);

  if (!targetId) return null;
  if (!item) return null;

  const realKind = fileKindFromItem(item);
  const adapter = adapterForKind(realKind);
  const updatedAtIso = item.updatedAtIso || item.createdAtIso;
  const relativeTime = formatRelativeTime(updatedAtIso);

  async function handleOpenNative() {
    const previewUrl = getPreviewUrlForItem(item!);
    if (!previewUrl) {
      setStatusText("No file URL available.");
      return;
    }
    try {
      setStatusText("Downloading...");
      const bytes = await downloadFile(previewUrl);
      const savedPath = await invoke<string>("save_file_to_workspace", {
        fileId: item!.id,
        filename: item!.title,
        bytes: Array.from(bytes),
      });
      setStatusText("Opening...");
      await openPath(savedPath);
      setStatusText("");
    } catch (err) {
      setStatusText(`Open failed: ${String(err)}`);
    }
  }

  function handleToggleMode() {
    if (mode === "preview") {
      setMode("edit");
    } else {
      setMode("preview");
    }
  }

  async function handleRefresh() {
    setStatusText("Refreshing...");
    try {
      await syncRemoteDelta();
      setStatusText("Refreshed.");
    } catch (err) {
      setStatusText(`Refresh failed: ${String(err)}`);
    }
  }

  async function handleSave() {
    if (!item) return;
    setSaving(true);
    setStatusText("Saving...");

    try {
      if (adapter) {
        // Adapter-based save (PDF, image, office)
        const adapterItem = toAdapterItem(item);
        const authToken = getAuthToken() || "";
        const uploadToken = getPreferredUploadToken() || authToken;
        const ctx: AdapterSaveContext = {
          item: adapterItem,
          draft: {},
          setStatus: setStatusText,
          getAuthToken: () => authToken,
          getUploadToken: () => uploadToken,
          checkoutFile: async (fileId, requestToken) => {
            const result = await checkoutFile(fileId, requestToken);
            return { download_url: result.download_url, edit_session_id: result.edit_session_id };
          },
          downloadFile,
          uploadFileWithToken,
          createNewVersion,
          listVersions,
          sha256Hex,
        };
        const result = await adapter.save(ctx);
        if (result.ok) {
          setStatusText(result.message || "Saved.");
          if (result.updatedAtIso) {
            useFilesStore.getState().updateItem(item.id, { updatedAtIso: result.updatedAtIso });
            useFilesStore.getState().persist();
          }
        } else {
          setStatusText(result.message || "Save failed.");
        }
      } else if (realKind === "note") {
        // Save note content
        const baselineUpdatedAt = useSyncStore.getState().getEntityUpdatedAt("VaultItem", item.id);
        const payload: Record<string, unknown> = {
          content_text: noteDraft,
          notes: noteDraft,
        };

        if (baselineUpdatedAt) {
          const result = await callDesktopSave<Record<string, unknown>>(
            "VaultItem",
            item.id,
            payload,
            baselineUpdatedAt
          );
          if (!result.ok) {
            setStatusText(`Conflict: record changed on server at ${result.serverUpdatedDate || "(unknown)"}`);
            setSaving(false);
            return;
          }
          const nextUpdatedAt = asString(result.record.updated_date, asString(result.record.created_date));
          if (nextUpdatedAt) {
            useSyncStore.getState().setEntityUpdatedAt("VaultItem", item.id, nextUpdatedAt);
          }
          useFilesStore.getState().updateItem(item.id, {
            contentText: noteDraft,
            notes: noteDraft,
            updatedAtIso: nextUpdatedAt || new Date().toISOString(),
          });
        } else {
          await safeEntityUpdate("VaultItem", item.id, payload);
          useFilesStore.getState().updateItem(item.id, {
            contentText: noteDraft,
            notes: noteDraft,
            updatedAtIso: new Date().toISOString(),
          });
        }

        useFilesStore.getState().persist();
        setStatusText("Saved.");
      } else if (realKind === "link") {
        // Save link changes
        const baselineUpdatedAt = useSyncStore.getState().getEntityUpdatedAt("VaultItem", item.id);
        const payload: Record<string, unknown> = {
          source_url: linkUrlDraft,
          notes: linkNotesDraft,
        };

        if (baselineUpdatedAt) {
          const result = await callDesktopSave<Record<string, unknown>>(
            "VaultItem",
            item.id,
            payload,
            baselineUpdatedAt
          );
          if (!result.ok) {
            setStatusText(`Conflict: record changed on server at ${result.serverUpdatedDate || "(unknown)"}`);
            setSaving(false);
            return;
          }
          const nextUpdatedAt = asString(result.record.updated_date, asString(result.record.created_date));
          if (nextUpdatedAt) {
            useSyncStore.getState().setEntityUpdatedAt("VaultItem", item.id, nextUpdatedAt);
          }
          useFilesStore.getState().updateItem(item.id, {
            sourceUrl: linkUrlDraft,
            notes: linkNotesDraft,
            updatedAtIso: nextUpdatedAt || new Date().toISOString(),
          });
        } else {
          await safeEntityUpdate("VaultItem", item.id, payload);
          useFilesStore.getState().updateItem(item.id, {
            sourceUrl: linkUrlDraft,
            notes: linkNotesDraft,
            updatedAtIso: new Date().toISOString(),
          });
        }

        useFilesStore.getState().persist();
        setStatusText("Saved.");
      }
    } catch (err) {
      setStatusText(`Save error: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  // Render body content for note/link kinds
  function renderBody() {
    if (realKind === "note") {
      if (mode === "preview") {
        return (
          <div className="preview-edit-body">
            <pre className="note-preview">{item!.contentText || item!.notes || "(empty note)"}</pre>
          </div>
        );
      }
      return (
        <div className="preview-edit-body">
          <textarea
            className="note-editor"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Write your note here..."
          />
        </div>
      );
    }

    if (realKind === "link") {
      if (mode === "preview") {
        return (
          <div className="preview-edit-body">
            <p><strong>URL:</strong> {item!.sourceUrl || "(no URL)"}</p>
            <p><strong>Notes:</strong> {item!.notes || "(no notes)"}</p>
          </div>
        );
      }
      return (
        <div className="preview-edit-body">
          <label>URL</label>
          <input
            type="text"
            value={linkUrlDraft}
            onChange={(e) => setLinkUrlDraft(e.target.value)}
            placeholder="https://..."
          />
          <label>Notes</label>
          <textarea
            className="note-editor"
            value={linkNotesDraft}
            onChange={(e) => setLinkNotesDraft(e.target.value)}
            placeholder="Optional notes..."
          />
        </div>
      );
    }

    // For PDF, image, office, other: the adapter renders into bodyRef via useEffect
    return <div className={`preview-edit-body${realKind === "office" ? " office-body" : ""}`} ref={bodyRef} />;
  }

  return (
    <div className="modal">
      <div className="modal-backdrop" onClick={handleClose} />
      <div className={`modal-panel preview-edit-panel${realKind === "office" && mode === "edit" ? " office-mode" : ""}`}>
        <div className="modal-head">
          <div className="preview-edit-title-wrap">
            <h3>{mode === "preview" ? "Preview" : "Edit"}: {item.title}</h3>
            <p className="files-scope-label">{relativeTime ? `Updated ${relativeTime}` : ""}</p>
          </div>
          <button type="button" className="ghost" onClick={handleClose}>&#x2715;</button>
        </div>

        {statusText && <p className="files-scope-label">{statusText}</p>}

        {renderBody()}

        <div className="actions-row preview-edit-actions">
          <button type="button" className="ghost" onClick={handleOpenNative}>Open Native</button>
          <button
            type="button"
            className="ghost"
            onClick={handleToggleMode}
            disabled={!canEdit && mode === "preview"}
          >
            {mode === "preview" ? "Switch to Edit" : "Switch to Preview"}
          </button>
          <button type="button" className="ghost" onClick={handleRefresh}>Refresh</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={savingGlobal || mode === "preview"}
          >
            {savingGlobal ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
