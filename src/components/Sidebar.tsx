import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { useT } from "../i18n";
import type { TabName } from "../services/helpers";
import type { TKey } from "../i18n";
import logoImg from "../assets/logo.png";

function initialsFromEmail(email: string): string {
  if (!email) return "?";
  const local = email.split("@")[0] || "";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length === 0) return local.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function displayNameFromEmail(email: string): string {
  if (!email) return "";
  const local = email.split("@")[0] || "";
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

const TABS: { name: TabName; labelKey: TKey; icon: string }[] = [
  { name: "home", labelKey: "nav.home", icon: "\u{1F3E0}" },
  { name: "files", labelKey: "nav.files", icon: "\u{1F4C1}" },
  { name: "email", labelKey: "nav.email", icon: "\u{1F4E7}" },
  { name: "links", labelKey: "nav.links", icon: "\u{1F517}" },
  { name: "calendar", labelKey: "nav.calendar", icon: "\u{1F4C5}" },
  { name: "vault", labelKey: "nav.vault", icon: "\u{1F512}" },
  { name: "workspaces", labelKey: "nav.workspaces", icon: "\u{1F465}" },
  { name: "queue", labelKey: "nav.dropzone", icon: "\u{1F4E5}" },
  { name: "settings", labelKey: "nav.settings", icon: "\u2699\uFE0F" },
];

export default function Sidebar() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const email = useAuthStore((s) => s.email);
  const logout = useAuthStore((s) => s.logout);
  const t = useT();

  const initials = initialsFromEmail(email);
  const displayName = displayNameFromEmail(email);

  return (
    <aside className="shell-sidebar">
      <div className="brand-block">
        <div className="brand-row">
          <img
            className="brand-logo"
            src={logoImg}
            alt="EasyVault"
          />
          <span className="brand-name">EASYVAULT</span>
        </div>
      </div>
      <nav className="nav-list">
        {TABS.map((tab) => (
          <button
            key={tab.name}
            className={`nav-btn${activeTab === tab.name ? " active" : ""}`}
            onClick={() => setActiveTab(tab.name)}
          >
            <span className="nav-btn-icon">{tab.icon}</span>{t(tab.labelKey)}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        {email && (
          <button
            type="button"
            className="sidebar-user"
            onClick={() => setActiveTab("settings")}
            title={t("sidebar.openSettings")}
          >
            <span className="sidebar-user-avatar" aria-hidden="true">{initials}</span>
            <span className="sidebar-user-text">
              <span className="sidebar-user-name">{displayName}</span>
              <span className="sidebar-user-email">{email}</span>
            </span>
          </button>
        )}
        <button type="button" className="ghost sidebar-logout" onClick={logout}>
          {t("nav.signOut")}
        </button>
      </div>
    </aside>
  );
}
