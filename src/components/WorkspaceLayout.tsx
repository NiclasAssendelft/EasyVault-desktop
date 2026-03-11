import { useEffect, useState, useRef, useMemo } from "react";
import { useFilesStore } from "../stores/filesStore";
import { useRemoteDataStore } from "../stores/remoteDataStore";
import { useUiStore } from "../stores/uiStore";
import {
  refreshFilesFromRemote,
  refreshEmailFromRemote,
  refreshCalendarFromRemote,
  refreshVaultFromRemote,
  refreshSharedFromRemote,
  refreshDropzoneFromRemote,
} from "../services/deltaSyncService";
import { setupOnlyofficeLocalRelay, launchOnlyofficeEditor } from "../services/onlyofficeService";
import { check } from "@tauri-apps/plugin-updater";
import { startWatchPolling, stopWatchPolling, scanWatchFolder, processQueue } from "../services/queueService";
import { invokeEdgeFunction } from "../api";
import { getEmailSyncCount } from "../storage";
import { useQueueStore } from "../stores/queueStore";
import { useDeltaSync } from "../hooks/useDeltaSync";
import { useLocaleStore, type Locale } from "../i18n";
import Sidebar from "./Sidebar";
import HomeTab from "./tabs/HomeTab";
import FilesTab from "./tabs/FilesTab";
import EmailTab from "./tabs/EmailTab";
import CalendarTab from "./tabs/CalendarTab";
import VaultTab from "./tabs/VaultTab";
import WorkspacesTab from "./tabs/workspaces/WorkspacesTab";
import DropzoneTab from "./tabs/DropzoneTab";
import LinksTab from "./tabs/LinksTab";
import SettingsTab from "./tabs/SettingsTab";
import NewModal from "./modals/NewModal";
import SaveLinkModal from "./modals/SaveLinkModal";
import ImportLinksModal from "./modals/ImportLinksModal";
import ManageModal from "./modals/ManageModal";
import DeleteModal from "./modals/DeleteModal";
import FileActionModal from "./modals/FileActionModal";
import PreviewEditModal from "./modals/PreviewEditModal";

const TAB_COMPONENTS = {
  home: HomeTab,
  files: FilesTab,
  links: LinksTab,
  email: EmailTab,
  calendar: CalendarTab,
  vault: VaultTab,
  workspaces: WorkspacesTab,
  queue: DropzoneTab,
  settings: SettingsTab,
} as const;

const TAB_REFRESH: Partial<Record<keyof typeof TAB_COMPONENTS, () => Promise<unknown>>> = {
  home: refreshCalendarFromRemote,
  files: refreshFilesFromRemote,
  links: refreshFilesFromRemote,
  email: refreshEmailFromRemote,
  calendar: refreshCalendarFromRemote,
  vault: refreshVaultFromRemote,
  workspaces: refreshSharedFromRemote,
  queue: refreshDropzoneFromRemote,
};

