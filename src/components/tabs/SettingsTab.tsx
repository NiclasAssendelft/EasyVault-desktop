import { useState, useCallback, useMemo } from "react";
import { useAuthStore } from "../../stores/authStore";
import { useFilesStore } from "../../stores/filesStore";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useSyncStore } from "../../stores/syncStore";
import { useUiStore } from "../../stores/uiStore";
import { toDisplayName } from "../../services/helpers";
import {
  getApiKey,
  getExtensionToken,
  getSavedEmail,
  getWatchEnabled,
  getWatchFolder,
  getOnlyofficeJwtSecret,
  getOnlyofficeServerUrl,
  saveSettings,
  setWatchEnabled,
  setWatchFolder,
  setOnlyofficeJwtSecret,
  setOnlyofficeServerUrl,
} from "../../storage";
import { canUseRemoteData } from "../../services/entityService";
import { refreshAllRemoteData, refreshEntitySchemas } from "../../services/deltaSyncService";

export default function SettingsTab() {
  const email = useAuthStore((s) => s.email);
  const setStatus = useUiStore((s) => s.setStatus);

  const [apiKey, setApiKey] = useState(() => getApiKey());
  const [extensionToken, setExtensionToken] = useState(
    () => getExtensionToken() || "",
  );
  const [watchPath, setWatchPath] = useState(() => getWatchFolder());
  const [watchOn, setWatchOn] = useState(() => getWatchEnabled());
  const [onlyofficeJwt, setOnlyofficeJwt] = useState(() => getOnlyofficeJwtSecret());
  const [onlyofficeServerUrl, setOnlyofficeServerUrlState] = useState(() => getOnlyofficeServerUrl());
  const [report, setReport] = useState("");
  const [healthStatus, setHealthStatus] = useState("");

  const displayName = useMemo(() => toDisplayName(email || getSavedEmail()), [email]);
  const displayEmail = email || getSavedEmail() || "-";
  const avatarLetter = displayName.charAt(0).toUpperCase() || "U";

  const handleSave = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      saveSettings(apiKey, extensionToken);
      setWatchEnabled(watchOn);
      setWatchFolder(watchPath);
      setOnlyofficeJwtSecret(onlyofficeJwt);
      setOnlyofficeServerUrl(onlyofficeServerUrl);
      setStatus("Settings saved");
    },
    [apiKey, extensionToken, watchPath, watchOn, onlyofficeJwt, onlyofficeServerUrl, setStatus],
  );

  const buildReport = useCallback(() => {
    const filesStore = useFilesStore.getState();
    const remoteData = useRemoteDataStore.getState();
    const sync = useSyncStore.getState();
    const auth = useAuthStore.getState();

    const lines: string[] = [];
    lines.push("=== EasyVault Desktop Capabilities Report ===");
    lines.push("");
    lines.push(`Logged in: ${auth.isLoggedIn}`);
    lines.push(`Email: ${auth.email || "-"}`);
    lines.push(`Personal space: ${auth.personalSpaceId || "-"}`);
    lines.push(
      `Accessible spaces: ${auth.accessibleSpaceIds.length > 0 ? auth.accessibleSpaceIds.join(", ") : "none"}`,
    );
    lines.push(`Can use remote data: ${canUseRemoteData()}`);
    lines.push("");
    lines.push("--- Entity counts ---");
    lines.push(`Folders: ${filesStore.folders.length}`);
    lines.push(`Items: ${filesStore.items.length}`);
    lines.push(`Emails: ${remoteData.emails.length}`);
    lines.push(`Events: ${remoteData.events.length}`);
    lines.push(`Packs: ${remoteData.packs.length}`);
    lines.push(`Spaces: ${remoteData.spaces.length}`);
    lines.push(`Dropzone items: ${remoteData.dropzoneItems.length}`);
    lines.push("");
    lines.push("--- Schema info ---");
    lines.push(`Schema version: ${sync.schemaVersion || "-"}`);
    lines.push(`Schema loaded at: ${sync.schemaLoadedAt || "-"}`);
    lines.push(`Function count: ${sync.schemaFunctionCount}`);
    lines.push(`Last delta sync: ${sync.lastDeltaSyncIso || "-"}`);
    lines.push("");
    lines.push("--- Schema fields ---");
    const entityNames = [
      "Folder",
      "VaultItem",
      "EmailItem",
      "CalendarEvent",
      "Space",
      "GatherPack",
    ] as const;
    for (const entity of entityNames) {
      const fields = sync.schemaFieldsByEntity[entity];
      lines.push(
        `${entity}: ${fields ? `${fields.size} fields [${Array.from(fields).join(", ")}]` : "not loaded"}`,
      );
    }
    lines.push("");
    lines.push("--- Unsupported fields ---");
    for (const entity of entityNames) {
      const blocked = sync.unsupportedFieldsByEntity[entity];
      lines.push(
        `${entity}: ${blocked.size > 0 ? Array.from(blocked).join(", ") : "none"}`,
      );
    }

    return lines.join("\n");
  }, []);

  const handleRefreshReport = useCallback(() => {
    setReport(buildReport());
  }, [buildReport]);

  const handleCopyReport = useCallback(() => {
    const text = report || buildReport();
    void navigator.clipboard.writeText(text).then(() => {
      setStatus("Report copied to clipboard");
    });
  }, [report, buildReport, setStatus]);

  const handleHealthCheck = useCallback(async () => {
    setHealthStatus("Checking...");
    try {
      await refreshEntitySchemas();
      await refreshAllRemoteData();
      setHealthStatus("Health check passed - all remote data refreshed");
      setReport(buildReport());
    } catch (err) {
      setHealthStatus(`Health check failed: ${String(err)}`);
    }
  }, [buildReport]);

  return (
    <section className="tab-panel">
      <div className="profile-card">
        <div className="profile-left">
          <div className="profile-avatar">{avatarLetter}</div>
          <div className="profile-meta">
            <h3 className="profile-name">{displayName}</h3>
            <p className="profile-email">{displayEmail}</p>
          </div>
        </div>
        <div className="profile-right">
          <span className="profile-badge">User</span>
        </div>
      </div>

      <div className="dash-card">
        <h4>Settings</h4>
        <form className="form" onSubmit={handleSave}>
          <label>Base44 API key</label>
          <input
            type="text"
            placeholder="api key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />

          <label>Extension token</label>
          <input
            type="text"
            placeholder="extension token"
            value={extensionToken}
            onChange={(e) => setExtensionToken(e.target.value)}
          />

          <label>Watch folder path</label>
          <input
            type="text"
            placeholder="/Users/.../Downloads/ToEasyVault"
            value={watchPath}
            onChange={(e) => setWatchPath(e.target.value)}
          />

          <label className="inline-checkbox">
            <input
              type="checkbox"
              checked={watchOn}
              onChange={(e) => setWatchOn(e.target.checked)}
            />
            Enable watched folder auto-import
          </label>

          <label>ONLYOFFICE server URL</label>
          <input
            type="text"
            placeholder="https://onlyoffice.yourdomain.com"
            value={onlyofficeServerUrl}
            onChange={(e) => setOnlyofficeServerUrlState(e.target.value)}
          />

          <label>ONLYOFFICE JWT secret</label>
          <input
            type="password"
            placeholder="Leave blank to use built-in default"
            value={onlyofficeJwt}
            onChange={(e) => setOnlyofficeJwt(e.target.value)}
          />

          <button type="submit">Save Settings</button>
        </form>
      </div>

      <div className="dash-card">
        <h4>Capabilities</h4>
        <div className="actions-row">
          <button type="button" onClick={handleRefreshReport}>
            Refresh Report
          </button>
          <button type="button" onClick={handleCopyReport}>
            Copy Report
          </button>
          <button type="button" onClick={handleHealthCheck}>
            Health Check
          </button>
        </div>
        {healthStatus && (
          <p>
            <strong>{healthStatus}</strong>
          </p>
        )}
        {report && <pre className="capabilities-report">{report}</pre>}
      </div>
    </section>
  );
}
