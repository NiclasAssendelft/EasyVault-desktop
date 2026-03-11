import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useFilesStore } from "../../../stores/filesStore";
import { useUiStore } from "../../../stores/uiStore";
import { asString, toDisplayName } from "../../../services/helpers";
import { safeEntityUpdate } from "../../../services/entityService";
import { invokeEdgeFunction } from "../../../api";
import { refreshSharedFromRemote } from "../../../services/deltaSyncService";
import { uploadSelectedFilesToSpace } from "../../../services/fileOps";
import { useT, t } from "../../../i18n";
import type { ActionTarget } from "../../../services/helpers";
import { avatarColor, initials, formatChatTime, formatActivityTime, currentUserEmail } from "./workspaceHelpers";
import type { SpaceMember, SpaceMessage, SpaceTask, ActivityEntry, SectionId } from "./workspaceTypes";

interface WorkspaceDetailProps {
  space: Record<string, unknown>;
  onBack: () => void;
}

export default function WorkspaceDetail({ space, onBack }: WorkspaceDetailProps) {
  const allItems = useFilesStore((s) => s.items);
  const allFolders = useFilesStore((s) => s.folders);
  const openDeleteModal = useUiStore((s) => s.openDeleteModal);
  const setFileActionTargetId = useUiStore((s) => s.setFileActionTargetId);
  const setStatus = useUiStore((s) => s.setStatus);
  const tr = useT();

  const activeSpaceId = asString(space.id);
  const me = currentUserEmail();

  // ── Local state ──
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [chatMessages, setChatMessages] = useState<SpaceMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<SpaceMessage | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [inviting, setInviting] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [inviteLinkRole, setInviteLinkRole] = useState<"editor" | "viewer">("viewer");
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [inviteLinkToken, setInviteLinkToken] = useState<string | null>(null);
  const [confirmRemoveEmail, setConfirmRemoveEmail] = useState<string | null>(null);

  // ── Computed ──
  const isOwner = useMemo(() => {
    if (asString(space.created_by).toLowerCase() === me) return true;
    const members = Array.isArray(space.members) ? space.members : [];
    return members.some(
      (m) => m && typeof m === "object" &&
        asString((m as SpaceMember).email).toLowerCase() === me &&
        asString((m as SpaceMember).role) === "owner",
    );
  }, [space, me]);

  const canEdit = useMemo(() => {
    if (isOwner) return true;
    const members = Array.isArray(space.members) ? space.members as SpaceMember[] : [];
    return members.some(
      (m) => asString(m.email).toLowerCase() === me && (asString(m.role) === "editor" || asString(m.role) === "owner"),
    );
  }, [space, isOwner, me]);

  const spaceItems = useMemo(
    () => allItems.filter((i) => i.spaceId === activeSpaceId),
    [allItems, activeSpaceId],
  );

  const spaceFolders = useMemo(
    () => allFolders.filter((f) => f.spaceId === activeSpaceId),
    [allFolders, activeSpaceId],
  );

  const filteredItems = useMemo(() => {
    if (!fileSearch.trim()) return spaceItems;
    const q = fileSearch.toLowerCase();
    return spaceItems.filter((i) => i.title.toLowerCase().includes(q));
  }, [spaceItems, fileSearch]);

  const filteredFolders = useMemo(() => {
    if (!fileSearch.trim()) return spaceFolders;
    const q = fileSearch.toLowerCase();
    return spaceFolders.filter((f) => f.name.toLowerCase().includes(q));
  }, [spaceFolders, fileSearch]);

  const pinnedMessages = useMemo(
    () => chatMessages.filter((m) => m.is_pinned),
    [chatMessages],
  );

  const allMembers = useMemo(() => {
    const creator = asString(space.created_by);
    const members: SpaceMember[] = Array.isArray(space.members) ? space.members as SpaceMember[] : [];
    const result: { email: string; role: string }[] = [{ email: creator, role: "owner" }];
    for (const m of members) {
      const email = (m.email || "").toLowerCase();
      if (email && email !== creator.toLowerCase()) {
        result.push({ email, role: m.role || "viewer" });
      }
    }
    return result;
  }, [space]);

  const activeTasks = useMemo(() => tasks.filter((tk) => !tk.is_completed), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((tk) => tk.is_completed), [tasks]);

  const replyToMap = useMemo(() => {
    const map = new Map<string, SpaceMessage>();
    for (const msg of chatMessages) map.set(msg.id, msg);
    return map;
  }, [chatMessages]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return allMembers.filter((m) => {
      const name = toDisplayName(m.email).toLowerCase();
      return name.includes(q) || m.email.toLowerCase().includes(q);
    }).slice(0, 5);
  }, [mentionQuery, allMembers]);

  // ── Effects ──
  useEffect(() => {
    if (activeSection === "settings") {
      setEditName(asString(space.name));
      setEditDesc(asString(space.description));
    }
  }, [activeSection, space]);

  const fetchChatMessages = useCallback(async (spaceId: string) => {
    try {
      const res = await invokeEdgeFunction<{ messages?: SpaceMessage[] }>("spaceMessages", { space_id: spaceId });
      const msgs = res.messages || [];
      setChatMessages(msgs.reverse());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (activeSection !== "chat") return;
    setChatLoading(true);
    fetchChatMessages(activeSpaceId).finally(() => setChatLoading(false));
    const timer = setInterval(() => fetchChatMessages(activeSpaceId), 5000);
    return () => clearInterval(timer);
  }, [activeSection, activeSpaceId, fetchChatMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length]);

  const fetchTasks = useCallback(async (spaceId: string) => {
    try {
      const res = await invokeEdgeFunction<{ tasks?: SpaceTask[] }>("spaceTasks", { space_id: spaceId, action: "list" });
      setTasks(res.tasks || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (activeSection !== "tasks") return;
    setTasksLoading(true);
    fetchTasks(activeSpaceId).finally(() => setTasksLoading(false));
    const timer = setInterval(() => fetchTasks(activeSpaceId), 10000);
    return () => clearInterval(timer);
  }, [activeSection, activeSpaceId, fetchTasks]);

  const fetchActivity = useCallback(async (spaceId: string) => {
    try {
      const res = await invokeEdgeFunction<{ activities?: ActivityEntry[] }>("spaceActivity", { space_id: spaceId });
      setActivities(res.activities || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (activeSection !== "activity") return;
    setActivityLoading(true);
    fetchActivity(activeSpaceId).finally(() => setActivityLoading(false));
  }, [activeSection, activeSpaceId, fetchActivity]);

  // ── Handlers ──
  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim()) return;
    setChatSending(true);
    try {
      const displayName = toDisplayName(me);
      const payload: Record<string, unknown> = { space_id: activeSpaceId, message: chatInput.trim(), sender_name: displayName };
      if (replyTo) payload.reply_to_id = replyTo.id;
      const mentionMatches = chatInput.match(/@(\S+)/g);
      if (mentionMatches) payload.mentions = mentionMatches.map((m) => m.slice(1).toLowerCase());
      await invokeEdgeFunction("spaceMessages", payload);
      setChatInput("");
      setReplyTo(null);
      await fetchChatMessages(activeSpaceId);
    } catch { /* ignore */ }
    finally { setChatSending(false); }
  }, [chatInput, activeSpaceId, me, replyTo, fetchChatMessages]);

  const handlePinMessage = useCallback(async (msgId: string) => {
    try {
      await invokeEdgeFunction("spaceMessages", { space_id: activeSpaceId, action: "pin", pin_message_id: msgId });
      await fetchChatMessages(activeSpaceId);
    } catch { /* ignore */ }
  }, [activeSpaceId, fetchChatMessages]);

  const handleInvite = useCallback(async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await invokeEdgeFunction("spaceInvite", { space_id: activeSpaceId, email: inviteEmail.trim(), role: inviteRole });
      setStatus(t("workspaces.invited", { email: inviteEmail.trim(), role: inviteRole }));
      setInviteOpen(false);
      setInviteEmail("");
      await refreshSharedFromRemote();
    } catch (err) {
      setStatus(t("workspaces.inviteFailed", { error: String(err) }));
    } finally { setInviting(false); }
  }, [inviteEmail, inviteRole, activeSpaceId, setStatus]);

  const handleRemoveMember = useCallback(async (email: string) => {
    try {
      await invokeEdgeFunction("spaceRemoveMember", { space_id: activeSpaceId, email });
      setStatus(t("workspaces.removed", { email }));
      setConfirmRemoveEmail(null);
      await refreshSharedFromRemote();
    } catch (err) { setStatus(t("workspaces.removeFailed", { error: String(err) })); }
  }, [activeSpaceId, setStatus]);

  const handleUpdateRole = useCallback(async (email: string, newRole: string) => {
    try {
      await invokeEdgeFunction("spaceUpdateRole", { space_id: activeSpaceId, email, role: newRole });
      setStatus(t("workspaces.roleUpdated", { role: newRole }));
      await refreshSharedFromRemote();
    } catch (err) { setStatus(t("workspaces.roleUpdateFailed", { error: String(err) })); }
  }, [activeSpaceId, setStatus]);

  const handleSaveSettings = useCallback(async () => {
    const updatedAt = asString(space.updated_date, asString(space.created_date, ""));
    try {
      await safeEntityUpdate("Space", activeSpaceId, { name: editName.trim(), description: editDesc.trim() }, updatedAt);
      setStatus(t("settings.saved"));
      await refreshSharedFromRemote();
    } catch (err) { setStatus(t("workspaces.deleteFailed", { error: String(err) })); }
  }, [space, activeSpaceId, editName, editDesc, setStatus]);

  const handleUpload = useCallback(async () => {
    try { await uploadSelectedFilesToSpace(activeSpaceId); await refreshSharedFromRemote(); }
    catch (err) { setStatus(String(err)); }
  }, [activeSpaceId, setStatus]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!e.dataTransfer.files.length) return;
    try { await uploadSelectedFilesToSpace(activeSpaceId, Array.from(e.dataTransfer.files)); await refreshSharedFromRemote(); }
    catch (err) { setStatus(String(err)); }
  }, [activeSpaceId, setStatus]);

  // Tauri v2: OS file drops emit tauri://drag-drop instead of DOM drag events
  useEffect(() => {
    if (activeSection !== "files") return;
    type TauriEvent = { listen: (event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void> };
    const tauriEvent = (window as unknown as { __TAURI__?: { event?: TauriEvent } }).__TAURI__?.event;
    if (!tauriEvent) return;
    let unlisten: (() => void) | undefined;
    void tauriEvent.listen("tauri://drag-drop", async (e) => {
      const payload = e.payload as { paths?: string[] };
      setDragOver(false);
      if (!payload.paths?.length || !canEdit) return;
      const invoke = (window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string, args: unknown) => Promise<unknown> } } }).__TAURI__?.core?.invoke;
      if (!invoke) return;
      const files: File[] = [];
      for (const path of payload.paths) {
        try {
          const bytes = await invoke("read_file_bytes", { path }) as number[];
          const filename = path.split("/").pop() || path.split("\\").pop() || "file";
          files.push(new File([new Uint8Array(bytes)], filename));
        } catch { /* skip */ }
      }
      if (files.length > 0) {
        try { await uploadSelectedFilesToSpace(activeSpaceId, files); await refreshSharedFromRemote(); }
        catch (err) { setStatus(String(err)); }
      }
    }).then((u) => { unlisten = u; });
    return () => { unlisten?.(); };
  }, [activeSection, activeSpaceId, canEdit, setStatus]);

  const handleAddTask = useCallback(async () => {
    if (!newTaskTitle.trim()) return;
    try {
      await invokeEdgeFunction("spaceTasks", { space_id: activeSpaceId, action: "create", title: newTaskTitle.trim() });
      setNewTaskTitle("");
      await fetchTasks(activeSpaceId);
    } catch { /* ignore */ }
  }, [newTaskTitle, activeSpaceId, fetchTasks]);

  const handleToggleTask = useCallback(async (taskId: string, completed: boolean) => {
    try {
      await invokeEdgeFunction("spaceTasks", { space_id: activeSpaceId, action: "update", task_id: taskId, is_completed: !completed });
      await fetchTasks(activeSpaceId);
    } catch { /* ignore */ }
  }, [activeSpaceId, fetchTasks]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    try {
      await invokeEdgeFunction("spaceTasks", { space_id: activeSpaceId, action: "delete", task_id: taskId });
      await fetchTasks(activeSpaceId);
    } catch { /* ignore */ }
  }, [activeSpaceId, fetchTasks]);

  const handleCopyInviteLink = useCallback(async () => {
    try {
      const res = await invokeEdgeFunction<{ token?: string }>("spaceInviteLink", { space_id: activeSpaceId, action: "create", role: inviteLinkRole });
      if (res.token) {
        setInviteLinkToken(res.token);
        // Try clipboard; textarea fallback with explicit focus for Tauri WebView
        let copied = false;
        try {
          await navigator.clipboard.writeText(res.token);
          copied = true;
        } catch {
          try {
            const el = document.createElement("textarea");
            el.value = res.token;
            el.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px";
            document.body.appendChild(el);
            el.focus();
            el.select();
            copied = document.execCommand("copy");
            document.body.removeChild(el);
          } catch { /* ignore */ }
        }
        if (copied) {
          setInviteLinkCopied(true);
          setTimeout(() => setInviteLinkCopied(false), 2000);
        }
      }
    } catch (err) { setStatus(t("workspaces.inviteLinkFailed", { error: String(err) })); }
  }, [activeSpaceId, inviteLinkRole, setStatus]);

  const handleChatInputChange = useCallback((val: string) => {
    setChatInput(val);
    const lastAt = val.lastIndexOf("@");
    if (lastAt >= 0) {
      const after = val.slice(lastAt + 1);
      if (!after.includes(" ") && after.length <= 30) { setMentionQuery(after); setMentionIndex(0); return; }
    }
    setMentionQuery(null);
  }, []);

  const insertMention = useCallback((email: string) => {
    const lastAt = chatInput.lastIndexOf("@");
    if (lastAt >= 0) setChatInput(chatInput.slice(0, lastAt) + "@" + toDisplayName(email) + " ");
    setMentionQuery(null);
    chatInputRef.current?.focus();
  }, [chatInput]);

  // ── Section tabs ──
  const sections: { id: SectionId; label: string; icon: string }[] = useMemo(() => [
    { id: "overview" as SectionId, label: tr("workspaces.overviewTab"), icon: "\u{1F3E0}" },
    { id: "files" as SectionId, label: tr("workspaces.filesTab"), icon: "\u{1F4C1}" },
    { id: "chat" as SectionId, label: tr("workspaces.chatTab"), icon: "\u{1F4AC}" },
    { id: "tasks" as SectionId, label: tr("workspaces.tasksTab"), icon: "\u2705" },
    { id: "members" as SectionId, label: tr("workspaces.membersTab"), icon: "\u{1F465}" },
    { id: "activity" as SectionId, label: tr("workspaces.activityTab"), icon: "\u{1F4CA}" },
    ...(isOwner ? [{ id: "settings" as SectionId, label: tr("workspaces.settingsTab"), icon: "\u2699\uFE0F" }] : []),
  ], [isOwner, tr]);

  const spaceName = asString(space.name, tr("workspaces.unnamed"));
  const spaceDesc = asString(space.description);

  return (
    <section className="tab-panel" style={{ padding: "20px 28px 28px" }}>
      <button type="button" className="space-detail-back" onClick={onBack}>
        &#x2190; {tr("workspaces.backToSpaces")}
      </button>
      <h2 className="space-detail-name">{spaceName}</h2>
      {spaceDesc && <p className="space-detail-desc">{spaceDesc}</p>}

      <div className="space-section-tabs">
        {sections.map((s) => (
          <button key={s.id} type="button" className={activeSection === s.id ? "active" : ""} onClick={() => setActiveSection(s.id)}>
            <span style={{ marginRight: 4 }}>{s.icon}</span>{s.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeSection === "overview" && (
        <WorkspaceOverviewPanel
          spaceItems={spaceItems}
          spaceFolders={spaceFolders}
          allMembers={allMembers}
          activeTasks={activeTasks}
          setActiveSection={setActiveSection}
          setFileActionTargetId={setFileActionTargetId}
        />
      )}

      {/* Files */}
      {activeSection === "files" && (
        <WorkspaceFilesPanel
          fileSearch={fileSearch}
          setFileSearch={setFileSearch}
          canEdit={canEdit}
          handleUpload={handleUpload}
          dragOver={dragOver}
          setDragOver={setDragOver}
          handleDrop={handleDrop}
          filteredFolders={filteredFolders}
          filteredItems={filteredItems}
          setFileActionTargetId={setFileActionTargetId}
        />
      )}

      {/* Chat */}
      {activeSection === "chat" && (
        <WorkspaceChatPanel
          chatMessages={chatMessages}
          chatLoading={chatLoading}
          chatInput={chatInput}
          chatSending={chatSending}
          chatEndRef={chatEndRef}
          chatInputRef={chatInputRef}
          replyTo={replyTo}
          setReplyTo={setReplyTo}
          replyToMap={replyToMap}
          pinnedMessages={pinnedMessages}
          isOwner={isOwner}
          canEdit={canEdit}
          mentionQuery={mentionQuery}
          mentionIndex={mentionIndex}
          mentionCandidates={mentionCandidates}
          handleSendMessage={handleSendMessage}
          handlePinMessage={handlePinMessage}
          handleChatInputChange={handleChatInputChange}
          insertMention={insertMention}
          setMentionIndex={setMentionIndex}
          setMentionQuery={setMentionQuery}
        />
      )}

      {/* Tasks */}
      {activeSection === "tasks" && (
        <WorkspaceTasksPanel
          canEdit={canEdit}
          tasksLoading={tasksLoading}
          activeTasks={activeTasks}
          completedTasks={completedTasks}
          newTaskTitle={newTaskTitle}
          setNewTaskTitle={setNewTaskTitle}
          showCompleted={showCompleted}
          setShowCompleted={setShowCompleted}
          handleAddTask={handleAddTask}
          handleToggleTask={handleToggleTask}
          handleDeleteTask={handleDeleteTask}
        />
      )}

      {/* Members */}
      {activeSection === "members" && (
        <WorkspaceMembersPanel
          allMembers={allMembers}
          isOwner={isOwner}
          inviteLinkRole={inviteLinkRole}
          setInviteLinkRole={setInviteLinkRole}
          confirmRemoveEmail={confirmRemoveEmail}
          setConfirmRemoveEmail={setConfirmRemoveEmail}
          handleUpdateRole={handleUpdateRole}
          handleRemoveMember={handleRemoveMember}
          handleCopyInviteLink={handleCopyInviteLink}
          inviteLinkCopied={inviteLinkCopied}
          inviteLinkToken={inviteLinkToken}
          setInviteOpen={setInviteOpen}
        />
      )}

      {/* Activity */}
      {activeSection === "activity" && (
        <WorkspaceActivityPanel
          activities={activities}
          activityLoading={activityLoading}
        />
      )}

      {/* Settings */}
      {activeSection === "settings" && isOwner && (
        <WorkspaceSettingsPanel
          editName={editName}
          setEditName={setEditName}
          editDesc={editDesc}
          setEditDesc={setEditDesc}
          handleSaveSettings={handleSaveSettings}
          openDeleteModal={openDeleteModal}
          activeSpaceId={activeSpaceId}
        />
      )}

      {/* Invite modal (shared across panels) */}
      {inviteOpen && (
        <div className="modal">
          <div className="modal-backdrop" onClick={() => setInviteOpen(false)} />
          <div className="modal-panel">
            <div className="modal-head">
              <h3>{tr("workspaces.inviteTitle")}</h3>
              <button type="button" onClick={() => setInviteOpen(false)}>&times;</button>
            </div>
            <div className="form" style={{ padding: "0 16px 16px" }}>
              <label>{tr("email.from")}</label>
              <input type="email" placeholder={tr("workspaces.emailPlaceholder")} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} autoFocus />
              <label>{tr("workspaces.roleLabel")}</label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}>
                <option value="editor">{tr("workspaces.roleEditor")}</option>
                <option value="viewer">{tr("workspaces.roleViewer")}</option>
              </select>
              <div className="actions-row">
                <button type="button" className="ghost" onClick={() => setInviteOpen(false)}>{tr("workspaces.cancel")}</button>
                <button type="button" onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? tr("workspaces.inviting") : tr("workspaces.sendInvite")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Panel Components ──

type VaultItem = { id: string; title: string; itemType: string; spaceId?: string };
type VaultFolder = { id: string; name: string; spaceId?: string };

function WorkspaceOverviewPanel({ spaceItems, spaceFolders, allMembers, activeTasks, setActiveSection, setFileActionTargetId }: {
  spaceItems: VaultItem[];
  spaceFolders: VaultFolder[];
  allMembers: { email: string; role: string }[];
  activeTasks: SpaceTask[];
  setActiveSection: (s: SectionId) => void;
  setFileActionTargetId: (id: string) => void;
}) {
  const tr = useT();
  return (
    <div className="space-overview">
      <div className="space-overview-grid">
        {/* Files summary */}
        <div className="space-overview-card" onClick={() => setActiveSection("files")} style={{ cursor: "pointer" }}>
          <div className="space-overview-card-icon">{"\u{1F4C1}"}</div>
          <div className="space-overview-card-body">
            <h4>{tr("workspaces.filesTab")}</h4>
            <p className="space-overview-stat">{spaceItems.length} {tr("workspaces.filesCount")}</p>
            <p className="space-overview-stat">{spaceFolders.length} {tr("workspaces.foldersCount")}</p>
          </div>
        </div>

        {/* Members summary */}
        <div className="space-overview-card" onClick={() => setActiveSection("members")} style={{ cursor: "pointer" }}>
          <div className="space-overview-card-icon">{"\u{1F465}"}</div>
          <div className="space-overview-card-body">
            <h4>{tr("workspaces.membersTab")}</h4>
            <div className="space-card-avatars" style={{ marginTop: 4 }}>
              {allMembers.slice(0, 5).map((m) => {
                const display = toDisplayName(m.email);
                return (
                  <div key={m.email} className="space-avatar" style={{ background: avatarColor(display), width: 24, height: 24, fontSize: 10, marginLeft: 0 }}>
                    {initials(display)}
                  </div>
                );
              })}
              {allMembers.length > 5 && <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 4 }}>+{allMembers.length - 5}</span>}
            </div>
          </div>
        </div>

        {/* Tasks summary */}
        <div className="space-overview-card" onClick={() => setActiveSection("tasks")} style={{ cursor: "pointer" }}>
          <div className="space-overview-card-icon">{"\u2705"}</div>
          <div className="space-overview-card-body">
            <h4>{tr("workspaces.tasksTab")}</h4>
            <p className="space-overview-stat">{activeTasks.length} {tr("workspaces.openTasks")}</p>
          </div>
        </div>

        {/* Chat shortcut */}
        <div className="space-overview-card" onClick={() => setActiveSection("chat")} style={{ cursor: "pointer" }}>
          <div className="space-overview-card-icon">{"\u{1F4AC}"}</div>
          <div className="space-overview-card-body">
            <h4>{tr("workspaces.chatTab")}</h4>
            <p className="space-overview-stat">{tr("workspaces.openChat")}</p>
          </div>
        </div>
      </div>

      {/* Recent files */}
      {spaceItems.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ margin: "0 0 8px", fontSize: 14, color: "var(--muted)" }}>{tr("workspaces.recentFiles")}</h4>
          <div className="files-items">
            {spaceItems.slice(0, 5).map((item) => (
              <article key={item.id} className="file-row group" style={{ cursor: "pointer" }} onClick={() => setFileActionTargetId(item.id)}>
                <div className="file-row-icon">{item.itemType === "note" ? "\u{1F4DD}" : item.itemType === "link" ? "\u{1F517}" : "\u{1F4CE}"}</div>
                <div className="file-row-body">
                  <p className="file-row-title">{item.title}</p>
                  <p className="file-row-sub">{item.itemType}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkspaceFilesPanel({ fileSearch, setFileSearch, canEdit, handleUpload, dragOver, setDragOver, handleDrop, filteredFolders, filteredItems, setFileActionTargetId }: {
  fileSearch: string;
  setFileSearch: (v: string) => void;
  canEdit: boolean;
  handleUpload: () => void;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  handleDrop: (e: React.DragEvent) => void;
  filteredFolders: VaultFolder[];
  filteredItems: VaultItem[];
  setFileActionTargetId: (id: string) => void;
}) {
  const tr = useT();
  return (
    <div
      className={`space-files-drop${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="space-files-toolbar">
        <input type="text" className="space-files-search" placeholder={tr("workspaces.searchPlaceholder")} value={fileSearch} onChange={(e) => setFileSearch(e.target.value)} />
        {canEdit && <button type="button" onClick={handleUpload}>{tr("workspaces.upload")}</button>}
      </div>
      {dragOver && <div className="space-files-drag-hint">{tr("workspaces.dragFiles")}</div>}
      <div className="files-items">
        {filteredFolders.length === 0 && filteredItems.length === 0 ? (
          <div className="dash-card"><p>{tr("workspaces.noFiles")}</p></div>
        ) : (
          <>
            {filteredFolders.map((folder) => (
              <article key={folder.id} className="file-row group">
                <div className="file-row-icon">&#x1F4C1;</div>
                <div className="file-row-body"><p className="file-row-title">{folder.name}</p></div>
              </article>
            ))}
            {filteredItems.map((item) => (
              <article key={item.id} className="file-row group" style={{ cursor: "pointer" }} onClick={() => setFileActionTargetId(item.id)}>
                <div className="file-row-icon">{item.itemType === "note" ? "\u{1F4DD}" : item.itemType === "link" ? "\u{1F517}" : "\u{1F4CE}"}</div>
                <div className="file-row-body">
                  <p className="file-row-title">{item.title}</p>
                  <p className="file-row-sub">{item.itemType}</p>
                </div>
              </article>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function WorkspaceChatPanel({ chatMessages, chatLoading, chatInput, chatSending, chatEndRef, chatInputRef, replyTo, setReplyTo, replyToMap, pinnedMessages, isOwner, canEdit, mentionQuery, mentionIndex, mentionCandidates, handleSendMessage, handlePinMessage, handleChatInputChange, insertMention, setMentionIndex, setMentionQuery }: {
  chatMessages: SpaceMessage[];
  chatLoading: boolean;
  chatInput: string;
  chatSending: boolean;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  chatInputRef: React.RefObject<HTMLInputElement | null>;
  replyTo: SpaceMessage | null;
  setReplyTo: (m: SpaceMessage | null) => void;
  replyToMap: Map<string, SpaceMessage>;
  pinnedMessages: SpaceMessage[];
  isOwner: boolean;
  canEdit: boolean;
  mentionQuery: string | null;
  mentionIndex: number;
  mentionCandidates: { email: string; role: string }[];
  handleSendMessage: () => void;
  handlePinMessage: (id: string) => void;
  handleChatInputChange: (val: string) => void;
  insertMention: (email: string) => void;
  setMentionIndex: React.Dispatch<React.SetStateAction<number>>;
  setMentionQuery: (v: string | null) => void;
}) {
  const tr = useT();
  return (
    <div className="space-chat">
      {pinnedMessages.length > 0 && (
        <div className="space-chat-pinned">
          <span className="space-chat-pinned-label">{"\u{1F4CC}"} {tr("workspaces.pinnedMessages")}</span>
          {pinnedMessages.map((pm) => (
            <div key={pm.id} className="space-chat-pinned-msg">
              <strong>{pm.sender_name || toDisplayName(pm.sender_email)}</strong>: {pm.message.slice(0, 80)}{pm.message.length > 80 ? "..." : ""}
              {(isOwner || canEdit) && <button type="button" className="space-chat-pin-btn" onClick={() => handlePinMessage(pm.id)}>{tr("workspaces.unpinMessage")}</button>}
            </div>
          ))}
        </div>
      )}
      <div className="space-chat-messages">
        {chatLoading && <p style={{ color: "var(--muted)", fontSize: 13 }}>{tr("workspaces.chatLoading")}</p>}
        {!chatLoading && chatMessages.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", marginTop: 40 }}>{tr("workspaces.noMessages")}</p>}
        {chatMessages.map((msg) => {
          const senderDisplay = msg.sender_name || toDisplayName(msg.sender_email);
          const replyParent = msg.reply_to_id ? replyToMap.get(msg.reply_to_id) : null;
          return (
            <div key={msg.id} className={`space-chat-msg${msg.is_pinned ? " pinned" : ""}`}>
              <div className="space-chat-msg-avatar" style={{ background: avatarColor(senderDisplay) }}>{initials(senderDisplay)}</div>
              <div className="space-chat-msg-body">
                <span className="space-chat-msg-sender">{senderDisplay}<span className="space-chat-msg-time">{formatChatTime(msg.created_at)}</span></span>
                {replyParent && <div className="space-chat-reply-ref">{"\u21A9"} {replyParent.sender_name || toDisplayName(replyParent.sender_email)}: {replyParent.message.slice(0, 60)}</div>}
                <p className="space-chat-msg-text">{msg.message}</p>
                <div className="space-chat-msg-actions">
                  <button type="button" onClick={() => setReplyTo(msg)}>{tr("workspaces.reply")}</button>
                  {(isOwner || canEdit) && <button type="button" onClick={() => handlePinMessage(msg.id)}>{msg.is_pinned ? tr("workspaces.unpinMessage") : tr("workspaces.pinMessage")}</button>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>
      {replyTo && (
        <div className="space-chat-reply-bar">
          <span>{tr("workspaces.replyingTo", { name: replyTo.sender_name || toDisplayName(replyTo.sender_email) })}</span>
          <button type="button" onClick={() => setReplyTo(null)}>{tr("workspaces.cancelReply")}</button>
        </div>
      )}
      <div className="space-chat-input-row" style={{ position: "relative" }}>
        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <div className="space-chat-mention-popup">
            {mentionCandidates.map((m, i) => (
              <button key={m.email} type="button" className={i === mentionIndex ? "active" : ""} onClick={() => insertMention(m.email)}>
                <div className="space-avatar" style={{ background: avatarColor(toDisplayName(m.email)), width: 22, height: 22, fontSize: 10, marginLeft: 0 }}>{initials(toDisplayName(m.email))}</div>
                {toDisplayName(m.email)}
              </button>
            ))}
          </div>
        )}
        <input
          ref={chatInputRef}
          type="text"
          placeholder={tr("workspaces.messagePlaceholder")}
          value={chatInput}
          onChange={(e) => handleChatInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (mentionQuery !== null && mentionCandidates.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, mentionCandidates.length - 1)); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
              if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); insertMention(mentionCandidates[mentionIndex].email); return; }
              if (e.key === "Escape") { setMentionQuery(null); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
          }}
        />
        <button type="button" onClick={handleSendMessage} disabled={chatSending || !chatInput.trim()}>{tr("workspaces.sendMessage")}</button>
      </div>
    </div>
  );
}

function WorkspaceTasksPanel({ canEdit, tasksLoading, activeTasks, completedTasks, newTaskTitle, setNewTaskTitle, showCompleted, setShowCompleted, handleAddTask, handleToggleTask, handleDeleteTask }: {
  canEdit: boolean;
  tasksLoading: boolean;
  activeTasks: SpaceTask[];
  completedTasks: SpaceTask[];
  newTaskTitle: string;
  setNewTaskTitle: (v: string) => void;
  showCompleted: boolean;
  setShowCompleted: (v: boolean) => void;
  handleAddTask: () => void;
  handleToggleTask: (id: string, completed: boolean) => void;
  handleDeleteTask: (id: string) => void;
}) {
  const tr = useT();
  return (
    <div className="space-tasks">
      {canEdit && (
        <div className="space-tasks-add">
          <input type="text" placeholder={tr("workspaces.addTask")} value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleAddTask(); }} />
          <button type="button" onClick={handleAddTask} disabled={!newTaskTitle.trim()}>+</button>
        </div>
      )}
      {tasksLoading && <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading...</p>}
      {!tasksLoading && activeTasks.length === 0 && completedTasks.length === 0 && <div className="dash-card"><p>{tr("workspaces.noTasks")}</p></div>}
      <div className="space-tasks-list">
        {activeTasks.map((task) => (
          <div key={task.id} className="space-task-row">
            <button type="button" className="space-task-check" onClick={() => handleToggleTask(task.id, task.is_completed)}>{"\u25CB"}</button>
            <div className="space-task-body">
              <p className="space-task-title">{task.title}</p>
              <div className="space-task-meta">
                {task.assigned_to && (
                  <span className="space-task-assignee">
                    <div className="space-avatar" style={{ background: avatarColor(toDisplayName(task.assigned_to)), width: 18, height: 18, fontSize: 8, marginLeft: 0 }}>{initials(toDisplayName(task.assigned_to))}</div>
                    {toDisplayName(task.assigned_to)}
                  </span>
                )}
                {task.due_date && <span className="space-task-due">{task.due_date}</span>}
              </div>
            </div>
            {canEdit && <button type="button" className="space-task-delete" onClick={() => handleDeleteTask(task.id)}>{"\u00D7"}</button>}
          </div>
        ))}
      </div>
      {completedTasks.length > 0 && (
        <>
          <button type="button" className="space-tasks-toggle" onClick={() => setShowCompleted(!showCompleted)}>
            {tr("workspaces.completedTasks")} ({completedTasks.length}) {showCompleted ? "\u25BE" : "\u25B8"}
          </button>
          {showCompleted && (
            <div className="space-tasks-list completed">
              {completedTasks.map((task) => (
                <div key={task.id} className="space-task-row completed">
                  <button type="button" className="space-task-check done" onClick={() => handleToggleTask(task.id, task.is_completed)}>{"\u2713"}</button>
                  <div className="space-task-body"><p className="space-task-title">{task.title}</p></div>
                  {canEdit && <button type="button" className="space-task-delete" onClick={() => handleDeleteTask(task.id)}>{"\u00D7"}</button>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WorkspaceMembersPanel({ allMembers, isOwner, inviteLinkRole, setInviteLinkRole, confirmRemoveEmail, setConfirmRemoveEmail, handleUpdateRole, handleRemoveMember, handleCopyInviteLink, inviteLinkCopied, inviteLinkToken, setInviteOpen }: {
  allMembers: { email: string; role: string }[];
  isOwner: boolean;
  inviteLinkRole: "editor" | "viewer";
  setInviteLinkRole: (v: "editor" | "viewer") => void;
  confirmRemoveEmail: string | null;
  setConfirmRemoveEmail: (v: string | null) => void;
  handleUpdateRole: (email: string, role: string) => void;
  handleRemoveMember: (email: string) => void;
  handleCopyInviteLink: () => void;
  inviteLinkCopied: boolean;
  inviteLinkToken: string | null;
  setInviteOpen: (v: boolean) => void;
}) {
  const tr = useT();
  return (
    <div>
      {isOwner && (
        <div className="space-members-toolbar">
          <button type="button" onClick={() => setInviteOpen(true)}>{tr("workspaces.inviteMember")}</button>
          <div className="space-invite-link-row">
            <select value={inviteLinkRole} onChange={(e) => setInviteLinkRole(e.target.value as "editor" | "viewer")}>
              <option value="viewer">{tr("workspaces.roleViewer")}</option>
              <option value="editor">{tr("workspaces.roleEditor")}</option>
            </select>
            <button type="button" onClick={handleCopyInviteLink} className={inviteLinkCopied ? "copied" : ""}>
              {inviteLinkCopied ? "✓ Copied!" : tr("workspaces.copyInviteLink")}
            </button>
          </div>
          {inviteLinkToken && (
            <div className="invite-link-display">
              <input type="text" readOnly value={inviteLinkToken} onFocus={(e) => e.target.select()} className="invite-link-input" />
            </div>
          )}
        </div>
      )}
      <div className="space-member-list">
        {allMembers.map((m) => {
          const display = toDisplayName(m.email);
          const roleKey = m.role === "owner" ? "workspaces.owner" : m.role === "editor" ? "workspaces.editor" : "workspaces.viewer";
          const roleClass = `role-${m.role}`;
          return (
            <div key={m.email} className="space-member-row">
              <div className="space-avatar" style={{ background: avatarColor(display), marginLeft: 0 }}>{initials(display)}</div>
              <div className="space-member-info">
                <p className="space-member-email">{display}</p>
                <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>{m.email}</p>
              </div>
              {isOwner && m.role !== "owner" ? (
                <select className={`space-member-role-select ${roleClass}`} value={m.role} onChange={(e) => handleUpdateRole(m.email, e.target.value)}>
                  <option value="editor">{tr("workspaces.editor")}</option>
                  <option value="viewer">{tr("workspaces.viewer")}</option>
                </select>
              ) : (
                <span className={`space-member-role ${roleClass}`}>{tr(roleKey)}</span>
              )}
              {isOwner && m.role !== "owner" && (
                confirmRemoveEmail === m.email ? (
                  <div className="confirm-inline">
                    <span>{tr("workspaces.removeConfirm", { email: m.email })}</span>
                    <button type="button" className="confirm-yes" onClick={() => handleRemoveMember(m.email)}>{tr("delete.submit")}</button>
                    <button type="button" className="confirm-no" onClick={() => setConfirmRemoveEmail(null)}>{tr("workspaces.cancel")}</button>
                  </div>
                ) : (
                  <button type="button" className="space-member-remove" onClick={() => setConfirmRemoveEmail(m.email)}>{tr("workspaces.removeMember")}</button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkspaceActivityPanel({ activities, activityLoading }: {
  activities: ActivityEntry[];
  activityLoading: boolean;
}) {
  const tr = useT();
  return (
    <div className="space-activity">
      {activityLoading && <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading...</p>}
      {!activityLoading && activities.length === 0 && <div className="dash-card"><p>{tr("workspaces.noActivity")}</p></div>}
      <div className="space-activity-list">
        {activities.map((a) => {
          const actor = toDisplayName(a.actor_email || "");
          return (
            <div key={a.id} className="space-activity-row">
              <div className="space-avatar" style={{ background: avatarColor(actor), width: 28, height: 28, fontSize: 11, marginLeft: 0 }}>{initials(actor)}</div>
              <div className="space-activity-body">
                <p className="space-activity-text"><strong>{actor}</strong> {a.action}{a.details ? ` \u2014 ${a.details}` : ""}</p>
                <span className="space-activity-time">{formatActivityTime(a.created_at)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkspaceSettingsPanel({ editName, setEditName, editDesc, setEditDesc, handleSaveSettings, openDeleteModal, activeSpaceId }: {
  editName: string;
  setEditName: (v: string) => void;
  editDesc: string;
  setEditDesc: (v: string) => void;
  handleSaveSettings: () => void;
  openDeleteModal: (target: ActionTarget) => void;
  activeSpaceId: string;
}) {
  const tr = useT();
  return (
    <div>
      <div className="space-settings-form">
        <label>{tr("workspaces.nameLabel")}</label>
        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
        <label>{tr("workspaces.descLabel")}</label>
        <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
        <div className="space-settings-actions">
          <button type="button" onClick={handleSaveSettings} disabled={!editName.trim()}>{tr("workspaces.saveSettings")}</button>
          <button type="button" className="ghost" style={{ color: "#f87171" }} onClick={() => openDeleteModal({ kind: "item", id: activeSpaceId, entity: "Space" })}>{tr("workspaces.deleteSpace")}</button>
        </div>
      </div>
    </div>
  );
}
