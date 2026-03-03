import { useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { useUiStore } from "../stores/uiStore";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const setStatus = useUiStore((s) => s.setStatus);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus("logging in...");
    try {
      await login(email.trim(), password);
      setStatus("login success");
    } catch (err) {
      const msg = String(err);
      setStatus(msg.includes("login failed") ? msg : "network/error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="login-screen">
      <div className="login-card">
        <p className="eyebrow">EasyVault Desktop</p>
        <h1>Sign in</h1>
        <p className="sub">Native desktop companion for capture, editing, and versioning.</p>
        <form className="form" onSubmit={handleSubmit}>
          <label>Email</label>
          <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label>Password</label>
          <input type="password" required placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" disabled={loading}>Log in</button>
        </form>
      </div>
    </section>
  );
}
