import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUiStore } from "../stores/uiStore";
import {
  refreshFilesFromRemote,
  refreshEmailFromRemote,
  refreshCalendarFromRemote,
  refreshVaultFromRemote,
  refreshSharedFromRemote,
  refreshDropzoneFromRemote,
} from "../services/deltaSyncService";
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

function setupOnlyofficeLocalRelay(): void {
  void invoke("get_onlyoffice_relay_info");
}

export default function WorkspaceLayout() {
  const activeTab = useUiStore((s) => s.activeTab);
  const statusText = useUiStore((s) => s.statusText);
  const ActiveTabComponent = TAB_COMPONENTS[activeTab];

  // Start delta-sync polling on mount, stop on unmount
  useDeltaSync();

  // Set up OnlyOffice local relay on mount
  useEffect(() => {
    setupOnlyofficeLocalRelay();
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
