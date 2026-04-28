import { useState, useCallback, useEffect } from "react";
import { useAuthStore } from "../stores/authStore";
import { useT, t } from "../i18n";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";
import loginBg from "../assets/login-bg.jpg";

type MessageType = "error" | "success" | "info";

export default function LoginScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: MessageType } | null>(null);
  const [hasError, setHasError] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const login = useAuthStore((s) => s.login);
  const signup = useAuthStore((s) => s.signup);
  const tr = useT();

  const clearMessage = () => { setMessage(null); setHasError(false); };

  const switchMode = (m: "login" | "signup") => {
    setMode(m);
    clearMessage();
  };

  // Detect Caps Lock state for the password fields
  const handleCapsCheck = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (typeof e.getModifierState === "function") {
      setCapsLockOn(e.getModifierState("CapsLock"));
    }
  };

  useEffect(() => {
    if (!loading) return;
    const handler = (e: KeyboardEvent): void => {
      if (typeof e.getModifierState === "function") setCapsLockOn(e.getModifierState("CapsLock"));
    };
    window.addEventListener("keyup", handler);
    return () => window.removeEventListener("keyup", handler);
  }, [loading]);

  const handleForgotPassword = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setMessage({ text: t("login.enterEmailFirst"), type: "info" });
      return;
    }
    setLoading(true);
    clearMessage();
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setMessage({ text: t("login.recoveryEmailSent", { email: trimmed }), type: "info" });
    } catch (err) {
      setMessage({ text: t("login.recoveryFailed", { error: String(err).replace(/^Error:\s*/, "") }), type: "error" });
    } finally {
      setLoading(false);
    }
  }, [email]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessage();
    if (mode === "signup") {
      if (password.length < 6) { setMessage({ text: t("signup.passwordTooShort"), type: "error" }); setHasError(true); return; }
      if (password !== confirmPassword) { setMessage({ text: t("signup.passwordMismatch"), type: "error" }); setHasError(true); return; }
    }
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
        setMessage({ text: t("login.success"), type: "success" });
      } else {
        await signup(email.trim(), password);
        setMessage({ text: t("signup.success"), type: "success" });
      }
    } catch (err) {
      const msg = String(err).replace(/^Error:\s*/, "");
      setHasError(true);
      if (mode === "login") {
        const isCredentialError = msg.toLowerCase().includes("invalid login credentials") || msg.includes("login failed");
        setMessage({ text: isCredentialError ? t("login.wrongCredentials") : msg, type: "error" });
      } else {
        if (msg.includes("already exists")) {
          setMessage({ text: t("signup.alreadyExists"), type: "error" });
        } else if (msg.includes("check your email") || msg.includes("confirm")) {
          setMessage({ text: t("signup.checkEmail"), type: "info" });
        } else {
          setMessage({ text: msg, type: "error" });
        }
      }
    } finally {
      setLoading(false);
    }
  }, [mode, email, password, confirmPassword, login, signup]);

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
              onClick={() => switchMode("login")}
            >
              {tr("login.tabLogin")}
            </button>
            <button
              type="button"
              className={`auth-tab${mode === "signup" ? " active" : ""}`}
              onClick={() => switchMode("signup")}
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
                onChange={(e) => { setEmail(e.target.value); clearMessage(); }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
              />
            </div>

            <div className="login-field">
              <div className="login-field-row">
                <label>{tr("login.passwordLabel")}</label>
                {mode === "login" && (
                  <button
                    type="button"
                    className="login-forgot"
                    onClick={handleForgotPassword}
                    disabled={loading}
                  >
                    {tr("login.forgotPassword")}
                  </button>
                )}
              </div>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                className={hasError ? "login-input-error" : ""}
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearMessage(); }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onKeyUp={handleCapsCheck}
                onKeyDown={handleCapsCheck}
              />
              {capsLockOn && (
                <div className="login-caps-warn" role="status">
                  ⇪ {tr("login.capsLockOn")}
                </div>
              )}
            </div>

            {mode === "signup" && (
              <div className="login-field">
                <label>{tr("signup.confirmLabel")}</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  className={hasError ? "login-input-error" : ""}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); clearMessage(); }}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  onKeyUp={handleCapsCheck}
                  onKeyDown={handleCapsCheck}
                />
              </div>
            )}

            <div className="login-divider" />

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? (
                <span className="login-btn-loading">
                  <span className="login-spinner" aria-hidden="true" />
                  {mode === "login" ? tr("login.loggingIn") : tr("signup.creatingAccount")}
                </span>
              ) : (
                <span>{mode === "login" ? tr("login.submit") : tr("signup.submit")}</span>
              )}
            </button>

            {message && (
              <div
                className={`login-message ${message.type}`}
                role={message.type === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {message.text}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
