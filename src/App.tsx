import { useEffect } from "react";
import { useAuthStore } from "./stores/authStore";
import { setAutoLogoutHandler } from "./api";
import { handleInviteUrl } from "./services/inviteService";
import LoginScreen from "./components/LoginScreen";
import WorkspaceLayout from "./components/WorkspaceLayout";

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    setAutoLogoutHandler(() => logout());
  }, [logout]);

  // Invite deep links must be subscribed regardless of auth state — a logged-
  // out user's click has to store the pending token so LoginScreen can show
  // its banner. Cold-start URL + live listener → handleInviteUrl. Dev-mode
  // caveat: the easyvault:// scheme is only registered by installed builds;
  // the paste-code fallback covers dev testing.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
        const startUrls = await getCurrent();
        if (cancelled) return;
        for (const url of startUrls ?? []) handleInviteUrl(url);
        const un = await onOpenUrl((urls) => {
          for (const url of urls) handleInviteUrl(url);
        });
        if (cancelled) {
          un();
        } else {
          unlisten = un;
        }
      } catch (e) {
        console.warn("Deep link listener setup failed:", e);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <main className="desktop-native">
      {isLoggedIn ? <WorkspaceLayout /> : <LoginScreen />}
    </main>
  );
}