const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "sv", label: "Svenska" },
  { code: "fi", label: "Suomi" },
];

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const items = useFilesStore((s) => s.items);
  const emails = useRemoteDataStore((s) => s.emails);
  const spaces = useRemoteDataStore((s) => s.spaces);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: { type: string; label: string; sub: string; tab: string }[] = [];
    for (const item of items) {
      if (item.title.toLowerCase().includes(q)) {
        out.push({ type: "file", label: item.title, sub: item.itemType || "file", tab: "files" });
      }
    }
    for (const e of emails) {
      const subj = String(e.subject || "");
      const from = String(e.from_name || e.from_address || "");
      if (subj.toLowerCase().includes(q) || from.toLowerCase().includes(q)) {
        out.push({ type: "email", label: subj || "(No subject)", sub: from, tab: "email" });
      }
    }
    for (const s of spaces) {
      const name = String(s.name || "");
      if (name.toLowerCase().includes(q)) {
        out.push({ type: "space", label: name, sub: "Workspace", tab: "workspaces" });
      }
    }
    return out.slice(0, 10);
  }, [query, items, emails, spaces]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="global-search" ref={ref}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        className="global-search-input"
        placeholder="Search files, emails, workspaces…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && results.length > 0 && (
        <div className="global-search-results">
          {results.map((r, i) => (
            <button
              key={i}
              className="global-search-result"
              onClick={() => {
                setActiveTab(r.tab as Parameters<typeof setActiveTab>[0]);
                setQuery("");
                setOpen(false);
              }}
            >
              <span className="gsr-label">{r.label}</span>
              <span className="gsr-sub">{r.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LocaleDropdown({ locale, setLocale }: { locale: Locale; setLocale: (l: Locale) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="locale-dropdown" ref={ref}>
      <button type="button" className="locale-toggle" onClick={() => setOpen(!open)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <ellipse cx="12" cy="12" rx="4" ry="10" />
          <path d="M2 12h20" />
        </svg>
        <span className="locale-label">{locale.toUpperCase()}</span>
      </button>
      {open && (
        <div className="locale-menu">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              className={`locale-menu-item${l.code === locale ? " active" : ""}`}
              onClick={() => { setLocale(l.code); setOpen(false); }}
            >
              <span>{l.label}</span>
              <span className="locale-menu-code">{l.code.toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WorkspaceLayout() {
  const activeTab = useUiStore((s) => s.activeTab);

  const ActiveTabComponent = TAB_COMPONENTS[activeTab];
  const statusText = useUiStore((s) => s.statusText);
  const queueItems = useQueueStore((s) => s.items);
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  // Start delta-sync polling on mount, stop on unmount
  useDeltaSync();

  // Set up ONLYOFFICE local relay and expose JS bridge on mount
  useEffect(() => {
    void setupOnlyofficeLocalRelay();

    // Expose ONLYOFFICE launch bridge for the adapter
    (window as unknown as { EasyVaultEditors?: Record<string, unknown> }).EasyVaultEditors = {
      onlyofficeLaunch: (fileId: string) => { void launchOnlyofficeEditor(fileId); },
    };

    return () => {
      delete (window as unknown as { EasyVaultEditors?: unknown }).EasyVaultEditors;
    };
  }, []);

  // Check for app updates on startup
  useEffect(() => {
    (async () => {
      try {
        const update = await check();
        if (update) {
          const yes = window.confirm(`EasyVault ${update.version} is available. Download and install?`);
          if (yes) {
            await update.downloadAndInstall();
            window.alert("Update installed. Please restart EasyVault to use the new version.");
          }
        }
      } catch (e) {
        console.warn("Update check failed:", e);
      }
    })();
  }, []);

  // Start/stop watch folder polling
  useEffect(() => {
    startWatchPolling();
    return () => stopWatchPolling();
  }, []);

  // Listen for manual scan-now events dispatched by DropzoneTab
  useEffect(() => {
    const handler = () => {
      void scanWatchFolder().then(() => processQueue());
    };
    window.addEventListener("easyvault:scan-watch-folder", handler);
    return () => window.removeEventListener("easyvault:scan-watch-folder", handler);
  }, []);

  // Process queue whenever new items are queued
  useEffect(() => {
    const hasQueued = queueItems.some((x) => x.status === "queued");
    if (hasQueued) {
      void processQueue();
    }
  }, [queueItems]);

  // Auto-sync Outlook emails + calendar on startup and daily at 7 AM
  useEffect(() => {
    const syncOutlook = async () => {
      try {
        const status = await invokeEdgeFunction("outlookStatus", {}) as { connected?: boolean };
        if (!status.connected) return;
        const limit = getEmailSyncCount();
        await invokeEdgeFunction("syncOutlookEmails", { limit });
        await invokeEdgeFunction("syncOutlookCalendar", {});
        await refreshEmailFromRemote();
        await refreshCalendarFromRemote();
      } catch (e) {
        console.warn("Outlook auto-sync failed:", e);
      }
    };

    syncOutlook();

    let lastSyncDate = "";
    const dailyCheckId = window.setInterval(() => {
      const now = new Date();
      const today = now.toDateString();
      if (now.getHours() === 7 && now.getMinutes() === 0 && lastSyncDate !== today) {
        lastSyncDate = today;
        void syncOutlook();
      }
    }, 60_000);

    return () => window.clearInterval(dailyCheckId);
  }, []);

  // Refresh entity data when the active tab changes
  useEffect(() => {
    const refreshFn = TAB_REFRESH[activeTab];
    if (refreshFn) {
      void refreshFn();
    }
  }, [activeTab]);

  return (
    <section className="workspace-screen">
      <Sidebar />
      <section className="shell-main">
        <header className="shell-header">
          <GlobalSearch />
          <LocaleDropdown locale={locale} setLocale={setLocale} />
        </header>
        <ActiveTabComponent />
        {statusText && statusText !== "idle" && (
          <div className="status-bar">{statusText}</div>
        )}
      </section>
      <NewModal />
      <ManageModal />
      <DeleteModal />
      <FileActionModal />
      <PreviewEditModal />
      <SaveLinkModal />
      <ImportLinksModal />
    </section>
  );
}
