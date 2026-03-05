import { useState, useMemo } from "react";
import { useT } from "../../../i18n";
import { toDisplayName } from "../../../services/helpers";
import { avatarColor, initials, formatActivityTime } from "./workspaceHelpers";
import type { ActivityEntry } from "./workspaceTypes";

interface WorkspaceActivityPanelProps {
  activities: ActivityEntry[];
  loading: boolean;
}

export default function WorkspaceActivityPanel({
  activities,
  loading,
}: WorkspaceActivityPanelProps) {
  const tr = useT();

  const [filterPerson, setFilterPerson] = useState("");
  const [filterAction, setFilterAction] = useState("");

  const uniquePersons = useMemo(() => {
    const set = new Set<string>();
    for (const a of activities) {
      if (a.actor_email) set.add(a.actor_email);
    }
    return Array.from(set).sort();
  }, [activities]);

  const uniqueActions = useMemo(() => {
    const set = new Set<string>();
    for (const a of activities) {
      if (a.action) set.add(a.action);
    }
    return Array.from(set).sort();
  }, [activities]);

  const filteredActivities = useMemo(() => {
    let result = activities;
    if (filterPerson) {
      result = result.filter((a) => a.actor_email === filterPerson);
    }
    if (filterAction) {
      result = result.filter((a) => a.action === filterAction);
    }
    return result;
  }, [activities, filterPerson, filterAction]);

  return (
    <div className="space-activity">
      {/* Filter Controls */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select
          value={filterPerson}
          onChange={(e) => setFilterPerson(e.target.value)}
          style={{ fontSize: 13, padding: "4px 8px" }}
        >
          <option value="">{tr("workspaces.allMembers")}</option>
          {uniquePersons.map((email) => (
            <option key={email} value={email}>
              {toDisplayName(email)}
            </option>
          ))}
        </select>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          style={{ fontSize: 13, padding: "4px 8px" }}
        >
          <option value="">{tr("workspaces.allActions")}</option>
          {uniqueActions.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>
        {(filterPerson || filterAction) && (
          <button
            type="button"
            className="ghost"
            style={{ fontSize: 12 }}
            onClick={() => {
              setFilterPerson("");
              setFilterAction("");
            }}
          >
            {tr("workspaces.clearFilters")}
          </button>
        )}
      </div>

      {loading && (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>{tr("workspaces.loading")}</p>
      )}

      {!loading && filteredActivities.length === 0 && (
        <div className="dash-card">
          <p>{tr("workspaces.noActivity")}</p>
        </div>
      )}

      <div className="space-activity-list">
        {filteredActivities.map((a) => {
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
    </div>
  );
}
