import { useState, useMemo, useCallback } from "react";
import { useT } from "../../../i18n";
import { toDisplayName } from "../../../services/helpers";
import { invokeEdgeFunction } from "../../../api";
import { avatarColor, initials } from "./workspaceHelpers";
import type { SpaceTask } from "./workspaceTypes";

interface WorkspaceTasksPanelProps {
  spaceId: string;
  tasks: SpaceTask[];
  loading: boolean;
  canEdit: boolean;
  allMembers: { email: string; role: string }[];
  onAdd: (title: string) => Promise<void>;
  onToggle: (taskId: string, completed: boolean) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
}

export default function WorkspaceTasksPanel({
  spaceId,
  tasks,
  loading,
  canEdit,
  allMembers,
  onAdd,
  onToggle,
  onDelete,
}: WorkspaceTasksPanelProps) {
  const tr = useT();

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  const activeTasks = useMemo(() => tasks.filter((t) => !t.is_completed), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((t) => t.is_completed), [tasks]);

  const handleAdd = useCallback(async () => {
    if (!newTaskTitle.trim()) return;
    await onAdd(newTaskTitle.trim());
    setNewTaskTitle("");
  }, [newTaskTitle, onAdd]);

  const handleRequestFile = useCallback(() => {
    setNewTaskTitle("Request: ");
  }, []);

  const handleAssigneeChange = useCallback(
    async (taskId: string, email: string) => {
      try {
        await invokeEdgeFunction("spaceTasks", {
          space_id: spaceId,
          action: "update",
          task_id: taskId,
          assigned_to: email,
        });
      } catch {
        /* ignore */
      }
    },
    [spaceId],
  );

  const handleDueDateChange = useCallback(
    async (taskId: string, dueDate: string) => {
      try {
        await invokeEdgeFunction("spaceTasks", {
          space_id: spaceId,
          action: "update",
          task_id: taskId,
          due_date: dueDate,
        });
      } catch {
        /* ignore */
      }
    },
    [spaceId],
  );

  return (
    <div className="space-tasks">
      {/* Toolbar */}
      {canEdit && (
        <div className="space-tasks-add" style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder={tr("workspaces.addTask")}
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            style={{ flex: 1 }}
          />
          <button type="button" onClick={handleAdd} disabled={!newTaskTitle.trim()}>
            +
          </button>
          <button type="button" className="ghost" onClick={handleRequestFile}>
            {tr("workspaces.requestFile")}
          </button>
        </div>
      )}

      {loading && (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>{tr("workspaces.loading")}</p>
      )}

      {!loading && activeTasks.length === 0 && completedTasks.length === 0 && (
        <div className="dash-card">
          <p>{tr("workspaces.noTasks")}</p>
        </div>
      )}

      {/* Active Tasks */}
      <div className="space-tasks-list">
        {activeTasks.map((task) => (
          <div key={task.id} className="space-task-row">
            <button
              type="button"
              className="space-task-check"
              onClick={() => onToggle(task.id, task.is_completed)}
            >
              {"\u25CB"}
            </button>
            <div className="space-task-body" style={{ flex: 1, minWidth: 0 }}>
              <p className="space-task-title">{task.title}</p>
              <div className="space-task-meta" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {task.assigned_to && !canEdit && (
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
                {canEdit && (
                  <select
                    value={task.assigned_to || ""}
                    onChange={(e) => handleAssigneeChange(task.id, e.target.value)}
                    style={{ fontSize: 12, padding: "2px 4px" }}
                    title={tr("workspaces.assignee")}
                  >
                    <option value="">{tr("workspaces.unassigned")}</option>
                    {allMembers.map((m) => (
                      <option key={m.email} value={m.email}>
                        {toDisplayName(m.email)}
                      </option>
                    ))}
                  </select>
                )}
                {canEdit ? (
                  <input
                    type="date"
                    value={task.due_date || ""}
                    onChange={(e) => handleDueDateChange(task.id, e.target.value)}
                    style={{ fontSize: 12, padding: "2px 4px" }}
                    title={tr("workspaces.dueDate")}
                  />
                ) : (
                  task.due_date && <span className="space-task-due">{task.due_date}</span>
                )}
              </div>
            </div>
            {canEdit && (
              <button
                type="button"
                className="space-task-delete"
                onClick={() => onDelete(task.id)}
              >
                {"\u00D7"}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <>
          <button
            type="button"
            className="space-tasks-toggle"
            onClick={() => setShowCompleted(!showCompleted)}
          >
            {tr("workspaces.completedTasks")} ({completedTasks.length}){" "}
            {showCompleted ? "\u25BE" : "\u25B8"}
          </button>
          {showCompleted && (
            <div className="space-tasks-list completed">
              {completedTasks.map((task) => (
                <div key={task.id} className="space-task-row completed">
                  <button
                    type="button"
                    className="space-task-check done"
                    onClick={() => onToggle(task.id, task.is_completed)}
                  >
                    {"\u2713"}
                  </button>
                  <div className="space-task-body">
                    <p className="space-task-title">{task.title}</p>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      className="space-task-delete"
                      onClick={() => onDelete(task.id)}
                    >
                      {"\u00D7"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
