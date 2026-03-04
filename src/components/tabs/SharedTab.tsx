import { useState, useCallback } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useUiStore } from "../../stores/uiStore";
import { asString } from "../../services/helpers";
import { safeEntityCreate } from "../../services/entityService";
import { refreshSharedFromRemote } from "../../services/deltaSyncService";
import { useT, t } from "../../i18n";

function RowMenu({ onAction }: { onAction: (action: string) => void }) {
  const [open, setOpen] = useState(false);
  const tr = useT();
  return (
    <div className="row-menu">
      <button className="row-menu-btn" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>&#x22EE;</button>
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

export default function SharedTab() {
  const spaces = useRemoteDataStore((s) => s.spaces);
  const openManageModal = useUiStore((s) => s.openManageModal);
  const openDeleteModal = useUiStore((s) => s.openDeleteModal);
  const setStatus = useUiStore((s) => s.setStatus);
  const tr = useT();

  const handleNewSpace = useCallback(async () => {
    const name = window.prompt(t("shared.spacePrompt"));
    if (!name) return;
    try {
      await safeEntityCreate("Space", { name, space_type: "shared", members: [] });
      setStatus(t("shared.created", { name }));
      await refreshSharedFromRemote();
    } catch (err) {
      setStatus(t("shared.createFailed", { error: String(err) }));
    }
  }, [setStatus]);

  const handleRowAction = useCallback(
    (space: Record<string, unknown>, action: string) => {
      const id = asString(space.id);
      const updatedAt = asString(space.updated_date, asString(space.created_date, ""));
      if (action === "manage") openManageModal({ kind: "item", id, entity: "Space" }, updatedAt);
      else if (action === "delete") openDeleteModal({ kind: "item", id, entity: "Space" });
    },
    [openManageModal, openDeleteModal],
  );

  return (
    <section className="tab-panel">
      <div className="tab-head-row">
        <div>
          <h2 className="page-title">{tr("shared.title")}</h2>
          <p className="page-subtitle">{tr("shared.subtitle")}</p>
        </div>
        <button type="button" onClick={handleNewSpace}>{tr("shared.newSpace")}</button>
      </div>
      <div className="files-items">
        {spaces.length === 0 ? (
          <div className="dash-card"><p>{tr("shared.noSpaces")}</p></div>
        ) : (
          spaces.map((space) => {
            const id = asString(space.id);
            const name = asString(space.name, tr("shared.unnamed"));
            const members = Array.isArray(space.members) ? space.members : [];
            const memberCount = members.length;
            return (
              <article key={id} className="file-row group" data-entity="Space">
                <div className="file-row-icon">{"\u25CC"}</div>
                <div className="file-row-body">
                  <p className="file-row-title">{name}</p>
                  <p className="file-row-sub">{tr("shared.members", { count: memberCount })}</p>
                </div>
                <RowMenu onAction={(action) => handleRowAction(space, action)} />
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
