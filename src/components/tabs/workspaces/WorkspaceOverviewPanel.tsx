import { useT } from "../../../i18n";
import { useUiStore } from "../../../stores/uiStore";
import { toDisplayName, type DesktopItem } from "../../../services/helpers";
import { avatarColor, initials, formatActivityTime } from "./workspaceHelpers";
import type { SpaceTask, ActivityEntry, SectionId } from "./workspaceTypes";

interface WorkspaceOverviewPanelProps {
  spaceId: string;
  spaceItems: DesktopItem[];
  tasks: SpaceTask[];
  activities: ActivityEntry[];
  onUpload: () => void;
  onInvite: () => void;
  onNavigate: (section: SectionId) => void;
}

export default function WorkspaceOverviewPanel({
  spaceItems,
  tasks,
  activities,
  onUpload,
  onInvite,
  onNavigate,
}: WorkspaceOverviewPanelProps) {
  const tr = useT();
  const setFileActionTargetId = useUiStore((s) => s.setFileActionTargetId);

  const recentActivities = activities.slice(0, 5);
  const pinnedFiles = spaceItems.filter((i) => i.isPinned);
  const upcomingTasks = tasks.filter((t) => !t.is_completed).slice(0, 5);

  return (
    <div className="ws-overview-grid">
      {/* Recent Activity */}
      <div className="ws-overview-section">
        <h4>{tr("workspaces.recentActivity")}</h4>
        {recentActivities.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>{tr("workspaces.noActivity")}</p>
        ) : (
          <div className="space-activity-list">
            {recentActivities.map((a) => {
              const actor = toDisplayName(a.actor_email || "");
              return (
                <div key={a.id} className="space-activity-row">
                  <div
                    className="space-avatar"
                    style={{
                      background: avatarColor(actor),
                      width: 28,
                      height: 28,
                      fontSize: 11,
                      marginLeft: 0,
                    }}
                  >
                    {initials(actor)}
                  </div>
                  <div className="space-activity-body">
                    <p className="space-activity-text">
                      <strong>{actor}</strong> {a.action}
                      {a.details ? ` \u2014 ${a.details}` : ""}
                    </p>
                    <span className="space-activity-time">
                      {formatActivityTime(a.created_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {activities.length > 5 && (
          <button
            type="button"
            className="ghost"
            style={{ fontSize: 12, marginTop: 4 }}
            onClick={() => onNavigate("activity")}
          >
            {tr("workspaces.viewAll")}
          </button>
        )}
      </div>

      {/* Pinned Files */}
      <div className="ws-overview-section">
        <h4>{tr("workspaces.pinnedFiles")}</h4>
        {pinnedFiles.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>{tr("workspaces.noPinnedFiles")}</p>
        ) : (
          <div className="files-items">
            {pinnedFiles.map((item) => (
              <article
                key={item.id}
                className="file-row group"
                style={{ cursor: "pointer" }}
                onClick={() => setFileActionTargetId(item.id)}
              >
                <div className="file-row-icon">
                  {item.itemType === "note"
                    ? "\u{1F4DD}"
                    : item.itemType === "link"
                      ? "\u{1F517}"
                      : "\u{1F4CE}"}
                </div>
                <div className="file-row-body">
                  <p className="file-row-title">{item.title}</p>
                  <p className="file-row-sub">{item.itemType}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Upcoming Tasks */}
      <div className="ws-overview-section">
        <h4>{tr("workspaces.upcomingTasks")}</h4>
        {upcomingTasks.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>{tr("workspaces.noTasks")}</p>
        ) : (
          <div className="space-tasks-list">
            {upcomingTasks.map((task) => (
              <div key={task.id} className="space-task-row">
                <div className="space-task-body">
                  <p className="space-task-title">{task.title}</p>
                  <div className="space-task-meta">
                    {task.assigned_to && (
                      <span className="space-task-assignee">
                        <div
                          className="space-avatar"
                          style={{
                            background: avatarColor(toDisplayName(task.assigned_to)),
                            width: 18,
                            height: 18,
                            fontSize: 8,
                            marginLeft: 0,
                          }}
                        >
                          {initials(toDisplayName(task.assigned_to))}
                        </div>
                        {toDisplayName(task.assigned_to)}
                      </span>
                    )}
                    {task.due_date && (
                      <span className="space-task-due">{task.due_date}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {tasks.filter((t) => !t.is_completed).length > 5 && (
          <button
            type="button"
            className="ghost"
            style={{ fontSize: 12, marginTop: 4 }}
            onClick={() => onNavigate("tasks")}
          >
            {tr("workspaces.viewAll")}
          </button>
        )}
      </div>

      {/* Quick Actions */}
      <div className="ws-quick-actions">
        <button type="button" onClick={onUpload}>
          {tr("workspaces.upload")}
        </button>
        <button type="button" onClick={() => onNavigate("tasks")}>
          {tr("workspaces.newTask")}
        </button>
        <button type="button" onClick={onInvite}>
          {tr("workspaces.invite")}
        </button>
      </div>
    </div>
  );
}
