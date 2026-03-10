import { useState, useCallback } from "react";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { useT, t } from "../i18n";
import loginBg from "../assets/login-bg.png";

export default function LoginScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const login = useAuthStore((s) => s.login);
  const signup = useAuthStore((s) => s.signup);
  const setStatus = useUiStore((s) => s.setStatus);
  const tr = useT();

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "signup") {
      if (password.length < 6) { setStatus(t("signup.passwordTooShort")); return; }
      if (password !== confirmPassword) { setStatus(t("signup.passwordMismatch")); return; }
    }
    setLoading(true);
    setStatus(mode === "login" ? t("login.loggingIn") : t("signup.creatingAccount"));
    try {
      if (mode === "login") {
        await login(email.trim(), password);
        setStatus(t("login.success"));
      } else {
        await signup(email.trim(), password);
        setStatus(t("signup.success"));
      }
    } catch (err) {
      const msg = String(err);
      if (mode === "login") {
        setStatus(msg.includes("login failed") ? msg : t("login.networkError"));
      } else {
        setStatus(msg.includes("already exists") ? t("signup.alreadyExists") : msg);
      }
    } finally {
      setLoading(false);
    }
  }, [mode, email, password, confirmPassword, login, signup, setStatus]);

  return (
    <div className="login-bg-wrap">
      <div className="login-bg-image" style={{ backgroundImage: `url(${loginBg})` }} />
      <div className="login-color-wash" />
      <div className={`login-shimmer-overlay${inputFocused ? " focused" : ""}`} />
      <div className="login-vignette" />

      <div className="login-panel-wrap">
        {/* Gear logo */}
        <svg className="login-logo-mark" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="10" stroke="#a89ffa" strokeWidth="1.5"/>
          <circle cx="32" cy="32" r="5" stroke="#a89ffa" strokeWidth="1"/>
          <g stroke="#a89ffa" strokeWidth="1.5">
            <rect x="30" y="4" width="4" height="8" rx="1" fill="rgba(124,106,247,0.22)"/>
            <rect x="30" y="52" width="4" height="8" rx="1" fill="rgba(124,106,247,0.22)"/>
            <rect x="4" y="30" width="8" height="4" rx="1" fill="rgba(124,106,247,0.22)"/>
            <rect x="52" y="30" width="8" height="4" rx="1" fill="rgba(124,106,247,0.22)"/>
            <rect x="10.5" y="10.5" width="4" height="8" rx="1" transform="rotate(45 12.5 14.5)" fill="rgba(124,106,247,0.22)"/>
            <rect x="41.5" y="41.5" width="4" height="8" rx="1" transform="rotate(45 43.5 45.5)" fill="rgba(124,106,247,0.22)"/>
            <rect x="10.5" y="41.5" width="4" height="8" rx="1" transform="rotate(-45 12.5 45.5)" fill="rgba(124,106,247,0.22)"/>
            <rect x="41.5" y="10.5" width="4" height="8" rx="1" transform="rotate(-45 43.5 14.5)" fill="rgba(124,106,247,0.22)"/>
          </g>
          <circle cx="32" cy="32" r="26" stroke="rgba(124,106,247,0.28)" strokeWidth="0.5"/>
        </svg>

        <div className="login-wordmark">EasyVault</div>
        <div className="login-tagline">Precision. Security. Control.</div>

        <div className="login-card">
          <div className="login-card-title">
            {mode === "login" ? tr("login.heading") : tr("signup.heading")}
          </div>

          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab${mode === "login" ? " active" : ""}`}
              onClick={() => setMode("login")}
            >
              {tr("login.tabLogin")}
            </button>
            <button
              type="button"
              className={`auth-tab${mode === "signup" ? " active" : ""}`}
              onClick={() => setMode("signup")}
            >
              {tr("login.tabSignup")}
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="login-field">
              <label>{tr("login.emailLabel")}</label>
              <input
                type="email"
                required
                placeholder={tr("login.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
              />
            </div>

            <div className="login-field">
              <label>{tr("login.passwordLabel")}</label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
              />
            </div>

            {mode === "signup" && (
              <div className="login-field">
                <label>{tr("signup.confirmLabel")}</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                />
              </div>
            )}

            <div className="login-divider" />

            <button type="submit" className="login-btn" disabled={loading}>
              {mode === "login" ? tr("login.submit") : tr("signup.submit")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
