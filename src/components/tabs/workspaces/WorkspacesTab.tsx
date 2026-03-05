import { useState, useCallback, useMemo } from "react";
import { useRemoteDataStore } from "../../../stores/remoteDataStore";
import { useFilesStore } from "../../../stores/filesStore";
import { useUiStore } from "../../../stores/uiStore";
import { asString, toDisplayName } from "../../../services/helpers";
import { safeEntityCreate } from "../../../services/entityService";
import { entityCreate, entityDelete, invokeEdgeFunction } from "../../../api";
import { refreshSharedFromRemote, refreshAccessScope } from "../../../services/deltaSyncService";
import { useT, t } from "../../../i18n";
import { avatarColor, initials, currentUserEmail } from "./workspaceHelpers";
import type { SpaceMember } from "./workspaceTypes";
import WorkspaceDetail from "./WorkspaceDetail";

const TEMPLATES = [
  { id: "blank", icon: "\u{1F4C4}", nameKey: "workspaces.templateBlank" as const, folders: [] as string[], tasks: [] as string[], welcome: "" },
  { id: "project", icon: "\u{1F4CB}", nameKey: "workspaces.templateProject" as const, folders: ["Documents", "Assets", "Deliverables"], tasks: ["Define project scope", "Set timeline and milestones", "Assign team roles"], welcome: "Welcome to the project space! Check the Tasks tab to get started." },
  { id: "client", icon: "\u{1F91D}", nameKey: "workspaces.templateClient" as const, folders: ["Contracts", "Invoices", "Reports"], tasks: ["Upload signed contract", "Send initial invoice", "Schedule kickoff meeting"], welcome: "Client portal ready. Use this space to share documents and track progress." },
  { id: "team", icon: "\u{1F465}", nameKey: "workspaces.templateTeam" as const, folders: ["Guides", "Templates", "Meeting Notes"], tasks: ["Add team handbook", "Set up recurring meeting notes", "Document onboarding process"], welcome: "Team wiki initialized. Start documenting your processes and knowledge." },
];

