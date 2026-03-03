import { create } from "zustand";
import type { ActionTarget, TabName } from "../services/helpers";

interface UiState {
  activeTab: TabName;
  statusText: string;
  currentFile: string;
  lastSync: string;
  // Modal state
  newModalOpen: boolean;
  createMode: "folder" | "item" | null;
  manageTarget: ActionTarget | null;
  manageTargetBaselineUpdatedAt: string;
  deleteTarget: ActionTarget | null;
  fileActionTargetId: string;
  // Actions
  setActiveTab: (tab: TabName) => void;
  setStatus: (text: string) => void;
  setCurrentFile: (text: string) => void;
  setLastSync: (text: string) => void;
  openNewModal: () => void;
  closeNewModal: () => void;
  setCreateMode: (mode: "folder" | "item" | null) => void;
  openManageModal: (target: ActionTarget, baselineUpdatedAt: string) => void;
  closeManageModal: () => void;
  openDeleteModal: (target: ActionTarget) => void;
  closeDeleteModal: () => void;
  setFileActionTargetId: (id: string) => void;
  closeFileActionModal: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: "home",
  statusText: "idle",
  currentFile: "none",
  lastSync: "none",
  newModalOpen: false,
  createMode: null,
  manageTarget: null,
  manageTargetBaselineUpdatedAt: "",
  deleteTarget: null,
  fileActionTargetId: "",
  setActiveTab: (tab) => set({ activeTab: tab }),
  setStatus: (text) => set({ statusText: text }),
  setCurrentFile: (text) => set({ currentFile: text }),
  setLastSync: (text) => set({ lastSync: text }),
  openNewModal: () => set({ newModalOpen: true, createMode: null }),
  closeNewModal: () => set({ newModalOpen: false, createMode: null }),
  setCreateMode: (mode) => set({ createMode: mode }),
  openManageModal: (target, baselineUpdatedAt) => set({ manageTarget: target, manageTargetBaselineUpdatedAt: baselineUpdatedAt }),
  closeManageModal: () => set({ manageTarget: null, manageTargetBaselineUpdatedAt: "" }),
  openDeleteModal: (target) => set({ deleteTarget: target }),
  closeDeleteModal: () => set({ deleteTarget: null }),
  setFileActionTargetId: (id) => set({ fileActionTargetId: id }),
  closeFileActionModal: () => set({ fileActionTargetId: "" }),
}));
