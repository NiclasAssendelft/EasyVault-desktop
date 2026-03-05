import { create } from "zustand";
import { login as apiLogin, signup as apiSignup, invokeEdgeFunction } from "../api";
import { getAuthToken, getSavedEmail, saveLogin, clearLogin, getExtensionToken, saveSettings } from "../storage";

async function ensureExtensionToken(accessToken: string): Promise<void> {
  if (getExtensionToken()) return;
  try {
    const res = await invokeEdgeFunction<{ token?: string }>(
      "extensionAuth",
      { action: "create" },
      accessToken,
    );
    if (res.token) {
      saveSettings("", res.token);
    }
  } catch { /* non-critical — user can set it manually later */ }
}

interface AuthState {
  isLoggedIn: boolean;
  email: string;
  accessibleSpaceIds: string[];
  personalSpaceId: string;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setAccessScope: (spaceIds: string[], personalId: string) => void;
  checkLoggedIn: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isLoggedIn: Boolean(getAuthToken()),
  email: getSavedEmail(),
  accessibleSpaceIds: [],
  personalSpaceId: "",
  login: async (email, password) => {
    const accessToken = await apiLogin(email, password);
    saveLogin(accessToken, email);
    set({ isLoggedIn: true, email });
    ensureExtensionToken(accessToken);
  },
  signup: async (email, password) => {
    const accessToken = await apiSignup(email, password);
    saveLogin(accessToken, email);
    set({ isLoggedIn: true, email });
    ensureExtensionToken(accessToken);
  },
  logout: () => {
    clearLogin();
    set({ isLoggedIn: false, email: "", accessibleSpaceIds: [], personalSpaceId: "" });
  },
  setAccessScope: (spaceIds, personalId) => {
    set({ accessibleSpaceIds: spaceIds, personalSpaceId: personalId });
  },
  checkLoggedIn: () => {
    set({ isLoggedIn: Boolean(getAuthToken()), email: getSavedEmail() });
  },
}));
