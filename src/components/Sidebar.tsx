import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import type { TabName } from "../services/helpers";

const TABS: { name: TabName; label: string }[] = [
  { name: "home", label: "Home" },
  { name: "files", label: "Files" },
  { name: "email", label: "Email" },
  { name: "calendar", label: "Calendar" },
  { name: "vault", label: "Vault" },
  { name: "shared", label: "Shared" },
  { name: "queue", label: "Dropzone" },
  { name: "settings", label: "Settings" },
];

export default function Sidebar() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const logout = useAuthStore((s) => s.logout);

  return (
    <aside className="shell-sidebar">
      <div className="brand-block">
        <div className="brand-row">
          <img
            className="brand-logo"
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69970fbb1f1de2b0bede99df/daa74d4e3_ChatGPTImageFeb20202605_11_56PM.png"
            alt="EasyVault"
          />
          <h2>EasyVault</h2>
        </div>
      </div>
      <nav className="nav-list">
        {TABS.map((tab) => (
          <button
            key={tab.name}
            className={`nav-btn${activeTab === tab.name ? " active" : ""}`}
            onClick={() => setActiveTab(tab.name)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <button type="button" className="ghost" onClick={logout}>
        Sign out
      </button>
    </aside>
  );
}
