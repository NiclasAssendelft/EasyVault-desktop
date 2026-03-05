import { useState, useCallback, useMemo } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useUiStore } from "../../stores/uiStore";
import { asString, asBool } from "../../services/helpers";
import { invokeEdgeFunction } from "../../api";
import { refreshEmailFromRemote } from "../../services/deltaSyncService";
import { getEmailSyncCount } from "../../storage";
import { useT, t } from "../../i18n";

const AVATAR_COLORS = [
  "#2563eb", "#7c3aed", "#db2777", "#ea580c",
  "#0891b2", "#059669", "#d97706", "#4f46e5",
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name[0] || "?").toUpperCase();
}

function formatEmailTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatFullDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function RowMenu({ onAction }: { onAction: (action: string) => void }) {
  const [open, setOpen] = useState(false);
  const tr = useT();
  return (
    <div className="row-menu">
      <button
        className="row-menu-btn"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        &#x22EE;
      </button>
      {open && (
        <div className="row-menu-dropdown open">
          <button onClick={() => { onAction("manage"); setOpen(false); }}>{tr("menu.manage")}</button>
          <hr />
          <button className="danger" onClick={() => { onAction("delete"); setOpen(false); }}>{tr("menu.delete")}</button>
        </div>
      )}
    </div>
  );
}

