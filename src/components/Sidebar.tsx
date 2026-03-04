import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { useT } from "../i18n";
import type { TabName } from "../services/helpers";
import type { TKey } from "../i18n";

const TABS: { name: TabName; labelKey: TKey }[] = [
  { name: "home", labelKey: "nav.home" },
  { name: "files", labelKey: "nav.files" },
  { name: "email", labelKey: "nav.email" },
  { name: "calendar", labelKey: "nav.calendar" },
  { name: "vault", labelKey: "nav.vault" },
  { name: "shared", labelKey: "nav.shared" },
  { name: "queue", labelKey: "nav.dropzone" },
  { name: "settings", labelKey: "nav.settings" },
];

export default function Sidebar() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const logout = useAuthStore((s) => s.logout);
  const t = useT();

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
            {t(tab.labelKey)}
          </button>
        ))}
      </nav>
      <button type="button" className="ghost" onClick={logout}>
        {t("nav.signOut")}
      </button>
    </aside>
  );
}
