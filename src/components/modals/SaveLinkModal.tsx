import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUiStore } from "../../stores/uiStore";
import { useFilesStore } from "../../stores/filesStore";
import { useAuthStore } from "../../stores/authStore";
import { useSyncStore } from "../../stores/syncStore";
import { safeEntityCreate, safeEntityUpdate } from "../../services/entityService";
import { normalizeItem, asString } from "../../services/helpers";
import { useT } from "../../i18n";
import { useEscapeClose } from "../../hooks/useEscapeClose";

type StatusOption = "status:unread" | "status:read" | "";

function extractDomain(rawUrl: string): string {
  try { return new URL(rawUrl).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export default function SaveLinkModal() {
  const open = useUiStore((s) => s.saveLinkModalOpen);
  const close = useUiStore((s) => s.closeSaveLinkModal);
  const editTargetId = useUiStore((s) => s.saveLinkEditTarget);
  const addItem = useFilesStore((s) => s.addItem);
  const updateItem = useFilesStore((s) => s.updateItem);
  const persist = useFilesStore((s) => s.persist);
  const personalSpaceId = useAuthStore((s) => s.personalSpaceId);
  const accessibleSpaceIds = useAuthStore((s) => s.accessibleSpaceIds);
  const t = useT();

  const [url, setUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [status, setStatus] = useState<StatusOption>("status:unread");
  const [location, setLocation] = useState<"personal" | "hub">("personal");
  const [fetching, setFetching] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editTargetId) {
      const item = useFilesStore.getState().items.find((i) => i.id === editTargetId);
      if (item) {
        setUrl(item.sourceUrl || "");
        setPageTitle(item.title || "");
        setDescription(item.notes || "");
        const userTags = (item.tags || []).filter((t) => !t.startsWith("status:"));
        const statusTag = (item.tags || []).find((t) => t.startsWith("status:")) as StatusOption | undefined;
        setTagsRaw(userTags.join(", "));
        setStatus(statusTag || "");
        setLocation(item.spaceId && item.spaceId !== personalSpaceId ? "hub" : "personal");
      }
    } else {
      setUrl(""); setPageTitle(""); setDescription("");
      setTagsRaw(""); setStatus("status:unread"); setLocation("personal");
    }
    setFeedback(""); setSaving(false); setFetching(false);
  }, [open, editTargetId, personalSpaceId]);

  useEscapeClose(open, close);
  if (!open) return null;

  async function fetchPageMeta() {
    const trimmed = url.trim();
    if (!trimmed.startsWith("http")) return;
    setFetching(true);
    try {
      const title = await invoke<string>("fetch_page_title", { url: trimmed });
      if (title && !pageTitle) setPageTitle(title);
    } catch { /* best-effort */ }
    finally { setFetching(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimUrl = url.trim();
    if (!trimUrl) { setFeedback(t("saveLink.urlRequired")); return; }
    if (!trimUrl.startsWith("http://") && !trimUrl.startsWith("https://")) {
      setFeedback(t("saveLink.urlInvalid")); return;
    }
    const trimDesc = description.trim();
    if (!trimDesc) { setFeedback(t("saveLink.descRequired")); return; }

    setSaving(true); setFeedback("");

    const userTags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    const finalTags = status ? [...userTags, status] : userTags;
    const hubSpaceId = accessibleSpaceIds.find((id) => id !== personalSpaceId) || personalSpaceId;
    const spaceId = location === "hub" ? hubSpaceId : personalSpaceId;
    const title = pageTitle.trim() || extractDomain(trimUrl) || trimUrl;

    try {
      if (editTargetId) {
        const result = await safeEntityUpdate("VaultItem", editTargetId, {
          title, notes: trimDesc, source_url: trimUrl, tags: finalTags, space_id: spaceId,
        });
        updateItem(editTargetId, { title, notes: trimDesc, sourceUrl: trimUrl, tags: finalTags, spaceId });
        if (result) {
          const updatedAt = asString(result.updated_date, asString(result.created_date));
          if (updatedAt) useSyncStore.getState().setEntityUpdatedAt("VaultItem", editTargetId, updatedAt);
        }
        persist();
      } else {
        const result = await safeEntityCreate<Record<string, unknown>>("VaultItem", {
          title, item_type: "link", notes: trimDesc, source_url: trimUrl,
          tags: finalTags, space_id: spaceId, source: "other",
        });
        const newItem = normalizeItem({
          id: asString(result.id, crypto.randomUUID()),
          title, itemType: "link", notes: trimDesc, sourceUrl: trimUrl,
          tags: finalTags, spaceId,
          createdAtIso: asString(result.created_date, new Date().toISOString()),
          updatedAtIso: asString(result.updated_date, asString(result.created_date, new Date().toISOString())),
          createdBy: asString(result.created_by),
        });
        useSyncStore.getState().setEntityUpdatedAt("VaultItem", newItem.id, newItem.updatedAtIso || newItem.createdAtIso);
        addItem(newItem);
        persist();
      }
      close();
    } catch (err) {
      setFeedback(t("saveLink.error", { error: String(err) }));
      setSaving(false);
    }
  }

  const domain = extractDomain(url);

  return (
    <div className="modal">
      <div className="modal-backdrop" onClick={close} />
      <div className="modal-panel">
        <div className="modal-head">
          <h3>{editTargetId ? t("saveLink.editTitle") : t("saveLink.title")}</h3>
          <button type="button" className="ghost" onClick={close}>&#x2715;</button>
        </div>
        <form className="form" onSubmit={handleSubmit}>
          <label>{t("saveLink.urlLabel")}</label>
          <div className="save-link-url-row">
            {domain && <img className="save-link-favicon" src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`} alt="" width={16} height={16} />}
            <input
              type="text"
              placeholder={t("saveLink.urlPlaceholder")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => { if (!pageTitle) void fetchPageMeta(); }}
              autoFocus={!editTargetId}
            />
            <button type="button" className="ghost" onClick={() => void fetchPageMeta()} disabled={fetching}>
              {fetching ? t("saveLink.fetchingTitle") : t("saveLink.fetchTitle")}
            </button>
          </div>

          <label>{t("saveLink.pageTitleLabel")}</label>
          <input type="text" placeholder={t("saveLink.pageTitlePlaceholder")} value={pageTitle} onChange={(e) => setPageTitle(e.target.value)} />

          <label>{t("saveLink.descLabel")} <span style={{color: "var(--red)"}}>*</span></label>
          <textarea
            className="save-link-desc"
            placeholder={t("saveLink.descPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />

          <label>{t("saveLink.tagsLabel")}</label>
          <input type="text" placeholder={t("saveLink.tagsPlaceholder")} value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} />

          <label>{t("saveLink.statusLabel")}</label>
          <div className="save-link-pills">
            {(["status:unread", "status:read", ""] as StatusOption[]).map((s) => (
              <button key={s} type="button" className={`save-link-pill${status === s ? " active" : ""}`} onClick={() => setStatus(s)}>
                {s === "status:unread" ? t("saveLink.statusUnread")
                  : s === "status:read" ? t("saveLink.statusRead")
                  : t("saveLink.statusNone")}
              </button>
            ))}
          </div>

          <label>{t("saveLink.locationLabel")}</label>
          <select value={location} onChange={(e) => setLocation(e.target.value as "personal" | "hub")}>
            <option value="personal">{t("saveLink.locationPersonal")}</option>
            <option value="hub">{t("saveLink.locationHub")}</option>
          </select>

          {feedback && <p className="feedback-text">{feedback}</p>}
          <div className="actions-row">
            <button type="button" className="ghost" onClick={close}>{t("saveLink.cancel")}</button>
            <button type="submit" disabled={saving}>{saving ? t("saveLink.saving") : (editTargetId ? t("saveLink.update") : t("saveLink.save"))}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
