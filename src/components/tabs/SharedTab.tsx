import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { asString, toDisplayName } from "../../services/helpers";
import { safeEntityCreate, safeEntityUpdate } from "../../services/entityService";
import { entityCreate, entityDelete } from "../../api";
import { refreshSharedFromRemote, refreshAccessScope } from "../../services/deltaSyncService";
import { invokeEdgeFunction } from "../../api";
import { uploadSelectedFilesToSpace } from "../../services/fileOps";
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

function formatActivityTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type SpaceMessage = {
  id: string;
  space_id: string;
  sender_email: string;
  sender_name: string;
  message: string;
  created_at: string;
  is_pinned?: boolean;
  pinned_by?: string;
  reply_to_id?: string;
  mentions?: string[];
};

type SpaceMember = {
  email?: string;
  role?: string;
};

type SpaceTask = {
  id: string;
  space_id: string;
  title: string;
  is_completed: boolean;
  assigned_to: string;
  due_date: string;
  created_by: string;
  created_at: string;
};

type ActivityEntry = {
  id: string;
  action: string;
  actor_email: string;
  details: string;
  created_at: string;
};

type SectionId = "files" | "chat" | "members" | "tasks" | "activity" | "settings";

function currentUserEmail(): string {
  return getSavedEmail().trim().toLowerCase();
}

const TEMPLATES = [
  { id: "blank", icon: "\u{1F4C4}", nameKey: "shared.templateBlank" as const, folders: [] as string[], tasks: [] as string[], welcome: "" },
  { id: "project", icon: "\u{1F4CB}", nameKey: "shared.templateProject" as const, folders: ["Documents", "Assets", "Deliverables"], tasks: ["Define project scope", "Set timeline and milestones", "Assign team roles"], welcome: "Welcome to the project space! Check the Tasks tab to get started." },
  { id: "client", icon: "\u{1F91D}", nameKey: "shared.templateClient" as const, folders: ["Contracts", "Invoices", "Reports"], tasks: ["Upload signed contract", "Send initial invoice", "Schedule kickoff meeting"], welcome: "Client portal ready. Use this space to share documents and track progress." },
  { id: "team", icon: "\u{1F465}", nameKey: "shared.templateTeam" as const, folders: ["Guides", "Templates", "Meeting Notes"], tasks: ["Add team handbook", "Set up recurring meeting notes", "Document onboarding process"], welcome: "Team wiki initialized. Start documenting your processes and knowledge." },
];

