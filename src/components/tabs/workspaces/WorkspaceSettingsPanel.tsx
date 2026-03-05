import { useState, useEffect, useCallback } from "react";
import { useT } from "../../../i18n";
import type { DesktopFolder } from "../../../services/helpers";

interface WorkspaceSettings {
  defaultInboxFolder: string;
  namingConvention: string;
  autoTagSuggestions: boolean;
}

const SETTINGS_PREFIX = "ev.ws.settings.";

function loadWorkspaceSettings(spaceId: string): WorkspaceSettings {
  const key = SETTINGS_PREFIX + spaceId;
  const raw = localStorage.getItem(key);
  if (!raw) return { defaultInboxFolder: "", namingConvention: "", autoTagSuggestions: false };
  try {
    return JSON.parse(raw) as WorkspaceSettings;
  } catch {
    return { defaultInboxFolder: "", namingConvention: "", autoTagSuggestions: false };
  }
}

function saveWorkspaceSettings(spaceId: string, settings: WorkspaceSettings): void {
  const key = SETTINGS_PREFIX + spaceId;
  localStorage.setItem(key, JSON.stringify(settings));
}

interface WorkspaceSettingsPanelProps {
  spaceId: string;
  spaceFolders: DesktopFolder[];
  editName: string;
  editDesc: string;
  onEditName: (v: string) => void;
  onEditDesc: (v: string) => void;
  onSave: () => void;
  onDelete: () => void;
}

export default function WorkspaceSettingsPanel({
  spaceId,
  spaceFolders,
  editName,
  editDesc,
  onEditName,
  onEditDesc,
  onSave,
  onDelete,
}: WorkspaceSettingsPanelProps) {
  const tr = useT();

  const [wsSettings, setWsSettings] = useState<WorkspaceSettings>(() =>
    loadWorkspaceSettings(spaceId),
  );

  useEffect(() => {
    setWsSettings(loadWorkspaceSettings(spaceId));
  }, [spaceId]);

  const updateSetting = useCallback(
    <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
      setWsSettings((prev) => {
        const next = { ...prev, [key]: value };
        saveWorkspaceSettings(spaceId, next);
        return next;
      });
    },
    [spaceId],
  );

  return (
    <div>
      {/* Space Name / Description */}
      <div className="space-settings-form">
        <label>{tr("workspaces.nameLabel")}</label>
        <input type="text" value={editName} onChange={(e) => onEditName(e.target.value)} />

        <label>{tr("workspaces.descLabel")}</label>
        <textarea value={editDesc} onChange={(e) => onEditDesc(e.target.value)} />

        <div className="space-settings-actions">
          <button type="button" onClick={onSave} disabled={!editName.trim()}>
            {tr("workspaces.saveSettings")}
          </button>
          <button
            type="button"
            className="ghost"
            style={{ color: "#f87171" }}
            onClick={onDelete}
          >
            {tr("workspaces.deleteWorkspace")}
          </button>
        </div>
      </div>

      {/* Workspace-Specific Settings */}
      <div
        className="space-settings-form"
        style={{ marginTop: 24, borderTop: "1px solid var(--border)", paddingTop: 16 }}
      >
        <h4 style={{ margin: "0 0 12px" }}>{tr("workspaces.workspaceSettings")}</h4>

        {/* Default Inbox Folder */}
        <label>{tr("workspaces.defaultInboxFolder")}</label>
        <select
          value={wsSettings.defaultInboxFolder}
          onChange={(e) => updateSetting("defaultInboxFolder", e.target.value)}
        >
          <option value="">{tr("workspaces.noDefault")}</option>
          {spaceFolders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>

        {/* Naming Convention */}
        <label>{tr("workspaces.namingConvention")}</label>
        <input
          type="text"
          placeholder={tr("workspaces.namingConventionPlaceholder")}
          value={wsSettings.namingConvention}
          onChange={(e) => updateSetting("namingConvention", e.target.value)}
        />

        {/* Auto-Tag Suggestions */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            marginTop: 8,
          }}
        >
          <input
            type="checkbox"
            checked={wsSettings.autoTagSuggestions}
            onChange={(e) => updateSetting("autoTagSuggestions", e.target.checked)}
          />
          {tr("workspaces.autoTagSuggestions")}
        </label>
      </div>
    </div>
  );
}
