import { useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";
import { useT, t } from "../i18n";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const setStatus = useUiStore((s) => s.setStatus);
  const tr = useT();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus(t("login.loggingIn"));
    try {
      await login(email.trim(), password);
      setStatus(t("login.success"));
    } catch (err) {
      const msg = String(err);
      setStatus(msg.includes("login failed") ? msg : t("login.networkError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="login-screen">
      <div className="login-card">
        <p className="eyebrow">{tr("login.eyebrow")}</p>
        <h1>{tr("login.heading")}</h1>
        <p className="sub">{tr("login.subtitle")}</p>
        <form className="form" onSubmit={handleSubmit}>
          <label>{tr("login.emailLabel")}</label>
          <input type="email" required placeholder={tr("login.emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} />
          <label>{tr("login.passwordLabel")}</label>
          <input type="password" required placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" disabled={loading}>{tr("login.submit")}</button>
        </form>
      </div>
    </section>
  );
}