export default function WorkspacesTab() {
  const spaces = useRemoteDataStore((s) => s.spaces);
  const items = useFilesStore((s) => s.items);
  const setStatus = useUiStore((s) => s.setStatus);
  const tr = useT();

  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("blank");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmDeleteSpaceId, setConfirmDeleteSpaceId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);

  const me = currentUserEmail();

  const activeSpace = useMemo(
    () => (activeSpaceId ? spaces.find((s) => asString(s.id) === activeSpaceId) : null),
    [spaces, activeSpaceId],
  );

  const spaceItemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const sid = item.spaceId;
      if (sid) counts[sid] = (counts[sid] || 0) + 1;
    }
    return counts;
  }, [items]);

  const handleCreateSpace = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await safeEntityCreate<Record<string, unknown>>("Space", {
        name: newName.trim(),
        description: newDesc.trim(),
        space_type: "shared",
        members: [{ email: me, role: "owner" }],
      });
      const spaceId = asString(created.id);
      if (spaceId) {
        await entityCreate("SpaceMember", { space_id: spaceId, user_email: me, role: "owner" });
        const tmpl = TEMPLATES.find((tp) => tp.id === selectedTemplate);
        if (tmpl && tmpl.id !== "blank") {
          for (const folderName of tmpl.folders) {
            try { await safeEntityCreate("Folder", { name: folderName, space_id: spaceId }); } catch { /* ignore */ }
          }
          for (const taskTitle of tmpl.tasks) {
            try { await invokeEdgeFunction("spaceTasks", { space_id: spaceId, action: "create", title: taskTitle }); } catch { /* ignore */ }
          }
          if (tmpl.welcome) {
            try { await invokeEdgeFunction("spaceMessages", { space_id: spaceId, message: tmpl.welcome, sender_name: "EasyVault" }); } catch { /* ignore */ }
          }
        }
      }
      setStatus(t("workspaces.created", { name: newName.trim() }));
      await refreshAccessScope();
      await refreshSharedFromRemote();
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
      setSelectedTemplate("blank");
    } catch (err) {
      setStatus(t("workspaces.createFailed", { error: String(err) }));
    } finally {
      setCreating(false);
    }
  }, [newName, newDesc, me, selectedTemplate, setStatus]);

  const handleDeleteSpace = useCallback(async (spaceId: string) => {
    try {
      await entityDelete("Space", spaceId);
      setStatus(t("workspaces.deleted"));
      setActiveSpaceId(null);
      setMenuOpenId(null);
      setConfirmDeleteSpaceId(null);
      await refreshAccessScope();
      await refreshSharedFromRemote();
    } catch (err) {
      setStatus(t("workspaces.deleteFailed", { error: String(err) }));
    }
  }, [setStatus]);

  const handleJoinSpace = useCallback(async () => {
    if (!joinCode.trim()) return;
    setJoining(true);
    try {
      await invokeEdgeFunction("spaceInviteLink", { action: "join", token: joinCode.trim() });
      setStatus(t("workspaces.joined"));
      setJoinCode("");
      await refreshAccessScope();
      await refreshSharedFromRemote();
    } catch (err) {
      setStatus(t("workspaces.joinFailed", { error: String(err) }));
    } finally {
      setJoining(false);
    }
  }, [joinCode, setStatus]);

  const handleBack = useCallback(() => setActiveSpaceId(null), []);

  // ── Detail view ──
  if (activeSpace) {
    return <WorkspaceDetail space={activeSpace} onBack={handleBack} />;
  }

  // ── List view ──
  return (
    <section className="tab-panel" style={{ padding: "20px 28px 28px" }}>
      <div className="tab-head-row">
        <div>
          <h2 className="page-title">{tr("workspaces.title")}</h2>
          <p className="page-subtitle">{tr("workspaces.subtitle")}</p>
        </div>
        <button type="button" onClick={() => setCreateOpen(true)}>{tr("workspaces.newSpace")}</button>
      </div>

      <div className="space-join-row">
        <input
          type="text"
          placeholder={tr("workspaces.joinCodePlaceholder")}
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleJoinSpace(); }}
        />
        <button type="button" onClick={handleJoinSpace} disabled={joining || !joinCode.trim()}>
          {joining ? tr("workspaces.joining") : tr("workspaces.joinSpace")}
        </button>
      </div>

      {spaces.length === 0 ? (
        <div className="dash-card"><p>{tr("workspaces.noSpaces")}</p></div>
      ) : (
        <div className="space-grid">
          {spaces.map((space) => {
            const id = asString(space.id);
            const name = asString(space.name, tr("workspaces.unnamed"));
            const desc = asString(space.description);
            const members: SpaceMember[] = Array.isArray(space.members) ? space.members as SpaceMember[] : [];
            const itemCount = spaceItemCounts[id] || 0;
            const creator = asString(space.created_by);
            const avatarEmails = [creator, ...members.map((m) => m.email || "")].filter(Boolean);
            const uniqueAvatars = [...new Set(avatarEmails)].slice(0, 5);
            return (
              <div key={id} className="space-card" onClick={() => setActiveSpaceId(id)}>
                <div className="space-card-header">
                  <h3 className="space-card-name">{name}</h3>
                  <button
                    type="button"
                    className="space-card-menu-btn"
                    onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === id ? null : id); }}
                  >
                    &#x22EE;
                  </button>
                  {menuOpenId === id && (
                    <div className="space-card-menu">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteSpaceId(id); setMenuOpenId(null); }}
                      >
                        {tr("workspaces.deleteSpace")}
                      </button>
                    </div>
                  )}
                </div>
                {desc && <p className="space-card-desc">{desc}</p>}
                <div className="space-card-footer">
                  <div className="space-card-avatars">
                    {uniqueAvatars.map((email) => {
                      const display = toDisplayName(email);
                      return (
                        <div key={email} className="space-avatar" style={{ background: avatarColor(display) }}>
                          {initials(display)}
                        </div>
                      );
                    })}
                  </div>
                  <span className="space-card-count">{tr("workspaces.items", { count: itemCount })}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmDeleteSpaceId && (
        <div className="modal">
          <div className="modal-backdrop" onClick={() => setConfirmDeleteSpaceId(null)} />
          <div className="modal-panel">
            <div className="modal-head">
              <h3>{tr("workspaces.deleteSpace")}</h3>
              <button type="button" onClick={() => setConfirmDeleteSpaceId(null)}>&times;</button>
            </div>
            <div className="form" style={{ padding: "0 16px 16px" }}>
              <p>{tr("workspaces.deleteConfirm")}</p>
              <div className="actions-row">
                <button type="button" className="ghost" onClick={() => setConfirmDeleteSpaceId(null)}>{tr("workspaces.cancel")}</button>
                <button type="button" style={{ background: "#ef4444" }} onClick={() => handleDeleteSpace(confirmDeleteSpaceId)}>{tr("workspaces.deleteSpace")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="modal">
          <div className="modal-backdrop" onClick={() => setCreateOpen(false)} />
          <div className="modal-panel">
            <div className="modal-head">
              <h3>{tr("workspaces.createTitle")}</h3>
              <button type="button" onClick={() => setCreateOpen(false)}>&times;</button>
            </div>
            <div className="form" style={{ padding: "0 16px 16px" }}>
              <label>{tr("workspaces.chooseTemplate")}</label>
              <div className="space-template-grid">
                {TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    className={`space-template-card${selectedTemplate === tmpl.id ? " active" : ""}`}
                    onClick={() => setSelectedTemplate(tmpl.id)}
                  >
                    <span className="space-template-icon">{tmpl.icon}</span>
                    <span className="space-template-name">{tr(tmpl.nameKey)}</span>
                  </button>
                ))}
              </div>
              <label>{tr("workspaces.nameLabel")}</label>
              <input type="text" placeholder={tr("workspaces.nameLabel")} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
              <label>{tr("workspaces.descLabel")}</label>
              <input type="text" placeholder={tr("workspaces.descLabel")} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
              <div className="actions-row">
                <button type="button" className="ghost" onClick={() => setCreateOpen(false)}>{tr("workspaces.cancel")}</button>
                <button type="button" onClick={handleCreateSpace} disabled={creating || !newName.trim()}>
                  {creating ? tr("workspaces.creating") : tr("workspaces.create")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