export default function EmailTab() {
  const emails = useRemoteDataStore((s) => s.emails);
  const openManageModal = useUiStore((s) => s.openManageModal);
  const openDeleteModal = useUiStore((s) => s.openDeleteModal);
  const setStatus = useUiStore((s) => s.setStatus);
  const [connecting, setConnecting] = useState(false);
  const [connectingOutlook, setConnectingOutlook] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const tr = useT();

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      setStatus(t("email.syncingGmail"));
      const limit = getEmailSyncCount();
      await invokeEdgeFunction("syncGmail", { limit });
      await refreshEmailFromRemote();
      setStatus(t("email.gmailSynced"));
    } catch (err) {
      setStatus(t("email.gmailFailed", { error: String(err) }));
    } finally {
      setConnecting(false);
    }
  }, [setStatus]);

  const handleConnectOutlook = useCallback(async () => {
    setConnectingOutlook(true);
    try {
      setStatus(t("email.syncingOutlook"));
      const limit = getEmailSyncCount();
      await invokeEdgeFunction("syncOutlookEmails", { limit });
      await refreshEmailFromRemote();
      setStatus(t("email.outlookSynced"));
    } catch (err) {
      setStatus(t("email.outlookFailed", { error: String(err) }));
    } finally {
      setConnectingOutlook(false);
    }
  }, [setStatus]);

  const handleRowAction = useCallback(
    (email: Record<string, unknown>, action: string) => {
      const id = asString(email.id);
      const updatedAt = asString(email.updated_date, asString(email.created_date, ""));
      if (action === "manage") openManageModal({ kind: "item", id, entity: "EmailItem" }, updatedAt);
      else if (action === "delete") openDeleteModal({ kind: "item", id, entity: "EmailItem" });
    },
    [openManageModal, openDeleteModal],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return emails;
    const q = search.toLowerCase();
    return emails.filter((e) => {
      const subject = asString(e.subject).toLowerCase();
      const from = asString(e.from || e.from_name || e.from_address).toLowerCase();
      const snippet = asString(e.snippet).toLowerCase();
      return subject.includes(q) || from.includes(q) || snippet.includes(q);
    });
  }, [emails, search]);

  const selected = useMemo(
    () => (selectedId ? emails.find((e) => asString(e.id) === selectedId) : null),
    [emails, selectedId],
  );

  if (emails.length === 0) {
    return (
      <section className="tab-panel">
        <div className="center-panel">
          <div className="hero-icon">&#x2709;</div>
          <h2>{tr("email.connectTitle")}</h2>
          <p>{tr("email.connectDesc")}</p>
          <div className="actions-row center-actions">
            <button type="button" onClick={handleConnect} disabled={connecting}>
              {connecting ? tr("email.connecting") : tr("email.connectGmail")}
            </button>
            <button type="button" className="ghost" onClick={handleConnectOutlook} disabled={connectingOutlook}>
              {connectingOutlook ? tr("email.connecting") : tr("email.connectOutlook")}
            </button>
          </div>
          <div className="note-box">{tr("email.note")}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="tab-panel" style={{ padding: "20px 28px 0" }}>
      <div className="tab-head-row">
        <div>
          <h2 className="page-title">{tr("email.title")}</h2>
          <p className="page-subtitle">{tr("email.count", { count: emails.length })}</p>
        </div>
      </div>

      <div className={`email-layout${selected ? " detail-open" : ""}`}>
        {/* Left pane: email list */}
        <div className="email-list-pane">
          <div className="email-toolbar">
            <input
              className="email-search"
              type="text"
              placeholder={tr("email.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="email-toolbar-actions">
              <button type="button" className="ghost" onClick={handleConnect} disabled={connecting}>
                {connecting ? tr("email.syncing") : tr("email.syncGmail")}
              </button>
              <button type="button" className="ghost" onClick={handleConnectOutlook} disabled={connectingOutlook}>
                {connectingOutlook ? tr("email.syncing") : tr("email.syncOutlook")}
              </button>
            </div>
          </div>

          <div className="email-list">
            {filtered.map((email) => {
              const id = asString(email.id);
              const subject = asString(email.subject, tr("email.noSubject"));
              const fromName = asString(email.from_name || email.from || email.from_address);
              const snippet = asString(email.snippet);
              const isImportant = asBool(email.is_important);
              const hasAttachments = asBool(email.has_attachments);
              const isRead = asBool(email.is_read);
              const receivedAt = asString(email.received_at || email.receivedDateTime);
              const isSelected = id === selectedId;

              return (
                <div
                  key={id}
                  className={`email-item group${isSelected ? " selected" : ""}${!isRead ? " unread" : ""}`}
                  onClick={() => setSelectedId(id)}
                >
                  <div className="email-avatar" style={{ background: avatarColor(fromName) }}>
                    {initials(fromName)}
                  </div>
                  <div className="email-item-body">
                    <div className="email-item-top">
                      <span className="email-from">{fromName}</span>
                      <span className="email-time">{formatEmailTime(receivedAt)}</span>
                    </div>
                    <div className="email-subject">{subject}</div>
                    <div className="email-snippet">{snippet}</div>
                    {(isImportant || hasAttachments) && (
                      <div className="email-item-meta">
                        {isImportant && <span className="email-badge email-badge-important">{tr("email.important")}</span>}
                        {hasAttachments && <span className="email-badge-attachment">&#x1F4CE;</span>}
                      </div>
                    )}
                  </div>
                  <RowMenu onAction={(action) => handleRowAction(email, action)} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Right pane: email detail */}
        <div className="email-detail-pane">
          {selected ? (
            <>
              <button
                type="button"
                className="ghost email-detail-back"
                onClick={() => setSelectedId(null)}
              >
                &#x2190; {tr("email.backToList")}
              </button>

              <h2 className="email-detail-subject">
                {asString(selected.subject, tr("email.noSubject"))}
              </h2>

              <div className="email-detail-header">
                <div
                  className="email-detail-avatar"
                  style={{ background: avatarColor(asString(selected.from_name || selected.from || selected.from_address)) }}
                >
                  {initials(asString(selected.from_name || selected.from || selected.from_address))}
                </div>
                <div className="email-detail-sender">
                  <p className="email-detail-from">
                    {asString(selected.from_name || selected.from)}
                    {!!asString(selected.from_address) && (
                      <span style={{ fontWeight: 400, color: "#71717a", marginLeft: 6, fontSize: 13 }}>
                        &lt;{asString(selected.from_address)}&gt;
                      </span>
                    )}
                  </p>
                  {!!asString(selected.to_addresses) && (
                    <p className="email-detail-to">
                      {tr("email.to")}: {asString(selected.to_addresses)}
                    </p>
                  )}
                </div>
                <span className="email-detail-date">
                  {formatFullDate(asString(selected.received_at || selected.receivedDateTime))}
                </span>
              </div>

              <div className="email-detail-body">
                {asString(selected.snippet || selected.body_preview || selected.bodyPreview)}
              </div>
            </>
          ) : (
            <div className="email-empty-detail">{tr("email.noSelection")}</div>
          )}
        </div>
      </div>
    </section>
  );
}
