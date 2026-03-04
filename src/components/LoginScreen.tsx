import { useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { useT, t } from "../i18n";

export default function LoginScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const signup = useAuthStore((s) => s.signup);
  const setStatus = useUiStore((s) => s.setStatus);
  const tr = useT();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "signup") {
      if (password.length < 6) {
        setStatus(t("signup.passwordTooShort"));
        return;
      }
      if (password !== confirmPassword) {
        setStatus(t("signup.passwordMismatch"));
        return;
      }
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
  };

  return (
    <section className="login-screen">
      <div className="login-card">
        <p className="eyebrow">{tr("login.eyebrow")}</p>
        <h1>{mode === "login" ? tr("login.heading") : tr("signup.heading")}</h1>
        <p className="sub">{mode === "login" ? tr("login.subtitle") : tr("signup.subtitle")}</p>

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

        <form className="form" onSubmit={handleSubmit}>
          <label>{tr("login.emailLabel")}</label>
          <input
            type="email"
            required
            placeholder={tr("login.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label>{tr("login.passwordLabel")}</label>
          <input
            type="password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "signup" && (
            <>
              <label>{tr("signup.confirmLabel")}</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </>
          )}
          <button type="submit" disabled={loading}>
            {mode === "login" ? tr("login.submit") : tr("signup.submit")}
          </button>
        </form>
      </div>
    </section>
  );
}
