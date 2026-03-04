import { useEffect } from "react";
import { useAuthStore } from "./stores/authStore";
import { setAutoLogoutHandler } from "./api";
import LoginScreen from "./components/LoginScreen";
import WorkspaceLayout from "./components/WorkspaceLayout";

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    setAutoLogoutHandler(() => logout());
  }, [logout]);

  return (
    <main className="desktop-native">
      {isLoggedIn ? <WorkspaceLayout /> : <LoginScreen />}
    </main>
  );
}
