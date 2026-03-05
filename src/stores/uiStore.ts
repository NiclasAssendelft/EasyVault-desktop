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
  saveLinkModalOpen: boolean;
  saveLinkEditTarget: string;
  importLinksModalOpen: boolean;
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
  openSaveLinkModal: (editItemId?: string) => void;
  closeSaveLinkModal: () => void;
  openImportLinksModal: () => void;
  closeImportLinksModal: () => void;
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
  saveLinkModalOpen: false,
  saveLinkEditTarget: "",
  importLinksModalOpen: false,
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
  openSaveLinkModal: (editItemId = "") => set({ saveLinkModalOpen: true, saveLinkEditTarget: editItemId }),
  closeSaveLinkModal: () => set({ saveLinkModalOpen: false, saveLinkEditTarget: "" }),
  openImportLinksModal: () => set({ importLinksModalOpen: true }),
  closeImportLinksModal: () => set({ importLinksModalOpen: false }),
}));
