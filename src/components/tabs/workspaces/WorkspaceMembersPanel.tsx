import { useState } from "react";
import { useT } from "../../../i18n";
import { toDisplayName } from "../../../services/helpers";
import { avatarColor, initials } from "./workspaceHelpers";

interface WorkspaceMembersPanelProps {
  spaceId: string;
  allMembers: { email: string; role: string }[];
  isOwner: boolean;
  onInvite: () => void;
  onRemove: (email: string) => void;
  onUpdateRole: (email: string, role: string) => void;
  onCopyInviteLink: () => void;
  inviteLinkRole: "editor" | "viewer";
  onSetInviteLinkRole: (role: "editor" | "viewer") => void;
}

export default function WorkspaceMembersPanel({
  allMembers,
  isOwner,
  onInvite,
  onRemove,
  onUpdateRole,
  onCopyInviteLink,
  inviteLinkRole,
  onSetInviteLinkRole,
}: WorkspaceMembersPanelProps) {
  const tr = useT();
  const [confirmRemoveEmail, setConfirmRemoveEmail] = useState<string | null>(null);

  return (
    <div>
      {/* Owner Toolbar */}
      {isOwner && (
        <div className="space-members-toolbar">
          <button type="button" onClick={onInvite}>
            {tr("workspaces.inviteMember")}
          </button>
          <div className="space-invite-link-row">
            <select
              value={inviteLinkRole}
              onChange={(e) => onSetInviteLinkRole(e.target.value as "editor" | "viewer")}
            >
              <option value="viewer">{tr("workspaces.roleViewer")}</option>
              <option value="editor">{tr("workspaces.roleEditor")}</option>
            </select>
            <button type="button" onClick={onCopyInviteLink}>
              {tr("workspaces.copyInviteLink")}
            </button>
          </div>
        </div>
      )}

      {/* Member List */}
      <div className="space-member-list">
        {allMembers.map((m) => {
          const display = toDisplayName(m.email);
          const roleKey =
            m.role === "owner"
              ? "workspaces.owner"
              : m.role === "editor"
                ? "workspaces.editor"
                : "workspaces.viewer";
          const roleClass = `role-${m.role}`;

          return (
            <div key={m.email} className="space-member-row">
              <div
                className="space-avatar"
                style={{ background: avatarColor(display), marginLeft: 0 }}
              >
                {initials(display)}
              </div>
              <div className="space-member-info">
                <p className="space-member-email">{display}</p>
                <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>{m.email}</p>
                <p style={{ fontSize: 11, color: "var(--muted)", margin: "2px 0 0" }}>
                  {tr("workspaces.joined")}
                </p>
              </div>

              {/* Role Badge / Select */}
              {isOwner && m.role !== "owner" ? (
                <select
                  className={`space-member-role-select ${roleClass}`}
                  value={m.role}
                  onChange={(e) => onUpdateRole(m.email, e.target.value)}
                >
                  <option value="editor">{tr("workspaces.editor")}</option>
                  <option value="viewer">{tr("workspaces.viewer")}</option>
                </select>
              ) : (
                <span className={`space-member-role ${roleClass}`}>{tr(roleKey)}</span>
              )}

              {/* Remove Member */}
              {isOwner &&
                m.role !== "owner" &&
                (confirmRemoveEmail === m.email ? (
                  <div className="confirm-inline">
                    <span>
                      {tr("workspaces.removeConfirm", { email: m.email })}
                    </span>
                    <button
                      type="button"
                      className="confirm-yes"
                      onClick={() => {
                        onRemove(m.email);
                        setConfirmRemoveEmail(null);
                      }}
                    >
                      {tr("workspaces.confirmRemove")}
                    </button>
                    <button
                      type="button"
                      className="confirm-no"
                      onClick={() => setConfirmRemoveEmail(null)}
                    >
                      {tr("workspaces.cancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="space-member-remove"
                    onClick={() => setConfirmRemoveEmail(m.email)}
                  >
                    {tr("workspaces.removeMember")}
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
