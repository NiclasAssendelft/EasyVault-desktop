import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { asString, toDisplayName } from "../../services/helpers";
import { safeEntityCreate, safeEntityUpdate } from "../../services/entityService";
import { entityCreate, entityDelete } from "../../api";
import { refreshSharedFromRemote, refreshAccessScope } from "../../services/deltaSyncService";
import { invokeBase44Function } from "../../api";
import { getSavedEmail } from "../../storage";
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
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name[0] || "?").toUpperCase();
}

function formatChatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type SpaceMessage = {
  id: string;
  space_id: string;
  sender_email: string;
  sender_name: string;
  message: string;
  created_at: string;
};

type SpaceMember = {
  email?: string;
  role?: string;
};

type SectionId = "files" | "chat" | "members" | "settings";

function currentUserEmail(): string {
  return getSavedEmail().trim().toLowerCase();
}

export default function SharedTab() {
  const spaces = useRemoteDataStore((s) => s.spaces);
  const allItems = useFilesStore((s) => s.items);
  const allFolders = useFilesStore((s) => s.folders);
  const openDeleteModal = useUiStore((s) => s.openDeleteModal);
  const setFileActionTargetId = useUiStore((s) => s.setFileActionTargetId);
  const setStatus = useUiStore((s) => s.setStatus);
  const tr = useT();

  // Main state
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("files");

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Chat
  const [chatMessages, setChatMessages] = useState<SpaceMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [inviting, setInviting] = useState(false);

  // Settings edit
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Card menu
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  // Confirm dialogs (replacing window.confirm)
  const [confirmRemoveEmail, setConfirmRemoveEmail] = useState<string | null>(null);
  const [confirmDeleteSpaceId, setConfirmDeleteSpaceId] = useState<string | null>(null);

  const me = currentUserEmail();

  const activeSpace = useMemo(
    () => (activeSpaceId ? spaces.find((s) => asString(s.id) === activeSpaceId) : null),
    [spaces, activeSpaceId],
  );

  const isOwner = useMemo(() => {
    if (!activeSpace) return false;
    if (asString(activeSpace.created_by).toLowerCase() === me) return true;
    const members = Array.isArray(activeSpace.members) ? activeSpace.members : [];
    return members.some(
      (m) => m && typeof m === "object" &&
        asString((m as SpaceMember).email).toLowerCase() === me &&
        asString((m as SpaceMember).role) === "owner",
    );
  }, [activeSpace, me]);

  // Space items count for cards
  const spaceItemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of allItems) {
      const sid = item.spaceId;
      if (sid) counts[sid] = (counts[sid] || 0) + 1;
    }
    return counts;
  }, [allItems]);

  // Items and folders for the active space
  const spaceItems = useMemo(
    () => (activeSpaceId ? allItems.filter((i) => i.spaceId === activeSpaceId) : []),
    [allItems, activeSpaceId],
  );

  const spaceFolders = useMemo(
    () => (activeSpaceId ? allFolders.filter((f) => f.spaceId === activeSpaceId) : []),
    [allFolders, activeSpaceId],
  );

  // Populate settings fields when entering settings
  useEffect(() => {
    if (activeSection === "settings" && activeSpace) {
      setEditName(asString(activeSpace.name));
      setEditDesc(asString(activeSpace.description));
    }
  }, [activeSection, activeSpace]);

  // ── Chat polling ──
  const fetchChatMessages = useCallback(async (spaceId: string) => {
    try {
      const res = await invokeBase44Function<{ messages?: SpaceMessage[] }>("spaceMessages", { space_id: spaceId });
      const msgs = res.messages || [];
      setChatMessages(msgs.reverse()); // API returns DESC, we want oldest first
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (activeSection !== "chat" || !activeSpaceId) return;
    setChatLoading(true);
    fetchChatMessages(activeSpaceId).finally(() => setChatLoading(false));
    const timer = setInterval(() => fetchChatMessages(activeSpaceId), 5000);
    return () => clearInterval(timer);
  }, [activeSection, activeSpaceId, fetchChatMessages]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length]);

  // ── Handlers ──
  const handleCreateSpace = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await safeEntityCreate<Record<string, unknown>>("Space", { name: newName.trim(), description: newDesc.trim(), space_type: "shared", members: [{ email: me, role: "owner" }] });
      const spaceId = asString(created.id);
      if (spaceId) {
        await entityCreate("SpaceMember", { space_id: spaceId, user_email: me, role: "owner" });
      }
      setStatus(t("shared.created", { name: newName.trim() }));
      await refreshAccessScope();
      await refreshSharedFromRemote();
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
    } catch (err) {
      setStatus(t("shared.createFailed", { error: String(err) }));
    } finally {
      setCreating(false);
    }
  }, [newName, newDesc, setStatus]);

  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim() || !activeSpaceId) return;
    setChatSending(true);
    try {
      const displayName = toDisplayName(me);
      await invokeBase44Function("spaceMessages", {
        space_id: activeSpaceId,
        message: chatInput.trim(),
        sender_name: displayName,
      });
      setChatInput("");
      await fetchChatMessages(activeSpaceId);
    } catch {
      /* ignore */
    } finally {
      setChatSending(false);
    }
  }, [chatInput, activeSpaceId, me, fetchChatMessages]);

  const handleInvite = useCallback(async () => {
    if (!inviteEmail.trim() || !activeSpaceId) return;
    setInviting(true);
    try {
      await invokeBase44Function("spaceInvite", {
        space_id: activeSpaceId,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setStatus(t("shared.invited", { email: inviteEmail.trim(), role: inviteRole }));
      setInviteOpen(false);
      setInviteEmail("");
      await refreshSharedFromRemote();
    } catch (err) {
      setStatus(t("shared.inviteFailed", { error: String(err) }));
    } finally {
      setInviting(false);
    }
  }, [inviteEmail, inviteRole, activeSpaceId, setStatus]);

  const handleRemoveMember = useCallback(async (email: string) => {
    if (!activeSpaceId) return;
    try {
      await invokeBase44Function("spaceRemoveMember", { space_id: activeSpaceId, email });
      setStatus(t("shared.removed", { email }));
      setConfirmRemoveEmail(null);
      await refreshSharedFromRemote();
    } catch (err) {
      setStatus(t("shared.removeFailed", { error: String(err) }));
    }
  }, [activeSpaceId, setStatus]);

  const handleSaveSettings = useCallback(async () => {
    if (!activeSpace || !activeSpaceId) return;
    const updatedAt = asString(activeSpace.updated_date, asString(activeSpace.created_date, ""));
    try {
      await safeEntityUpdate("Space", activeSpaceId, { name: editName.trim(), description: editDesc.trim() }, updatedAt);
      setStatus(t("settings.saved"));
      await refreshSharedFromRemote();
    } catch (err) {
      setStatus(t("shared.createFailed", { error: String(err) }));
    }
  }, [activeSpace, activeSpaceId, editName, editDesc, setStatus]);

  const handleDeleteSpace = useCallback(async (spaceId: string) => {
    try {
      await entityDelete("Space", spaceId);
      setStatus(t("shared.deleted"));
      setActiveSpaceId(null);
      setMenuOpenId(null);
      setConfirmDeleteSpaceId(null);
      await refreshAccessScope();
      await refreshSharedFromRemote();
    } catch (err) {
      setStatus(t("shared.deleteFailed", { error: String(err) }));
    }
  }, [setStatus]);

  // All people in the space (creator + members) — must be before early return to avoid hooks violation
  const allMembers = useMemo(() => {
    if (!activeSpace) return [];
    const creator = asString(activeSpace.created_by);
    const members: SpaceMember[] = Array.isArray(activeSpace.members) ? activeSpace.members as SpaceMember[] : [];
    const result: { email: string; role: string }[] = [{ email: creator, role: "owner" }];
    for (const m of members) {
      const email = (m.email || "").toLowerCase();
      if (email && email !== creator.toLowerCase()) {
        result.push({ email, role: m.role || "viewer" });
      }
    }
    return result;
  }, [activeSpace]);

  const sections: { id: SectionId; label: string }[] = useMemo(() => [
    { id: "files" as SectionId, label: tr("shared.filesTab") },
    { id: "chat" as SectionId, label: tr("shared.chatTab") },
    { id: "members" as SectionId, label: tr("shared.membersTab") },
    ...(isOwner ? [{ id: "settings" as SectionId, label: tr("shared.settingsTab") }] : []),
  ], [isOwner, tr]);

  const enterSpace = useCallback((id: string) => {
    setActiveSpaceId(id);
    setActiveSection("files");
  }, []);

  // ── Space List View ──
  if (!activeSpace) {
    return (
      <section className="tab-panel" style={{ padding: "20px 28px 28px" }}>
        <div className="tab-head-row">
          <div>
            <h2 className="page-title">{tr("shared.title")}</h2>
            <p className="page-subtitle">{tr("shared.subtitle")}</p>
          </div>
          <button type="button" onClick={() => setCreateOpen(true)}>{tr("shared.newSpace")}</button>
        </div>

        {spaces.length === 0 ? (
          <div className="dash-card"><p>{tr("shared.noSpaces")}</p></div>
        ) : (
          <div className="space-grid">
            {spaces.map((space) => {
              const id = asString(space.id);
              const name = asString(space.name, tr("shared.unnamed"));
              const desc = asString(space.description);
              const members: SpaceMember[] = Array.isArray(space.members) ? space.members as SpaceMember[] : [];
              const itemCount = spaceItemCounts[id] || 0;
              const creator = asString(space.created_by);

              // Combine creator + members for avatar display
              const avatarEmails = [creator, ...members.map((m) => m.email || "")].filter(Boolean);
              const uniqueAvatars = [...new Set(avatarEmails)].slice(0, 5);

              return (
                <div key={id} className="space-card" onClick={() => enterSpace(id)}>
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
                        <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDeleteSpaceId(id); setMenuOpenId(null); }}>
                          {tr("shared.deleteSpace")}
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
                    <span className="space-card-count">
                      {tr("shared.items", { count: itemCount })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Delete Space Confirm Modal */}
        {confirmDeleteSpaceId && (
          <div className="modal">
            <div className="modal-backdrop" onClick={() => setConfirmDeleteSpaceId(null)} />
            <div className="modal-panel">
              <div className="modal-head">
                <h3>{tr("shared.deleteSpace")}</h3>
                <button type="button" onClick={() => setConfirmDeleteSpaceId(null)}>&times;</button>
              </div>
              <div className="form" style={{ padding: "0 16px 16px" }}>
                <p>{tr("shared.deleteConfirm")}</p>
                <div className="actions-row">
                  <button type="button" className="ghost" onClick={() => setConfirmDeleteSpaceId(null)}>
                    {tr("shared.cancel")}
                  </button>
                  <button type="button" style={{ background: "#ef4444" }} onClick={() => handleDeleteSpace(confirmDeleteSpaceId)}>
                    {tr("shared.deleteSpace")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Create Space Modal */}
        {createOpen && (
          <div className="modal">
            <div className="modal-backdrop" onClick={() => setCreateOpen(false)} />
            <div className="modal-panel">
              <div className="modal-head">
                <h3>{tr("shared.createTitle")}</h3>
                <button type="button" onClick={() => setCreateOpen(false)}>&times;</button>
              </div>
              <div className="form" style={{ padding: "0 16px 16px" }}>
                <label>{tr("shared.nameLabel")}</label>
                <input
                  type="text"
                  placeholder={tr("shared.nameLabel")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                <label>{tr("shared.descLabel")}</label>
                <input
                  type="text"
                  placeholder={tr("shared.descLabel")}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
                <div className="actions-row">
                  <button type="button" className="ghost" onClick={() => setCreateOpen(false)}>
                    {tr("shared.cancel")}
                  </button>
                  <button type="button" onClick={handleCreateSpace} disabled={creating || !newName.trim()}>
                    {creating ? tr("shared.creating") : tr("shared.create")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  // ── Space Detail View ──
  const spaceName = asString(activeSpace.name, tr("shared.unnamed"));
  const spaceDesc = asString(activeSpace.description);

  return (
    <section className="tab-panel" style={{ padding: "20px 28px 28px" }}>
      <button type="button" className="space-detail-back" onClick={() => setActiveSpaceId(null)}>
        &#x2190; {tr("shared.backToSpaces")}
      </button>

      <h2 className="space-detail-name">{spaceName}</h2>
      {spaceDesc && <p className="space-detail-desc">{spaceDesc}</p>}

      {/* Section tabs */}
      <div className="space-section-tabs">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className={activeSection === s.id ? "active" : ""}
            onClick={() => setActiveSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Files section */}
      {activeSection === "files" && (
        <div className="files-items">
          {spaceFolders.length === 0 && spaceItems.length === 0 ? (
            <div className="dash-card"><p>{tr("shared.noFiles")}</p></div>
          ) : (
            <>
              {spaceFolders.map((folder) => (
                <article key={folder.id} className="file-row group">
                  <div className="file-row-icon">&#x1F4C1;</div>
                  <div className="file-row-body">
                    <p className="file-row-title">{folder.name}</p>
                  </div>
                </article>
              ))}
              {spaceItems.map((item) => (
                <article
                  key={item.id}
                  className="file-row group"
                  style={{ cursor: "pointer" }}
                  onClick={() => setFileActionTargetId(item.id)}
                >
                  <div className="file-row-icon">
                    {item.itemType === "note" ? "\u{1F4DD}" : item.itemType === "link" ? "\u{1F517}" : "\u{1F4CE}"}
                  </div>
                  <div className="file-row-body">
                    <p className="file-row-title">{item.title}</p>
                    <p className="file-row-sub">{item.itemType}</p>
                  </div>
                </article>
              ))}
            </>
          )}
        </div>
      )}

      {/* Chat section */}
      {activeSection === "chat" && (
        <div className="space-chat">
          <div className="space-chat-messages">
            {chatLoading && <p style={{ color: "var(--muted)", fontSize: 13 }}>{tr("shared.chatLoading")}</p>}
            {!chatLoading && chatMessages.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", marginTop: 40 }}>
                {tr("shared.noMessages")}
              </p>
            )}
            {chatMessages.map((msg) => {
              const senderDisplay = msg.sender_name || toDisplayName(msg.sender_email);
              return (
                <div key={msg.id} className="space-chat-msg">
                  <div className="space-chat-msg-avatar" style={{ background: avatarColor(senderDisplay) }}>
                    {initials(senderDisplay)}
                  </div>
                  <div className="space-chat-msg-body">
                    <span className="space-chat-msg-sender">
                      {senderDisplay}
                      <span className="space-chat-msg-time">{formatChatTime(msg.created_at)}</span>
                    </span>
                    <p className="space-chat-msg-text">{msg.message}</p>
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
          <div className="space-chat-input-row">
            <input
              type="text"
              placeholder={tr("shared.messagePlaceholder")}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
            />
            <button type="button" onClick={handleSendMessage} disabled={chatSending || !chatInput.trim()}>
              {tr("shared.sendMessage")}
            </button>
          </div>
        </div>
      )}

      {/* Members section */}
      {activeSection === "members" && (
        <div>
          {isOwner && (
            <div style={{ marginBottom: 16 }}>
              <button type="button" onClick={() => setInviteOpen(true)}>{tr("shared.inviteMember")}</button>
            </div>
          )}
          <div className="space-member-list">
            {allMembers.map((m) => {
              const display = toDisplayName(m.email);
              const roleKey = m.role === "owner" ? "shared.owner" : m.role === "editor" ? "shared.editor" : "shared.viewer";
              const roleClass = `role-${m.role}`;
              return (
                <div key={m.email} className="space-member-row">
                  <div className="space-avatar" style={{ background: avatarColor(display), marginLeft: 0 }}>
                    {initials(display)}
                  </div>
                  <div className="space-member-info">
                    <p className="space-member-email">{display}</p>
                    <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>{m.email}</p>
                  </div>
                  <span className={`space-member-role ${roleClass}`}>{tr(roleKey)}</span>
                  {isOwner && m.role !== "owner" && (
                    confirmRemoveEmail === m.email ? (
                      <div className="confirm-inline">
                        <span>{tr("shared.removeConfirm", { email: m.email })}</span>
                        <button type="button" className="confirm-yes" onClick={() => handleRemoveMember(m.email)}>{tr("delete.submit")}</button>
                        <button type="button" className="confirm-no" onClick={() => setConfirmRemoveEmail(null)}>{tr("shared.cancel")}</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="space-member-remove"
                        onClick={() => setConfirmRemoveEmail(m.email)}
                      >
                        {tr("shared.removeMember")}
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>

          {/* Invite modal */}
          {inviteOpen && (
            <div className="modal">
              <div className="modal-backdrop" onClick={() => setInviteOpen(false)} />
              <div className="modal-panel">
                <div className="modal-head">
                  <h3>{tr("shared.inviteTitle")}</h3>
                  <button type="button" onClick={() => setInviteOpen(false)}>&times;</button>
                </div>
                <div className="form" style={{ padding: "0 16px 16px" }}>
                  <label>{tr("email.from")}</label>
                  <input
                    type="email"
                    placeholder={tr("shared.emailPlaceholder")}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    autoFocus
                  />
                  <label>{tr("shared.roleLabel")}</label>
                  <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}>
                    <option value="editor">{tr("shared.roleEditor")}</option>
                    <option value="viewer">{tr("shared.roleViewer")}</option>
                  </select>
                  <div className="actions-row">
                    <button type="button" className="ghost" onClick={() => setInviteOpen(false)}>
                      {tr("shared.cancel")}
                    </button>
                    <button type="button" onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                      {inviting ? tr("shared.inviting") : tr("shared.sendInvite")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Settings section (owner only) */}
      {activeSection === "settings" && isOwner && (
        <div>
          <div className="space-settings-form">
            <label>{tr("shared.nameLabel")}</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
            <label>{tr("shared.descLabel")}</label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
            />
            <div className="space-settings-actions">
              <button type="button" onClick={handleSaveSettings} disabled={!editName.trim()}>
                {tr("shared.saveSettings")}
              </button>
              <button
                type="button"
                className="ghost"
                style={{ color: "#f87171" }}
                onClick={() => openDeleteModal({ kind: "item", id: activeSpaceId!, entity: "Space" })}
              >
                {tr("shared.deleteSpace")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
