import { useAuthStore } from "./stores/authStore";
import LoginScreen from "./components/LoginScreen";
import WorkspaceLayout from "./components/WorkspaceLayout";

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  return (
    <main className="desktop-native">
      {isLoggedIn ? <WorkspaceLayout /> : <LoginScreen />}
    </main>
  );
}
