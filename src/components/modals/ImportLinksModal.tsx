import { useState, useEffect } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useFilesStore } from "../../stores/filesStore";
import { useAuthStore } from "../../stores/authStore";
import { useSyncStore } from "../../stores/syncStore";
import { safeEntityCreate } from "../../services/entityService";
import { normalizeItem, asString } from "../../services/helpers";
import { useT } from "../../i18n";
import { useEscapeClose } from "../../hooks/useEscapeClose";

export default function ImportLinksModal() {
  const open = useUiStore((s) => s.importLinksModalOpen);
  const close = useUiStore((s) => s.closeImportLinksModal);
  const addItem = useFilesStore((s) => s.addItem);
  const persist = useFilesStore((s) => s.persist);
  const personalSpaceId = useAuthStore((s) => s.personalSpaceId);
  const t = useT();

  const [rawText, setRawText] = useState("");
  const [feedback, setFeedback] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (open) { setRawText(""); setFeedback(""); setImporting(false); }
  }, [open]);

  useEscapeClose(open, close);
  if (!open) return null;

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    const lines = rawText.split("\n").map((l) => l.trim()).filter(
      (l) => l.startsWith("http://") || l.startsWith("https://")
    );
    if (lines.length === 0) { setFeedback(t("importLinks.urlsRequired")); return; }
    setImporting(true); setFeedback("");

    let count = 0;
    for (const rawUrl of lines) {
      try {
        let domain: string;
        try { domain = new URL(rawUrl).hostname.replace(/^www\./, ""); } catch { domain = rawUrl; }
        const result = await safeEntityCreate<Record<string, unknown>>("VaultItem", {
          title: domain,
          item_type: "link",
          notes: "",
          source_url: rawUrl,
          tags: ["status:unread"],
          space_id: personalSpaceId,
          source: "other",
        });
        const newItem = normalizeItem({
          id: asString(result.id, crypto.randomUUID()),
          title: domain, itemType: "link", notes: "", sourceUrl: rawUrl,
          tags: ["status:unread"], spaceId: personalSpaceId,
          createdAtIso: asString(result.created_date, new Date().toISOString()),
          updatedAtIso: asString(result.updated_date, asString(result.created_date, new Date().toISOString())),
          createdBy: asString(result.created_by),
        });
        useSyncStore.getState().setEntityUpdatedAt("VaultItem", newItem.id, newItem.updatedAtIso || newItem.createdAtIso);
        addItem(newItem);
        count++;
      } catch { /* skip failed, continue */ }
    }
    persist();
    setFeedback(t("importLinks.done", { count: String(count) }));
    setImporting(false);
    if (count > 0) setTimeout(close, 1200);
  }

  return (
    <div className="modal">
      <div className="modal-backdrop" onClick={close} />
      <div className="modal-panel">
        <div className="modal-head">
          <h3>{t("importLinks.title")}</h3>
          <button type="button" className="ghost" onClick={close}>&#x2715;</button>
        </div>
        <form className="form" onSubmit={handleImport}>
          <p className="import-links-desc">{t("importLinks.desc")}</p>
          <textarea
            className="save-link-desc"
            placeholder={t("importLinks.placeholder")}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={8}
            autoFocus
          />
          {feedback && <p className="feedback-text">{feedback}</p>}
          <div className="actions-row">
            <button type="button" className="ghost" onClick={close}>{t("importLinks.cancel")}</button>
            <button type="submit" disabled={importing}>{importing ? t("importLinks.importing") : t("importLinks.import")}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
