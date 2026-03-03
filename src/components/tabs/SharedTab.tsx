import { useState, useCallback } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useUiStore } from "../../stores/uiStore";
import { asString } from "../../services/helpers";
import { safeEntityCreate } from "../../services/entityService";
import { refreshSharedFromRemote } from "../../services/deltaSyncService";

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

export default function SharedTab() {
  const spaces = useRemoteDataStore((s) => s.spaces);
  const openManageModal = useUiStore((s) => s.openManageModal);
  const openDeleteModal = useUiStore((s) => s.openDeleteModal);
  const setStatus = useUiStore((s) => s.setStatus);

  const handleNewSpace = useCallback(async () => {
    const name = window.prompt("Shared space name");
    if (!name) return;
    try {
      await safeEntityCreate("Space", {
        name,
        space_type: "shared",
        members: [],
      });
      setStatus(`Space "${name}" created`);
      await refreshSharedFromRemote();
    } catch (err) {
      setStatus(`Failed to create space: ${String(err)}`);
    }
  }, [setStatus]);

  const handleRowAction = useCallback(
    (space: Record<string, unknown>, action: string) => {
      const id = asString(space.id);
      const updatedAt = asString(
        space.updated_date,
        asString(space.created_date, ""),
      );
      if (action === "manage") {
        openManageModal({ kind: "item", id, entity: "Space" }, updatedAt);
      } else if (action === "delete") {
        openDeleteModal({ kind: "item", id, entity: "Space" });
      }
    },
    [openManageModal, openDeleteModal],
  );

  return (
    <section className="tab-panel">
      <div className="tab-head-row">
        <div>
          <h2 className="page-title">Shared Spaces</h2>
          <p className="page-subtitle">Collaborate with your team</p>
        </div>
        <button type="button" onClick={handleNewSpace}>
          + New Space
        </button>
      </div>
      <div className="files-items">
        {spaces.length === 0 ? (
          <div className="dash-card">
            <p>No shared spaces yet.</p>
          </div>
        ) : (
          spaces.map((space) => {
            const id = asString(space.id);
            const name = asString(space.name, "Unnamed space");
            const members = Array.isArray(space.members)
              ? space.members
              : [];
            const memberCount = members.length;
            return (
              <article
                key={id}
                className="file-row group"
                data-entity="Space"
              >
                <div className="file-row-icon">{"\u25CC"}</div>
                <div className="file-row-body">
                  <p className="file-row-title">{name}</p>
                  <p className="file-row-sub">
                    {memberCount} member{memberCount !== 1 ? "s" : ""}
                  </p>
                </div>
                <RowMenu
                  onAction={(action) => handleRowAction(space, action)}
                />
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
