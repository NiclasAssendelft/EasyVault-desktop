import { useState, useMemo, useCallback, useRef } from "react";
import { useT } from "../../../i18n";
import { useUiStore } from "../../../stores/uiStore";
import { toDisplayName, type DesktopItem } from "../../../services/helpers";
import { avatarColor, initials, formatChatTime, currentUserEmail } from "./workspaceHelpers";
import type { SpaceMessage } from "./workspaceTypes";

interface WorkspaceChatPanelProps {
  spaceId: string;
  messages: SpaceMessage[];
  loading: boolean;
  isOwner: boolean;
  canEdit: boolean;
  allMembers: { email: string; role: string }[];
  spaceItems: DesktopItem[];
  onSend: (text: string, replyToId?: string, mentions?: string[]) => Promise<void>;
  onPin: (msgId: string) => Promise<void>;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}

const FILE_LINK_REGEX = /\[([^\]]+)\]\(([0-9a-f-]{36})\)/g;

function renderMessageText(
  text: string,
  onFileClick: (id: string) => void,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(FILE_LINK_REGEX.source, "g");

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const linkText = match[1];
    const fileId = match[2];
    parts.push(
      <span
        key={`${fileId}-${match.index}`}
        className="ws-chat-file-link"
        style={{
          color: "var(--accent)",
          cursor: "pointer",
          textDecoration: "underline",
          fontWeight: 500,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onFileClick(fileId);
        }}
      >
        {"\u{1F4CE}"} {linkText}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

export default function WorkspaceChatPanel({
  messages,
  loading,
  isOwner,
  canEdit,
  allMembers,
  spaceItems,
  onSend,
  onPin,
  chatEndRef,
}: WorkspaceChatPanelProps) {
  const tr = useT();
  const setFileActionTargetId = useUiStore((s) => s.setFileActionTargetId);

  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<SpaceMessage | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [showDecisionsOnly, setShowDecisionsOnly] = useState(false);
  const [decisions, setDecisions] = useState<Set<string>>(new Set());
  const [attachOpen, setAttachOpen] = useState(false);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const me = currentUserEmail();

  const pinnedMessages = useMemo(() => messages.filter((m) => m.is_pinned), [messages]);

  const replyToMap = useMemo(() => {
    const map = new Map<string, SpaceMessage>();
    for (const msg of messages) map.set(msg.id, msg);
    return map;
  }, [messages]);

  const displayedMessages = useMemo(() => {
    if (!showDecisionsOnly) return messages;
    return messages.filter((m) => decisions.has(m.id));
  }, [messages, showDecisionsOnly, decisions]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return allMembers
      .filter((m) => {
        const name = toDisplayName(m.email).toLowerCase();
        return name.includes(q) || m.email.toLowerCase().includes(q);
      })
      .slice(0, 5);
  }, [mentionQuery, allMembers]);

  const handleChatInputChange = useCallback((val: string) => {
    setChatInput(val);
    const lastAt = val.lastIndexOf("@");
    if (lastAt >= 0) {
      const after = val.slice(lastAt + 1);
      if (!after.includes(" ") && after.length <= 30) {
        setMentionQuery(after);
        setMentionIndex(0);
        return;
      }
    }
    setMentionQuery(null);
  }, []);

  const insertMention = useCallback(
    (email: string) => {
      const lastAt = chatInput.lastIndexOf("@");
      if (lastAt >= 0) setChatInput(chatInput.slice(0, lastAt) + "@" + toDisplayName(email) + " ");
      setMentionQuery(null);
      chatInputRef.current?.focus();
    },
    [chatInput],
  );

  const handleSend = useCallback(async () => {
    if (!chatInput.trim()) return;
    setSending(true);
    try {
      const mentionMatches = chatInput.match(/@(\S+)/g);
      const mentions = mentionMatches ? mentionMatches.map((m) => m.slice(1).toLowerCase()) : undefined;
      await onSend(chatInput.trim(), replyTo?.id, mentions);
      setChatInput("");
      setReplyTo(null);
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  }, [chatInput, replyTo, onSend]);

  const toggleDecision = useCallback((msgId: string) => {
    setDecisions((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  }, []);

  const handleAttachFile = useCallback(
    (item: DesktopItem) => {
      const linkText = `[${item.title}](${item.id})`;
      setChatInput((prev) => (prev ? prev + " " + linkText : linkText));
      setAttachOpen(false);
      chatInputRef.current?.focus();
    },
    [],
  );

  // suppress unused var — me is used in display name context
  void me;

  return (
    <div className="space-chat">
      {/* Decisions Toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showDecisionsOnly}
            onChange={(e) => setShowDecisionsOnly(e.target.checked)}
          />
          {tr("workspaces.decisionsOnly")}
        </label>
      </div>

      {/* Pinned Messages Bar */}
      {pinnedMessages.length > 0 && (
        <div className="space-chat-pinned">
          <span className="space-chat-pinned-label">
            {"\u{1F4CC}"} {tr("workspaces.pinnedMessages")}
          </span>
          {pinnedMessages.map((pm) => (
            <div key={pm.id} className="space-chat-pinned-msg">
              <strong>{pm.sender_name || toDisplayName(pm.sender_email)}</strong>:{" "}
              {pm.message.slice(0, 80)}
              {pm.message.length > 80 ? "..." : ""}
              {(isOwner || canEdit) && (
                <button
                  type="button"
                  className="space-chat-pin-btn"
                  onClick={() => onPin(pm.id)}
                >
                  {tr("workspaces.unpinMessage")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="space-chat-messages">
        {loading && (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>{tr("workspaces.chatLoading")}</p>
        )}
        {!loading && messages.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", marginTop: 40 }}>
            {tr("workspaces.noMessages")}
          </p>
        )}
        {displayedMessages.map((msg) => {
          const senderDisplay = msg.sender_name || toDisplayName(msg.sender_email);
          const replyParent = msg.reply_to_id ? replyToMap.get(msg.reply_to_id) : null;
          const isDecision = decisions.has(msg.id);

          return (
            <div key={msg.id} className={`space-chat-msg${msg.is_pinned ? " pinned" : ""}${isDecision ? " ws-decision" : ""}`}>
              <div
                className="space-chat-msg-avatar"
                style={{ background: avatarColor(senderDisplay) }}
              >
                {initials(senderDisplay)}
              </div>
              <div className="space-chat-msg-body">
                <span className="space-chat-msg-sender">
                  {senderDisplay}
                  <span className="space-chat-msg-time">{formatChatTime(msg.created_at)}</span>
                </span>
                {replyParent && (
                  <div className="space-chat-reply-ref">
                    {"\u21A9"}{" "}
                    {replyParent.sender_name || toDisplayName(replyParent.sender_email)}:{" "}
                    {replyParent.message.slice(0, 60)}
                  </div>
                )}
                <p className="space-chat-msg-text">
                  {renderMessageText(msg.message, setFileActionTargetId)}
                </p>
                <div className="space-chat-msg-actions">
                  <button type="button" onClick={() => setReplyTo(msg)}>
                    {tr("workspaces.reply")}
                  </button>
                  {(isOwner || canEdit) && (
                    <button type="button" onClick={() => onPin(msg.id)}>
                      {msg.is_pinned
                        ? tr("workspaces.unpinMessage")
                        : tr("workspaces.pinMessage")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleDecision(msg.id)}
                    title={tr("workspaces.toggleDecision")}
                    style={{ opacity: isDecision ? 1 : 0.5 }}
                  >
                    {isDecision ? "\u2605" : "\u2606"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Reply Bar */}
      {replyTo && (
        <div className="space-chat-reply-bar">
          <span>
            {tr("workspaces.replyingTo", {
              name: replyTo.sender_name || toDisplayName(replyTo.sender_email),
            })}
          </span>
          <button type="button" onClick={() => setReplyTo(null)}>
            {tr("workspaces.cancelReply")}
          </button>
        </div>
      )}

      {/* Input Row */}
      <div className="space-chat-input-row" style={{ position: "relative" }}>
        {/* Mention Autocomplete */}
        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <div className="space-chat-mention-popup">
            {mentionCandidates.map((m, i) => (
              <button
                key={m.email}
                type="button"
                className={i === mentionIndex ? "active" : ""}
                onClick={() => insertMention(m.email)}
              >
                <div
                  className="space-avatar"
                  style={{
                    background: avatarColor(toDisplayName(m.email)),
                    width: 22,
                    height: 22,
                    fontSize: 10,
                    marginLeft: 0,
                  }}
                >
                  {initials(toDisplayName(m.email))}
                </div>
                {toDisplayName(m.email)}
              </button>
            ))}
          </div>
        )}

        {/* File Attach Popover */}
        {attachOpen && (
          <div
            className="space-chat-mention-popup"
            style={{ maxHeight: 200, overflowY: "auto" }}
          >
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 8px", textTransform: "uppercase" }}>
              {tr("workspaces.attachFile")}
            </p>
            {spaceItems.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--muted)", padding: "4px 8px" }}>
                {tr("workspaces.noFiles")}
              </p>
            ) : (
              spaceItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleAttachFile(item)}
                  style={{ display: "flex", gap: 6, alignItems: "center" }}
                >
                  {"\u{1F4CE}"} {item.title}
                </button>
              ))
            )}
          </div>
        )}

        <button
          type="button"
          className="ghost"
          onClick={() => setAttachOpen(!attachOpen)}
          title={tr("workspaces.attachFile")}
          style={{ padding: "4px 8px", fontSize: 16 }}
        >
          {"\u{1F4CE}"}
        </button>

        <input
          ref={chatInputRef}
          type="text"
          placeholder={tr("workspaces.messagePlaceholder")}
          value={chatInput}
          onChange={(e) => handleChatInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (mentionQuery !== null && mentionCandidates.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => Math.min(i + 1, mentionCandidates.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === "Tab" || e.key === "Enter") {
                e.preventDefault();
                insertMention(mentionCandidates[mentionIndex].email);
                return;
              }
              if (e.key === "Escape") {
                setMentionQuery(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          style={{ flex: 1 }}
        />
        <button type="button" onClick={handleSend} disabled={sending || !chatInput.trim()}>
          {tr("workspaces.sendMessage")}
        </button>
      </div>
    </div>
  );
}
