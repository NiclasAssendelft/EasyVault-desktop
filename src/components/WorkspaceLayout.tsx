import { useEffect } from "react";
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
import { startWatchPolling, stopWatchPolling, scanWatchFolder, processQueue } from "../services/queueService";
import { useQueueStore } from "../stores/queueStore";
import { useDeltaSync } from "../hooks/useDeltaSync";
import Sidebar from "./Sidebar";
import HomeTab from "./tabs/HomeTab";
import FilesTab from "./tabs/FilesTab";
import EmailTab from "./tabs/EmailTab";
import CalendarTab from "./tabs/CalendarTab";
import VaultTab from "./tabs/VaultTab";
import SharedTab from "./tabs/SharedTab";
import DropzoneTab from "./tabs/DropzoneTab";
import SettingsTab from "./tabs/SettingsTab";
import NewModal from "./modals/NewModal";
import ManageModal from "./modals/ManageModal";
import DeleteModal from "./modals/DeleteModal";
import FileActionModal from "./modals/FileActionModal";
import PreviewEditModal from "./modals/PreviewEditModal";

const TAB_COMPONENTS = {
  home: HomeTab,
  files: FilesTab,
  email: EmailTab,
  calendar: CalendarTab,
  vault: VaultTab,
  shared: SharedTab,
  queue: DropzoneTab,
  settings: SettingsTab,
} as const;

const TAB_REFRESH: Partial<Record<keyof typeof TAB_COMPONENTS, () => Promise<void>>> = {
  files: refreshFilesFromRemote,
  email: refreshEmailFromRemote,
  calendar: refreshCalendarFromRemote,
  vault: refreshVaultFromRemote,
  shared: refreshSharedFromRemote,
  queue: refreshDropzoneFromRemote,
};

export default function WorkspaceLayout() {
  const activeTab = useUiStore((s) => s.activeTab);
  const statusText = useUiStore((s) => s.statusText);
  const ActiveTabComponent = TAB_COMPONENTS[activeTab];
  const queueItems = useQueueStore((s) => s.items);

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
        <div className="top-title">CEO Vault</div>
        <header className="shell-header">
          <div className="search-shell">
            <span className="search-icon">&#x2315;</span>
            <span>Search everything...</span>
            <kbd>&#x2318;K</kbd>
          </div>
          <p>Status: {statusText}</p>
        </header>
        <ActiveTabComponent />
      </section>
      <NewModal />
      <ManageModal />
      <DeleteModal />
      <FileActionModal />
      <PreviewEditModal />
    </section>
  );
}
