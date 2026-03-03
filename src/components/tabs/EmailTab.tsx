import { useState, useCallback } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useUiStore } from "../../stores/uiStore";
import { asString, asBool } from "../../services/helpers";
import { invokeBase44Function } from "../../api";
import { refreshEmailFromRemote } from "../../services/deltaSyncService";

function RowMenu({ onAction }: { onAction: (action: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="row-menu">
      <button
        className="row-menu-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        &#x22EE;
      </button>
      {open && (
        <div className="row-menu-dropdown open">
          <button
            onClick={() => {
              onAction("manage");
              setOpen(false);
            }}
          >
            Manage
          </button>
          <hr />
          <button
            className="danger"
            onClick={() => {
              onAction("delete");
              setOpen(false);
            }}
          >
            Delete
          </button>
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

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      setStatus("Syncing Gmail...");
      await invokeBase44Function("syncGmail", {});
      await refreshEmailFromRemote();
      setStatus("Gmail synced");
    } catch (err) {
      setStatus(`Gmail sync failed: ${String(err)}`);
    } finally {
      setConnecting(false);
    }
  }, [setStatus]);

  const handleRowAction = useCallback(
    (email: Record<string, unknown>, action: string) => {
      const id = asString(email.id);
      const updatedAt = asString(
        email.updated_date,
        asString(email.created_date, ""),
      );
      if (action === "manage") {
        openManageModal({ kind: "item", id, entity: "EmailItem" }, updatedAt);
      } else if (action === "delete") {
        openDeleteModal({ kind: "item", id, entity: "EmailItem" });
      }
    },
    [openManageModal, openDeleteModal],
  );

  if (emails.length === 0) {
    return (
      <section className="tab-panel">
        <div className="center-panel">
          <div className="hero-icon">&#x2709;</div>
          <h2>Connect Your Email</h2>
          <p>
            Sync your emails to search, organize, and save important messages to
            your vault.
          </p>
          <div className="actions-row center-actions">
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? "Connecting..." : "Connect Gmail"}
            </button>
            <button type="button" className="ghost" disabled>
              Outlook (Coming Soon)
            </button>
          </div>
          <div className="note-box">
            We only read email headers and content - we never send emails on
            your behalf.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="tab-panel">
      <div className="tab-head-row">
        <div>
          <h2 className="page-title">Email</h2>
          <p className="page-subtitle">{emails.length} emails</p>
        </div>
        <div className="actions-row">
          <button type="button" onClick={handleConnect} disabled={connecting}>
            {connecting ? "Syncing..." : "Sync Gmail"}
          </button>
        </div>
      </div>
      <div className="files-items">
        {emails.map((email) => {
          const id = asString(email.id);
          const subject = asString(email.subject, "No subject");
          const from = asString(email.from);
          const snippet = asString(email.snippet);
          const isImportant = asBool(email.is_important);
          return (
            <article
              key={id}
              className="file-row group"
              data-entity="EmailItem"
            >
              <div className="file-row-icon">{"\u2709"}</div>
              <div className="file-row-body">
                <p className="file-row-title">
                  {subject}
                  {isImportant && (
                    <span className="badge badge-important"> important</span>
                  )}
                </p>
                <p className="file-row-sub">
                  {from}
                  {snippet ? ` \u2022 ${snippet}` : ""}
                </p>
              </div>
              <RowMenu onAction={(action) => handleRowAction(email, action)} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
