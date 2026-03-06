import { useState, useEffect, useRef, useCallback } from "react";
import { usePreviewEditStore } from "../../stores/previewEditStore";
import { useFilesStore } from "../../stores/filesStore";
import { useSyncStore } from "../../stores/syncStore";
import { useUiStore } from "../../stores/uiStore";
import { safeEntityUpdate } from "../../services/entityService";
import { syncRemoteDelta } from "../../services/deltaSyncService";
import {
  fileKindFromItem, asString, toAdapterItem, getPreviewUrlForItem, formatRelativeTime, type PreviewKind,
} from "../../services/helpers";
import type { DesktopItem } from "../../services/helpers";
import {
  callDesktopSave, downloadFile, uploadFileWithToken, checkoutFile, listVersions, createNewVersion, sha256Hex,
} from "../../api";
import { getAuthToken, getPreferredUploadToken } from "../../storage";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { pdfNutrientAdapter } from "../../editors/pdf.nutrient.adapter";
import { imagePinturaAdapter } from "../../editors/image.pintura.adapter";
import { officeOnlyofficeAdapter } from "../../editors/office.onlyoffice.adapter";
import type { EditorAdapter, AdapterRenderContext, AdapterSaveContext } from "../../editors/types";
import { useT, t } from "../../i18n";
import { extractTextFromPdf, extractTextFromDocx, extractTextFromPlainFile } from "../../services/textExtractService";
import TranslatePanel from "../TranslatePanel";

function adapterForKind(kind: PreviewKind): EditorAdapter | null {
  if (kind === "pdf") return pdfNutrientAdapter;
  if (kind === "image") return imagePinturaAdapter;
  if (kind === "office") return officeOnlyofficeAdapter;
  return null;
}

const TRANSLATABLE_EXTS = new Set(["pdf", "docx", "txt", "md", "csv", "rtf"]);

function isTranslatable(kind: PreviewKind, item: DesktopItem): boolean {
  if (kind === "note" || kind === "link" || kind === "pdf") return true;
  if (kind === "image") return false;
  const ext = item.fileExtension?.replace(/^\./, "").toLowerCase() || "";
  return TRANSLATABLE_EXTS.has(ext);
}

