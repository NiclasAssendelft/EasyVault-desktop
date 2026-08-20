import { useState, useEffect, useCallback, useRef } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useFilesStore } from "../../stores/filesStore";
import { useAuthStore } from "../../stores/authStore";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { usePreviewEditStore } from "../../stores/previewEditStore";
import { useSyncStore } from "../../stores/syncStore";

import { getSavedEmail } from "../../storage";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { fileKindFromItem, asString, toDisplayName } from "../../services/helpers";
import { resolveFreshFileUrl } from "../../services/fileOps";
import { invokeEdgeFunction } from "../../api";
import { safeEntityUpdate } from "../../services/entityService";
import { subscribeToTable, LIVE_POLL_INTERVAL_MS, type RealtimeRow } from "../../services/realtimeService";
import { useT } from "../../i18n";
import { useEscapeClose } from "../../hooks/useEscapeClose";

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
  const t = useT();

  const [status, setStatus] = useState("");

  useEscapeClose(!!targetId, close);
  if (!targetId) return null;
  const item = useFilesStore.getState().items.find((i) => i.id === targetId);
  if (!item) return null;

  const kind = fileKindFromItem(item);
  const canEdit = canEditBySpace(item.spaceId || "", item.createdBy || "");
  const baselineUpdatedAt = useSyncStore.getState().getEntityUpdatedAt("VaultItem", item.id);

  // Mark as recently opened so it floats to top of the list
  if (!item.openedAt || (Date.now() - new Date(item.openedAt).getTime() > 5000)) {
    useFilesStore.getState().updateItem(item.id, { openedAt: new Date().toISOString() });
    useFilesStore.getState().persist();
  }

  async function handleOpenNative() {
    if (!item) return;
    const previewUrl = await resolveFreshFileUrl(item);
    if (!previewUrl) { setStatus(t("fileAction.noFileUrl")); return; }
    try {
      setStatus(t("fileAction.downloading"));
      const savedPath = await invoke<string>("download_and_save_to_workspace", { url: previewUrl, fileId: item.id, filename: item.title });
      setStatus(t("fileAction.opening"));
      await openPath(savedPath);
      close();
    } catch (err) {
      setStatus(t("fileAction.failed", { error: String(err) }));
    }
  }

  function handleEditInApp() {
    if (!item) return;
    close();
    usePreviewEditStore.getState().open(item.id, "edit", kind, canEdit, {
      noteDraft: item.contentText || item.notes, linkUrlDraft: item.sourceUrl || "", linkNotesDraft: item.notes,
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
      <div className="modal-panel file-action-panel" role="dialog" aria-modal="true" aria-label={item.title}>
        <div className="modal-head">
          <h3>{item.title}</h3>
          <button type="button" className="ghost" onClick={close} aria-label={t("common.close")}>&#x2715;</button>
        </div>
        {status && <p className="files-scope-label">{status}</p>}
        <div className="file-action-list">
          <button type="button" className="ghost" onClick={handleOpenNative}>{t("fileAction.openNative")}</button>
          <button type="button" className="ghost" onClick={handleEditInApp}>{t("fileAction.editInApp")}</button>
          <button type="button" className="ghost" onClick={handleManage} disabled={!canEdit}>{t("fileAction.manage")}</button>
          <button type="button" className="ghost" onClick={() => {
            if (!item) return;
            const next = !item.isPinned;
            useFilesStore.getState().updateItem(item.id, { isPinned: next });
            useFilesStore.getState().persist();
            void safeEntityUpdate("VaultItem", item.id, { is_pinned: next });
            close();
          }}>{item.isPinned ? t("fileAction.unpin") : t("fileAction.pin")}</button>
        </div>
        {item.spaceId && <FileCommentsSection itemId={item.id} spaceId={item.spaceId} />}
      </div>
    </div>
  );
}

type FileComment = {
  id: string;
  item_id: string;
  sender_email: string;
  sender_name: string;
  message: string;
  created_at: string;
};

/**
 * Cadence when the Realtime feed is not carrying this list — the interval this
 * section has always used. A live channel only lets it stretch to
 * LIVE_POLL_INTERVAL_MS; any non-SUBSCRIBED status snaps it straight back here.
 */
const COMMENTS_POLL_MS = 8000;

/** Narrow a raw `file_comments` row from the change feed. */
function toFileComment(row: RealtimeRow): FileComment {
  return {
    id: asString(row.id),
    item_id: asString(row.item_id),
    sender_email: asString(row.sender_email),
    sender_name: asString(row.sender_name),
    message: asString(row.message),
    created_at: asString(row.created_at),
  };
}

function FileCommentsSection({ itemId, spaceId }: { itemId: string; spaceId: string }) {
  const t = useT();
  const [comments, setComments] = useState<FileComment[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  /** Comments channel is SUBSCRIBED → the poll may run at the slow cadence. */
  const [live, setLive] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const fetchComments = useCallback(async () => {
    try {
      const res = await invokeEdgeFunction<{ comments?: FileComment[] }>("fileComments", { item_id: itemId, action: "list" });
      setComments(res.comments || []);
    } catch { /* ignore */ }
  }, [itemId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  /**
   * Apply a change-feed row by id — the same comment can arrive from both the
   * poll and the feed, so this has to be idempotent.
   */
  const applyCommentRow = useCallback((row: RealtimeRow) => {
    const comment = toFileComment(row);
    if (!comment.id) return;
    setComments((prev) => {
      const idx = prev.findIndex((c) => c.id === comment.id);
      if (idx === -1) return [...prev, comment];
      const next = prev.slice();
      next[idx] = comment;
      return next;
    });
  }, []);

  // Live comments for this item. Legacy 24-hex item ids are not valid UUIDs, so
  // the server rejects the binding, the channel reports CHANNEL_ERROR and the
  // poll below simply stays at its normal cadence — today's behaviour exactly.
  useEffect(() => {
    setLive(false);
    return subscribeToTable({
      table: "file_comments",
      filter: `item_id=eq.${itemId}`,
      onInsert: applyCommentRow,
      onUpdate: applyCommentRow,
      onStatus: (status) => setLive(status === "connected"),
    });
  }, [itemId, applyCommentRow]);

  // Backstop poll: always running, only its cadence depends on the live feed.
  useEffect(() => {
    const timer = setInterval(fetchComments, live ? LIVE_POLL_INTERVAL_MS : COMMENTS_POLL_MS);
    return () => clearInterval(timer);
  }, [fetchComments, live]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments.length]);

  const handleSend = async () => {
    if (!input.trim()) return;
    setSending(true);
    try {
      const me = getSavedEmail().trim().toLowerCase();
      await invokeEdgeFunction("fileComments", {
        item_id: itemId,
        space_id: spaceId,
        action: "create",
        message: input.trim(),
        sender_name: toDisplayName(me),
      });
      setInput("");
      await fetchComments();
    } catch { /* ignore */ }
    finally { setSending(false); }
  };

  return (
    <div className="file-comments-section">
      <h4 className="file-comments-heading">{t("shared.fileComments")}</h4>
      <div className="file-comments-list">
        {comments.length === 0 && <p className="file-comments-empty">{t("shared.noComments")}</p>}
        {comments.map((c) => (
          <div key={c.id} className="file-comment-row">
            <strong>{c.sender_name || toDisplayName(c.sender_email)}</strong>
            <span className="file-comment-time">{new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            <p className="file-comment-text">{c.message}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="file-comments-input-row">
        <input type="text" placeholder={t("shared.addComment")} value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }} />
        <button type="button" onClick={handleSend} disabled={sending || !input.trim()}>{t("shared.sendMessage")}</button>
      </div>
    </div>
  );
}