export default function SharedTab() {
  const spaces = useRemoteDataStore((s) => s.spaces);
  const allItems = useFilesStore((s) => s.items);
  const allFolders = useFilesStore((s) => s.folders);
  const openDeleteModal = useUiStore((s) => s.openDeleteModal);
  const setFileActionTargetId = useUiStore((s) => s.setFileActionTargetId);
  const setStatus = useUiStore((s) => s.setStatus);
  const tr = useT();

  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("files");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("blank");
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
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [inviteLinkRole, setInviteLinkRole] = useState<"editor" | "viewer">("viewer");
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
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

  const canEdit = useMemo(() => {
    if (isOwner) return true;
    if (!activeSpace) return false;
    const members = Array.isArray(activeSpace.members) ? activeSpace.members as SpaceMember[] : [];
    return members.some(
      (m) => asString(m.email).toLowerCase() === me && (asString(m.role) === "editor" || asString(m.role) === "owner"),
    );
  }, [activeSpace, isOwner, me]);

  const spaceItemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of allItems) {
      const sid = item.spaceId;
      if (sid) counts[sid] = (counts[sid] || 0) + 1;
    }
    return counts;
  }, [allItems]);

  const spaceItems = useMemo(
    () => (activeSpaceId ? allItems.filter((i) => i.spaceId === activeSpaceId) : []),
    [allItems, activeSpaceId],
  );

  const spaceFolders = useMemo(
    () => (activeSpaceId ? allFolders.filter((f) => f.spaceId === activeSpaceId) : []),
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

  useEffect(() => {
    if (activeSection === "settings" && activeSpace) {
      setEditName(asString(activeSpace.name));
      setEditDesc(asString(activeSpace.description));
    }
  }, [activeSection, activeSpace]);

  const fetchChatMessages = useCallback(async (spaceId: string) => {
    try {
      const res = await invokeEdgeFunction<{ messages?: SpaceMessage[] }>("spaceMessages", { space_id: spaceId });
      const msgs = res.messages || [];
      setChatMessages(msgs.reverse());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (activeSection !== "chat" || !activeSpaceId) return;
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
    if (activeSection !== "tasks" || !activeSpaceId) return;
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
    if (activeSection !== "activity" || !activeSpaceId) return;
    setActivityLoading(true);
    fetchActivity(activeSpaceId).finally(() => setActivityLoading(false));
  }, [activeSection, activeSpaceId, fetchActivity]);

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

  // ── Handlers ──
  const handleCreateSpace = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await safeEntityCreate<Record<string, unknown>>("Space", { name: newName.trim(), description: newDesc.trim(), space_type: "shared", members: [{ email: me, role: "owner" }] });
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
      setStatus(t("shared.created", { name: newName.trim() }));
      await refreshAccessScope();
      await refreshSharedFromRemote();
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
      setSelectedTemplate("blank");
    } catch (err) {
      setStatus(t("shared.createFailed", { error: String(err) }));
    } finally {
      setCreating(false);
    }
  }, [newName, newDesc, me, selectedTemplate, setStatus]);

  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim() || !activeSpaceId) return;
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
    if (!activeSpaceId) return;
    try {
      await invokeEdgeFunction("spaceMessages", { space_id: activeSpaceId, action: "pin", pin_message_id: msgId });
      await fetchChatMessages(activeSpaceId);
    } catch { /* ignore */ }
  }, [activeSpaceId, fetchChatMessages]);

  const handleInvite = useCallback(async () => {
    if (!inviteEmail.trim() || !activeSpaceId) return;
    setInviting(true);
    try {
      await invokeEdgeFunction("spaceInvite", { space_id: activeSpaceId, email: inviteEmail.trim(), role: inviteRole });
      setStatus(t("shared.invited", { email: inviteEmail.trim(), role: inviteRole }));
      setInviteOpen(false);
      setInviteEmail("");
      await refreshSharedFromRemote();
    } catch (err) {
      setStatus(t("shared.inviteFailed", { error: String(err) }));
    } finally { setInviting(false); }
  }, [inviteEmail, inviteRole, activeSpaceId, setStatus]);

  const handleRemoveMember = useCallback(async (email: string) => {
    if (!activeSpaceId) return;
    try {
      await invokeEdgeFunction("spaceRemoveMember", { space_id: activeSpaceId, email });
      setStatus(t("shared.removed", { email }));
      setConfirmRemoveEmail(null);
      await refreshSharedFromRemote();
    } catch (err) { setStatus(t("shared.removeFailed", { error: String(err) })); }
  }, [activeSpaceId, setStatus]);

  const handleUpdateRole = useCallback(async (email: string, newRole: string) => {
    if (!activeSpaceId) return;
    try {
      await invokeEdgeFunction("spaceUpdateRole", { space_id: activeSpaceId, email, role: newRole });
      setStatus(t("shared.roleUpdated", { role: newRole }));
      await refreshSharedFromRemote();
    } catch (err) { setStatus(t("shared.roleUpdateFailed", { error: String(err) })); }
  }, [activeSpaceId, setStatus]);

  const handleSaveSettings = useCallback(async () => {
    if (!activeSpace || !activeSpaceId) return;
    const updatedAt = asString(activeSpace.updated_date, asString(activeSpace.created_date, ""));
    try {
      await safeEntityUpdate("Space", activeSpaceId, { name: editName.trim(), description: editDesc.trim() }, updatedAt);
      setStatus(t("settings.saved"));
      await refreshSharedFromRemote();
    } catch (err) { setStatus(t("shared.deleteFailed", { error: String(err) })); }
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
    } catch (err) { setStatus(t("shared.deleteFailed", { error: String(err) })); }
  }, [setStatus]);

  const handleUpload = useCallback(async () => {
    if (!activeSpaceId) return;
    try { await uploadSelectedFilesToSpace(activeSpaceId); await refreshSharedFromRemote(); }
    catch (err) { setStatus(String(err)); }
  }, [activeSpaceId, setStatus]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!activeSpaceId || !e.dataTransfer.files.length) return;
    try { await uploadSelectedFilesToSpace(activeSpaceId, Array.from(e.dataTransfer.files)); await refreshSharedFromRemote(); }
    catch (err) { setStatus(String(err)); }
  }, [activeSpaceId, setStatus]);

  const handleAddTask = useCallback(async () => {
    if (!newTaskTitle.trim() || !activeSpaceId) return;
    try {
      await invokeEdgeFunction("spaceTasks", { space_id: activeSpaceId, action: "create", title: newTaskTitle.trim() });
      setNewTaskTitle("");
      await fetchTasks(activeSpaceId);
    } catch { /* ignore */ }
  }, [newTaskTitle, activeSpaceId, fetchTasks]);

  const handleToggleTask = useCallback(async (taskId: string, completed: boolean) => {
    if (!activeSpaceId) return;
    try {
      await invokeEdgeFunction("spaceTasks", { space_id: activeSpaceId, action: "update", task_id: taskId, is_completed: !completed });
      await fetchTasks(activeSpaceId);
    } catch { /* ignore */ }
  }, [activeSpaceId, fetchTasks]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    if (!activeSpaceId) return;
    try {
      await invokeEdgeFunction("spaceTasks", { space_id: activeSpaceId, action: "delete", task_id: taskId });
      await fetchTasks(activeSpaceId);
    } catch { /* ignore */ }
  }, [activeSpaceId, fetchTasks]);

  const handleCopyInviteLink = useCallback(async () => {
    if (!activeSpaceId) return;
    try {
      const res = await invokeEdgeFunction<{ token?: string }>("spaceInviteLink", { space_id: activeSpaceId, action: "create", role: inviteLinkRole });
      if (res.token) { await navigator.clipboard.writeText(res.token); setStatus(t("shared.inviteLinkCopied")); }
    } catch (err) { setStatus(t("shared.inviteLinkFailed", { error: String(err) })); }
  }, [activeSpaceId, inviteLinkRole, setStatus]);

  const handleJoinSpace = useCallback(async () => {
    if (!joinCode.trim()) return;
    setJoining(true);
    try {
      await invokeEdgeFunction("spaceInviteLink", { action: "join", token: joinCode.trim() });
      setStatus(t("shared.joined"));
      setJoinCode("");
      await refreshAccessScope();
      await refreshSharedFromRemote();
    } catch (err) { setStatus(t("shared.joinFailed", { error: String(err) })); }
    finally { setJoining(false); }
  }, [joinCode, setStatus]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return allMembers.filter((m) => {
      const name = toDisplayName(m.email).toLowerCase();
      return name.includes(q) || m.email.toLowerCase().includes(q);
    }).slice(0, 5);
  }, [mentionQuery, allMembers]);

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

  const sections: { id: SectionId; label: string; icon: string }[] = useMemo(() => [
    { id: "files" as SectionId, label: tr("shared.filesTab"), icon: "\u{1F4C1}" },
    { id: "chat" as SectionId, label: tr("shared.chatTab"), icon: "\u{1F4AC}" },
    { id: "tasks" as SectionId, label: tr("shared.tasksTab"), icon: "\u2705" },
    { id: "members" as SectionId, label: tr("shared.membersTab"), icon: "\u{1F465}" },
    { id: "activity" as SectionId, label: tr("shared.activityTab"), icon: "\u{1F4CA}" },
    ...(isOwner ? [{ id: "settings" as SectionId, label: tr("shared.settingsTab"), icon: "\u2699\uFE0F" }] : []),
  ], [isOwner, tr]);

  const enterSpace = useCallback((id: string) => { setActiveSpaceId(id); setActiveSection("files"); }, []);

  const activeTasks = useMemo(() => tasks.filter((tk) => !tk.is_completed), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((tk) => tk.is_completed), [tasks]);

  const replyToMap = useMemo(() => {
    const map = new Map<string, SpaceMessage>();
    for (const msg of chatMessages) map.set(msg.id, msg);
    return map;
  }, [chatMessages]);

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

        <div className="space-join-row">
          <input type="text" placeholder={tr("shared.joinCodePlaceholder")} value={joinCode} onChange={(e) => setJoinCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleJoinSpace(); }} />
          <button type="button" onClick={handleJoinSpace} disabled={joining || !joinCode.trim()}>
            {joining ? tr("shared.joining") : tr("shared.joinSpace")}
          </button>
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
              const avatarEmails = [creator, ...members.map((m) => m.email || "")].filter(Boolean);
              const uniqueAvatars = [...new Set(avatarEmails)].slice(0, 5);
              return (
                <div key={id} className="space-card" onClick={() => enterSpace(id)}>
                  <div className="space-card-header">
                    <h3 className="space-card-name">{name}</h3>
                    <button type="button" className="space-card-menu-btn" onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === id ? null : id); }}>&#x22EE;</button>
                    {menuOpenId === id && (
                      <div className="space-card-menu">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDeleteSpaceId(id); setMenuOpenId(null); }}>{tr("shared.deleteSpace")}</button>
                      </div>
                    )}
                  </div>
                  {desc && <p className="space-card-desc">{desc}</p>}
                  <div className="space-card-footer">
                    <div className="space-card-avatars">
                      {uniqueAvatars.map((email) => {
                        const display = toDisplayName(email);
                        return (<div key={email} className="space-avatar" style={{ background: avatarColor(display) }}>{initials(display)}</div>);
                      })}
                    </div>
                    <span className="space-card-count">{tr("shared.items", { count: itemCount })}</span>
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
                <h3>{tr("shared.deleteSpace")}</h3>
                <button type="button" onClick={() => setConfirmDeleteSpaceId(null)}>&times;</button>
              </div>
              <div className="form" style={{ padding: "0 16px 16px" }}>
                <p>{tr("shared.deleteConfirm")}</p>
                <div className="actions-row">
                  <button type="button" className="ghost" onClick={() => setConfirmDeleteSpaceId(null)}>{tr("shared.cancel")}</button>
                  <button type="button" style={{ background: "#ef4444" }} onClick={() => handleDeleteSpace(confirmDeleteSpaceId)}>{tr("shared.deleteSpace")}</button>
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
                <h3>{tr("shared.createTitle")}</h3>
                <button type="button" onClick={() => setCreateOpen(false)}>&times;</button>
              </div>
              <div className="form" style={{ padding: "0 16px 16px" }}>
                <label>{tr("shared.chooseTemplate")}</label>
                <div className="space-template-grid">
                  {TEMPLATES.map((tmpl) => (
                    <button key={tmpl.id} type="button" className={`space-template-card${selectedTemplate === tmpl.id ? " active" : ""}`} onClick={() => setSelectedTemplate(tmpl.id)}>
                      <span className="space-template-icon">{tmpl.icon}</span>
                      <span className="space-template-name">{tr(tmpl.nameKey)}</span>
                    </button>
                  ))}
                </div>
                <label>{tr("shared.nameLabel")}</label>
                <input type="text" placeholder={tr("shared.nameLabel")} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
                <label>{tr("shared.descLabel")}</label>
                <input type="text" placeholder={tr("shared.descLabel")} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                <div className="actions-row">
                  <button type="button" className="ghost" onClick={() => setCreateOpen(false)}>{tr("shared.cancel")}</button>
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
      <button type="button" className="space-detail-back" onClick={() => setActiveSpaceId(null)}>&#x2190; {tr("shared.backToSpaces")}</button>
      <h2 className="space-detail-name">{spaceName}</h2>
      {spaceDesc && <p className="space-detail-desc">{spaceDesc}</p>}

      <div className="space-section-tabs">
        {sections.map((s) => (
          <button key={s.id} type="button" className={activeSection === s.id ? "active" : ""} onClick={() => setActiveSection(s.id)}>
            <span style={{ marginRight: 4 }}>{s.icon}</span>{s.label}
          </button>
        ))}
      </div>

      {/* Files */}
      {activeSection === "files" && (
        <div className={`space-files-drop${dragOver ? " drag-over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
          <div className="space-files-toolbar">
            <input type="text" className="space-files-search" placeholder={tr("shared.searchPlaceholder")} value={fileSearch} onChange={(e) => setFileSearch(e.target.value)} />
            {canEdit && <button type="button" onClick={handleUpload}>{tr("shared.upload")}</button>}
          </div>
          {dragOver && <div className="space-files-drag-hint">{tr("shared.dragFiles")}</div>}
          <div className="files-items">
            {filteredFolders.length === 0 && filteredItems.length === 0 ? (
              <div className="dash-card"><p>{tr("shared.noFiles")}</p></div>
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
      )}

      {/* Chat */}
      {activeSection === "chat" && (
        <div className="space-chat">
          {pinnedMessages.length > 0 && (
            <div className="space-chat-pinned">
              <span className="space-chat-pinned-label">{"\u{1F4CC}"} {tr("shared.pinnedMessages")}</span>
              {pinnedMessages.map((pm) => (
                <div key={pm.id} className="space-chat-pinned-msg">
                  <strong>{pm.sender_name || toDisplayName(pm.sender_email)}</strong>: {pm.message.slice(0, 80)}{pm.message.length > 80 ? "..." : ""}
                  {(isOwner || canEdit) && <button type="button" className="space-chat-pin-btn" onClick={() => handlePinMessage(pm.id)}>{tr("shared.unpinMessage")}</button>}
                </div>
              ))}
            </div>
          )}
          <div className="space-chat-messages">
            {chatLoading && <p style={{ color: "var(--muted)", fontSize: 13 }}>{tr("shared.chatLoading")}</p>}
            {!chatLoading && chatMessages.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", marginTop: 40 }}>{tr("shared.noMessages")}</p>}
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
                      <button type="button" onClick={() => setReplyTo(msg)}>{tr("shared.reply")}</button>
                      {(isOwner || canEdit) && <button type="button" onClick={() => handlePinMessage(msg.id)}>{msg.is_pinned ? tr("shared.unpinMessage") : tr("shared.pinMessage")}</button>}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
          {replyTo && (
            <div className="space-chat-reply-bar">
              <span>{tr("shared.replyingTo", { name: replyTo.sender_name || toDisplayName(replyTo.sender_email) })}</span>
              <button type="button" onClick={() => setReplyTo(null)}>{tr("shared.cancelReply")}</button>
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
            <input ref={chatInputRef} type="text" placeholder={tr("shared.messagePlaceholder")} value={chatInput}
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
            <button type="button" onClick={handleSendMessage} disabled={chatSending || !chatInput.trim()}>{tr("shared.sendMessage")}</button>
          </div>
        </div>
      )}

      {/* Tasks */}
      {activeSection === "tasks" && (
        <div className="space-tasks">
          {canEdit && (
            <div className="space-tasks-add">
              <input type="text" placeholder={tr("shared.addTask")} value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleAddTask(); }} />
              <button type="button" onClick={handleAddTask} disabled={!newTaskTitle.trim()}>+</button>
            </div>
          )}
          {tasksLoading && <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading...</p>}
          {!tasksLoading && activeTasks.length === 0 && completedTasks.length === 0 && <div className="dash-card"><p>{tr("shared.noTasks")}</p></div>}
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
                {tr("shared.completedTasks")} ({completedTasks.length}) {showCompleted ? "\u25BE" : "\u25B8"}
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
      )}

      {/* Members */}
      {activeSection === "members" && (
        <div>
          {isOwner && (
            <div className="space-members-toolbar">
              <button type="button" onClick={() => setInviteOpen(true)}>{tr("shared.inviteMember")}</button>
              <div className="space-invite-link-row">
                <select value={inviteLinkRole} onChange={(e) => setInviteLinkRole(e.target.value as "editor" | "viewer")}>
                  <option value="viewer">{tr("shared.roleViewer")}</option>
                  <option value="editor">{tr("shared.roleEditor")}</option>
                </select>
                <button type="button" onClick={handleCopyInviteLink}>{tr("shared.copyInviteLink")}</button>
              </div>
            </div>
          )}
          <div className="space-member-list">
            {allMembers.map((m) => {
              const display = toDisplayName(m.email);
              const roleKey = m.role === "owner" ? "shared.owner" : m.role === "editor" ? "shared.editor" : "shared.viewer";
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
                      <option value="editor">{tr("shared.editor")}</option>
                      <option value="viewer">{tr("shared.viewer")}</option>
                    </select>
                  ) : (
                    <span className={`space-member-role ${roleClass}`}>{tr(roleKey)}</span>
                  )}
                  {isOwner && m.role !== "owner" && (
                    confirmRemoveEmail === m.email ? (
                      <div className="confirm-inline">
                        <span>{tr("shared.removeConfirm", { email: m.email })}</span>
                        <button type="button" className="confirm-yes" onClick={() => handleRemoveMember(m.email)}>{tr("delete.submit")}</button>
                        <button type="button" className="confirm-no" onClick={() => setConfirmRemoveEmail(null)}>{tr("shared.cancel")}</button>
                      </div>
                    ) : (
                      <button type="button" className="space-member-remove" onClick={() => setConfirmRemoveEmail(m.email)}>{tr("shared.removeMember")}</button>
                    )
                  )}
                </div>
              );
            })}
          </div>
          {inviteOpen && (
            <div className="modal">
              <div className="modal-backdrop" onClick={() => setInviteOpen(false)} />
              <div className="modal-panel">
                <div className="modal-head"><h3>{tr("shared.inviteTitle")}</h3><button type="button" onClick={() => setInviteOpen(false)}>&times;</button></div>
                <div className="form" style={{ padding: "0 16px 16px" }}>
                  <label>{tr("email.from")}</label>
                  <input type="email" placeholder={tr("shared.emailPlaceholder")} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} autoFocus />
                  <label>{tr("shared.roleLabel")}</label>
                  <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}>
                    <option value="editor">{tr("shared.roleEditor")}</option>
                    <option value="viewer">{tr("shared.roleViewer")}</option>
                  </select>
                  <div className="actions-row">
                    <button type="button" className="ghost" onClick={() => setInviteOpen(false)}>{tr("shared.cancel")}</button>
                    <button type="button" onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>{inviting ? tr("shared.inviting") : tr("shared.sendInvite")}</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Activity */}
      {activeSection === "activity" && (
        <div className="space-activity">
          {activityLoading && <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading...</p>}
          {!activityLoading && activities.length === 0 && <div className="dash-card"><p>{tr("shared.noActivity")}</p></div>}
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
      )}

      {/* Settings */}
      {activeSection === "settings" && isOwner && (
        <div>
          <div className="space-settings-form">
            <label>{tr("shared.nameLabel")}</label>
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
            <label>{tr("shared.descLabel")}</label>
            <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            <div className="space-settings-actions">
              <button type="button" onClick={handleSaveSettings} disabled={!editName.trim()}>{tr("shared.saveSettings")}</button>
              <button type="button" className="ghost" style={{ color: "#f87171" }} onClick={() => openDeleteModal({ kind: "item", id: activeSpaceId!, entity: "Space" })}>{tr("shared.deleteSpace")}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
