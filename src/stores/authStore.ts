import { create } from "zustand";
import { login as apiLogin } from "../api";
import { getAuthToken, getSavedEmail, saveLogin, clearLogin } from "../storage";

interface AuthState {
  isLoggedIn: boolean;
  email: string;
  accessibleSpaceIds: string[];
  personalSpaceId: string;
  login: (email: string, password: string) => Promise<void>;
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
