import { useState, useCallback, useMemo } from "react";
import { useAuthStore } from "../../stores/authStore";
import { useFilesStore } from "../../stores/filesStore";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useSyncStore } from "../../stores/syncStore";
import { useUiStore } from "../../stores/uiStore";
import { toDisplayName } from "../../services/helpers";
import {
  getApiKey, getExtensionToken, getSavedEmail, getWatchEnabled, getWatchFolder,
  getOnlyofficeJwtSecret, getOnlyofficeServerUrl, saveSettings,
  setWatchEnabled, setWatchFolder, setOnlyofficeJwtSecret, setOnlyofficeServerUrl,
  getEmailSyncCount, setEmailSyncCount,
} from "../../storage";
import { canUseRemoteData } from "../../services/entityService";
import { refreshAllRemoteData, refreshEntitySchemas } from "../../services/deltaSyncService";
import { useT, t } from "../../i18n";

export default function SettingsTab() {
  const email = useAuthStore((s) => s.email);
  const setStatus = useUiStore((s) => s.setStatus);
  const tr = useT();

  const [apiKey, setApiKey] = useState(() => getApiKey());
  const [extensionToken, setExtensionToken] = useState(() => getExtensionToken() || "");
  const [watchPath, setWatchPath] = useState(() => getWatchFolder());
  const [watchOn, setWatchOn] = useState(() => getWatchEnabled());
  const [onlyofficeJwt, setOnlyofficeJwt] = useState(() => getOnlyofficeJwtSecret());
  const [onlyofficeServerUrl, setOnlyofficeServerUrlState] = useState(() => getOnlyofficeServerUrl());
  const [emailSyncCountVal, setEmailSyncCountVal] = useState(() => getEmailSyncCount());
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
      setEmailSyncCount(emailSyncCountVal);
      setStatus(t("settings.saved"));
    },
    [apiKey, extensionToken, watchPath, watchOn, onlyofficeJwt, onlyofficeServerUrl, emailSyncCountVal, setStatus],
  );

  const buildReport = useCallback(() => {
    const filesStore = useFilesStore.getState();
    const remoteData = useRemoteDataStore.getState();
    const sync = useSyncStore.getState();
    const auth = useAuthStore.getState();

    const lines: string[] = [];
    lines.push(t("settings.reportHeader"));
    lines.push("");
    lines.push(t("settings.loggedIn", { value: String(auth.isLoggedIn) }));
    lines.push(t("settings.emailLabel", { value: auth.email || "-" }));
    lines.push(t("settings.personalSpace", { value: auth.personalSpaceId || "-" }));
    lines.push(t("settings.accessibleSpaces", { value: auth.accessibleSpaceIds.length > 0 ? auth.accessibleSpaceIds.join(", ") : t("settings.none") }));
    lines.push(t("settings.canUseRemote", { value: String(canUseRemoteData()) }));
    lines.push("");
    lines.push(t("settings.entityCounts"));
    lines.push(t("settings.foldersCount", { count: filesStore.folders.length }));
    lines.push(t("settings.itemsCount", { count: filesStore.items.length }));
    lines.push(t("settings.emailsCount", { count: remoteData.emails.length }));
    lines.push(t("settings.eventsCount", { count: remoteData.events.length }));
    lines.push(t("settings.packsCount", { count: remoteData.packs.length }));
    lines.push(t("settings.spacesCount", { count: remoteData.spaces.length }));
    lines.push(t("settings.dropzoneCount", { count: remoteData.dropzoneItems.length }));
    lines.push("");
    lines.push(t("settings.schemaInfo"));
    lines.push(t("settings.schemaVersion", { value: sync.schemaVersion || "-" }));
    lines.push(t("settings.schemaLoaded", { value: sync.schemaLoadedAt || "-" }));
    lines.push(t("settings.functionCount", { count: sync.schemaFunctionCount }));
    lines.push(t("settings.lastDelta", { value: sync.lastDeltaSyncIso || "-" }));
    lines.push("");
    lines.push(t("settings.schemaFields"));
    const entityNames = ["Folder", "VaultItem", "EmailItem", "CalendarEvent", "Space", "GatherPack"] as const;
    for (const entity of entityNames) {
      const fields = sync.schemaFieldsByEntity[entity];
      lines.push(`${entity}: ${fields ? `${fields.size} fields [${Array.from(fields).join(", ")}]` : t("settings.notLoaded")}`);
    }
    lines.push("");
    lines.push(t("settings.unsupportedFields"));
    for (const entity of entityNames) {
      const blocked = sync.unsupportedFieldsByEntity[entity];
      lines.push(`${entity}: ${blocked.size > 0 ? Array.from(blocked).join(", ") : t("settings.none")}`);
    }

    return lines.join("\n");
  }, []);

  const handleRefreshReport = useCallback(() => { setReport(buildReport()); }, [buildReport]);

  const handleCopyReport = useCallback(() => {
    const text = report || buildReport();
    void navigator.clipboard.writeText(text).then(() => { setStatus(t("settings.reportCopied")); });
  }, [report, buildReport, setStatus]);

  const handleHealthCheck = useCallback(async () => {
    setHealthStatus(t("settings.checking"));
    try {
      await refreshEntitySchemas();
      await refreshAllRemoteData();
      setHealthStatus(t("settings.healthPassed"));
      setReport(buildReport());
    } catch (err) {
      setHealthStatus(t("settings.healthFailed", { error: String(err) }));
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
          <span className="profile-badge">{tr("settings.user")}</span>
        </div>
      </div>

      <div className="dash-card">
        <h4>{tr("settings.title")}</h4>
        <form className="form" onSubmit={handleSave}>
          <label>{tr("settings.apiKeyLabel")}</label>
          <input type="text" placeholder={tr("settings.apiKeyPlaceholder")} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />

          <label>{tr("settings.extensionTokenLabel")}</label>
          <input type="text" placeholder={tr("settings.extensionTokenPlaceholder")} value={extensionToken} onChange={(e) => setExtensionToken(e.target.value)} />

          <label>{tr("settings.watchFolderLabel")}</label>
          <input type="text" placeholder={tr("settings.watchFolderPlaceholder")} value={watchPath} onChange={(e) => setWatchPath(e.target.value)} />

          <label className="inline-checkbox">
            <input type="checkbox" checked={watchOn} onChange={(e) => setWatchOn(e.target.checked)} />
            {tr("settings.watchEnable")}
          </label>

          <label>{tr("settings.emailSyncCountLabel")}</label>
          <select value={emailSyncCountVal} onChange={(e) => setEmailSyncCountVal(Number(e.target.value))}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>

          <label>{tr("settings.onlyofficeUrlLabel")}</label>
          <input type="text" placeholder={tr("settings.onlyofficeUrlPlaceholder")} value={onlyofficeServerUrl} onChange={(e) => setOnlyofficeServerUrlState(e.target.value)} />

          <label>{tr("settings.onlyofficeJwtLabel")}</label>
          <input type="password" placeholder={tr("settings.onlyofficeJwtPlaceholder")} value={onlyofficeJwt} onChange={(e) => setOnlyofficeJwt(e.target.value)} />

          <button type="submit">{tr("settings.save")}</button>
        </form>
      </div>

      <div className="dash-card">
        <h4>{tr("settings.capabilities")}</h4>
        <div className="actions-row">
          <button type="button" onClick={handleRefreshReport}>{tr("settings.refreshReport")}</button>
          <button type="button" onClick={handleCopyReport}>{tr("settings.copyReport")}</button>
          <button type="button" onClick={handleHealthCheck}>{tr("settings.healthCheck")}</button>
        </div>
        {healthStatus && <p><strong>{healthStatus}</strong></p>}
        {report && <pre className="capabilities-report">{report}</pre>}
      </div>
    </section>
  );
}
