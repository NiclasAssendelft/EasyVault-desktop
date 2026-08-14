import { create } from "zustand";
import { login as apiLogin, signup as apiSignup, invokeEdgeFunction } from "../api";
import { getAuthToken, getSavedEmail, saveLogin, clearLogin, getExtensionToken, saveSettings } from "../storage";
import { useFilesStore } from "./filesStore";
import { useRemoteDataStore } from "./remoteDataStore";
import { useQueueStore } from "./queueStore";
import { useSyncStore } from "./syncStore";

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
    const normalizedEmail = email.trim().toLowerCase();
    saveLogin(accessToken, normalizedEmail);
    set({ isLoggedIn: true, email: normalizedEmail });
    ensureExtensionToken(accessToken);
  },
  signup: async (email, password) => {
    const accessToken = await apiSignup(email, password);
    const normalizedEmail = email.trim().toLowerCase();
    saveLogin(accessToken, normalizedEmail);
    set({ isLoggedIn: true, email: normalizedEmail });
    ensureExtensionToken(accessToken);
  },
  logout: () => {
    clearLogin();
    // Drop the long-lived extension token so a next login on this machine
    // can't upload as the previous user (ensureExtensionToken recreates it).
    saveSettings("", "");
    // Clear the previous user's cached data (in memory + localStorage).
    // Locale, device id and saved email are intentionally kept.
    useFilesStore.getState().reset();
    useRemoteDataStore.getState().reset();
    useQueueStore.getState().reset();
    useSyncStore.getState().reset();
    set({ isLoggedIn: false, email: "", accessibleSpaceIds: [], personalSpaceId: "" });
  },
  setAccessScope: (spaceIds, personalId) => {
    set({ accessibleSpaceIds: spaceIds, personalSpaceId: personalId });
  },
  checkLoggedIn: () => {
    set({ isLoggedIn: Boolean(getAuthToken()), email: getSavedEmail() });
  },
}));