export default function PreviewEditModal() {
  const globalStatus = useUiStore((s) => s.statusText);
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
  const tr = useT();

  const [statusText, setStatusText] = useState("");
  const [persistedError, setPersistedError] = useState("");
  const [showTranslate, setShowTranslate] = useState(false);
  const [translateSourceText, setTranslateSourceText] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const adapterRenderedRef = useRef(false);

  const item = useFilesStore((s) => s.items.find((i) => i.id === targetId));
  const itemRef = useRef(item);
  if (item) itemRef.current = item;

  useEffect(() => {
    if (!targetId || !itemRef.current || !bodyRef.current) return;
    const adapter = adapterForKind(kind);
    if (!adapter) return;
    adapterRenderedRef.current = true;
    const adapterItem = toAdapterItem(itemRef.current);
    const ctx: AdapterRenderContext = {
      item: adapterItem, bodyEl: bodyRef.current, draft: {}, setStatus: setStatusText,
      getPreviewUrl: getPreviewUrlForItem, featureFlags: { nutrient: true, onlyoffice: true, pintura: true },
    };
    if (mode === "preview") adapter.openPreview(ctx); else adapter.openEditor(ctx);
    return () => { if (bodyRef.current) bodyRef.current.innerHTML = ""; adapterRenderedRef.current = false; };
  }, [targetId, kind, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const lower = globalStatus.toLowerCase();
    if (lower.includes("failed") || lower.includes("error") || lower.includes("timeout")) setPersistedError(globalStatus);
  }, [globalStatus]);

  const handleClose = useCallback(() => { closeStore(); setStatusText(""); setPersistedError(""); setShowTranslate(false); setTranslateSourceText(""); }, [closeStore]);

  const handleTranslateToggle = useCallback(async () => {
    if (showTranslate) { setShowTranslate(false); return; }
    if (!item) return;
    setShowTranslate(true);
    setExtractError("");

    const k = fileKindFromItem(item);
    if (k === "note") {
      setTranslateSourceText(item.contentText || item.notes || "");
      return;
    }
    if (k === "link") {
      setTranslateSourceText([item.sourceUrl, item.notes].filter(Boolean).join("\n"));
      return;
    }

    const url = getPreviewUrlForItem(item);
    if (!url) { setExtractError("No file URL available"); return; }

    setIsExtracting(true);
    try {
      const bytes = await downloadFile(url);
      const ext = item.fileExtension?.replace(/^\./, "").toLowerCase() || "";
      let text = "";
      if (ext === "pdf" || k === "pdf") {
        text = await extractTextFromPdf(bytes);
      } else if (ext === "docx") {
        text = await extractTextFromDocx(bytes);
      } else {
        text = extractTextFromPlainFile(bytes);
      }
      if (!text.trim()) {
        setExtractError(t("translate.noText"));
      }
      setTranslateSourceText(text);
    } catch (err) {
      setExtractError(t("translate.extractFailed", { error: String(err) }));
    } finally {
      setIsExtracting(false);
    }
  }, [showTranslate, item]);

  if (!targetId) return null;
  if (!item) return null;

  const realKind = fileKindFromItem(item);
  const adapter = adapterForKind(realKind);
  const updatedAtIso = item.updatedAtIso || item.createdAtIso;
  const relativeTime = formatRelativeTime(updatedAtIso);
  const translatable = isTranslatable(realKind, item);

  async function handleOpenNative() {
    const previewUrl = getPreviewUrlForItem(item!);
    if (!previewUrl) { setStatusText(t("previewEdit.noFileUrl")); return; }
    try {
      setStatusText(t("fileAction.downloading"));
      const savedPath = await invoke<string>("download_and_save_to_workspace", { url: previewUrl, fileId: item!.id, filename: item!.title });
      setStatusText(t("fileAction.opening"));
      await openPath(savedPath);
      setStatusText("");
    } catch (err) {
      setStatusText(t("previewEdit.openFailed", { error: String(err) }));
    }
  }

  function handleToggleMode() { setMode(mode === "preview" ? "edit" : "preview"); }

  async function handleRefresh() {
    setStatusText(t("previewEdit.refreshing"));
    try { await syncRemoteDelta(); setStatusText(t("previewEdit.refreshed")); }
    catch (err) { setStatusText(t("previewEdit.refreshFailed", { error: String(err) })); }
  }

  async function handleSave() {
    if (!item) return;
    setSaving(true);
    setStatusText(t("previewEdit.savingStatus"));

    try {
      if (adapter) {
        const adapterItem = toAdapterItem(item);
        const authToken = getAuthToken() || "";
        const uploadToken = getPreferredUploadToken() || authToken;
        const ctx: AdapterSaveContext = {
          item: adapterItem, draft: {}, setStatus: setStatusText,
          getAuthToken: () => authToken, getUploadToken: () => uploadToken,
          checkoutFile: async (fileId, requestToken) => {
            const result = await checkoutFile(fileId, requestToken);
            return { download_url: result.download_url, edit_session_id: result.edit_session_id };
          },
          downloadFile, uploadFileWithToken, createNewVersion, listVersions, sha256Hex,
        };
        const result = await adapter.save(ctx);
        if (result.ok) {
          setStatusText(result.message || t("previewEdit.saved"));
          if (result.updatedAtIso) { useFilesStore.getState().updateItem(item.id, { updatedAtIso: result.updatedAtIso }); useFilesStore.getState().persist(); }
        } else {
          setStatusText(result.message || t("previewEdit.saveFailed"));
        }
      } else if (realKind === "note") {
        const baselineUpdatedAt = useSyncStore.getState().getEntityUpdatedAt("VaultItem", item.id);
        const payload: Record<string, unknown> = { content_text: noteDraft, notes: noteDraft };
        if (baselineUpdatedAt) {
          const result = await callDesktopSave<Record<string, unknown>>("VaultItem", item.id, payload, baselineUpdatedAt);
          if (!result.ok) { setStatusText(t("previewEdit.conflict", { date: result.serverUpdatedDate || "(unknown)" })); setSaving(false); return; }
          const nextUpdatedAt = asString(result.record.updated_date, asString(result.record.created_date));
          if (nextUpdatedAt) useSyncStore.getState().setEntityUpdatedAt("VaultItem", item.id, nextUpdatedAt);
          useFilesStore.getState().updateItem(item.id, { contentText: noteDraft, notes: noteDraft, updatedAtIso: nextUpdatedAt || new Date().toISOString() });
        } else {
          await safeEntityUpdate("VaultItem", item.id, payload);
          useFilesStore.getState().updateItem(item.id, { contentText: noteDraft, notes: noteDraft, updatedAtIso: new Date().toISOString() });
        }
        useFilesStore.getState().persist();
        setStatusText(t("previewEdit.saved"));
      } else if (realKind === "link") {
        const baselineUpdatedAt = useSyncStore.getState().getEntityUpdatedAt("VaultItem", item.id);
        const payload: Record<string, unknown> = { source_url: linkUrlDraft, notes: linkNotesDraft };
        if (baselineUpdatedAt) {
          const result = await callDesktopSave<Record<string, unknown>>("VaultItem", item.id, payload, baselineUpdatedAt);
          if (!result.ok) { setStatusText(t("previewEdit.conflict", { date: result.serverUpdatedDate || "(unknown)" })); setSaving(false); return; }
          const nextUpdatedAt = asString(result.record.updated_date, asString(result.record.created_date));
          if (nextUpdatedAt) useSyncStore.getState().setEntityUpdatedAt("VaultItem", item.id, nextUpdatedAt);
          useFilesStore.getState().updateItem(item.id, { sourceUrl: linkUrlDraft, notes: linkNotesDraft, updatedAtIso: nextUpdatedAt || new Date().toISOString() });
        } else {
          await safeEntityUpdate("VaultItem", item.id, payload);
          useFilesStore.getState().updateItem(item.id, { sourceUrl: linkUrlDraft, notes: linkNotesDraft, updatedAtIso: new Date().toISOString() });
        }
        useFilesStore.getState().persist();
        setStatusText(t("previewEdit.saved"));
      }
    } catch (err) {
      setStatusText(t("previewEdit.saveError", { error: String(err) }));
    } finally {
      setSaving(false);
    }
  }

  function renderBody() {
    if (realKind === "note") {
      if (mode === "preview") {
        return <div className="preview-edit-body"><pre className="note-preview">{item!.contentText || item!.notes || tr("previewEdit.emptyNote")}</pre></div>;
      }
      return <div className="preview-edit-body"><textarea className="note-editor" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder={tr("previewEdit.notePlaceholder")} /></div>;
    }
    if (realKind === "link") {
      if (mode === "preview") {
        return (
          <div className="preview-edit-body">
            <p><strong>{tr("previewEdit.urlLabel")}:</strong> {item!.sourceUrl || tr("previewEdit.urlFallback")}</p>
            <p><strong>{tr("previewEdit.notesLabel")}:</strong> {item!.notes || tr("previewEdit.notesFallback")}</p>
          </div>
        );
      }
      return (
        <div className="preview-edit-body">
          <label>{tr("previewEdit.urlLabel")}</label>
          <input type="text" value={linkUrlDraft} onChange={(e) => setLinkUrlDraft(e.target.value)} placeholder={tr("previewEdit.urlPlaceholder")} />
          <label>{tr("previewEdit.notesLabel")}</label>
          <textarea className="note-editor" value={linkNotesDraft} onChange={(e) => setLinkNotesDraft(e.target.value)} placeholder={tr("previewEdit.optionalNotes")} />
        </div>
      );
    }
    return <div className={`preview-edit-body${realKind === "office" ? " office-body" : ""}`} ref={bodyRef} />;
  }

  return (
    <div className="modal">
      <div className="modal-backdrop" onClick={handleClose} />
      <div className={`modal-panel preview-edit-panel${realKind === "office" && mode === "edit" ? " office-mode" : ""}${realKind === "pdf" ? " pdf-mode" : ""}`}>
        <div className="modal-head">
          <div className="preview-edit-title-wrap">
            <h3>{mode === "preview" ? tr("previewEdit.preview") : tr("previewEdit.edit")}: {item.title}</h3>
            <p className="files-scope-label">{relativeTime ? tr("previewEdit.updated", { time: relativeTime }) : ""}</p>
          </div>
          <button type="button" className="ghost" onClick={handleClose}>&#x2715;</button>
        </div>

        {(persistedError || globalStatus || statusText) && (
          <p
            className={`preview-edit-live-status files-scope-label${persistedError ? " status-error" : ""}`}
            onClick={persistedError ? () => setPersistedError("") : undefined}
            title={persistedError ? tr("previewEdit.clickDismiss") : undefined}
            style={persistedError ? { cursor: "pointer" } : undefined}
          >
            {persistedError || globalStatus || statusText}
          </p>
        )}

        {showTranslate ? (
          <div className="preview-translate-layout">
            <div className="preview-translate-main">{renderBody()}</div>
            <TranslatePanel
              sourceText={translateSourceText}
              isExtracting={isExtracting}
              extractError={extractError}
              onClose={() => setShowTranslate(false)}
            />
          </div>
        ) : renderBody()}

        <div className="actions-row preview-edit-actions">
          <button type="button" className="ghost" onClick={handleOpenNative}>{tr("previewEdit.openNative")}</button>
          {translatable && (
            <button type="button" className={`ghost${showTranslate ? " active" : ""}`} onClick={handleTranslateToggle}>
              {tr("translate.button")}
            </button>
          )}
          <button type="button" className="ghost" onClick={handleToggleMode} disabled={!canEdit && mode === "preview"}>
            {mode === "preview" ? tr("previewEdit.switchToEdit") : tr("previewEdit.switchToPreview")}
          </button>
          <button type="button" className="ghost" onClick={handleRefresh}>{tr("previewEdit.refresh")}</button>
          <button type="button" onClick={handleSave} disabled={savingGlobal || mode === "preview"}>
            {savingGlobal ? tr("previewEdit.saving") : tr("previewEdit.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
