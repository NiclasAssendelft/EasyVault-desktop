import { create } from "zustand";
import type { DesktopFolder, DesktopItem } from "../services/helpers";
import { loadJson, normalizeFolder, normalizeItem, FILES_FOLDERS_KEY, FILES_ITEMS_KEY } from "../services/helpers";

interface FilesState {
  folders: DesktopFolder[];
  items: DesktopItem[];
  activeFolderId: string;
  setActiveFolderId: (id: string) => void;
  setFolders: (folders: DesktopFolder[]) => void;
  setItems: (items: DesktopItem[]) => void;
  addFolder: (folder: DesktopFolder) => void;
  updateFolder: (id: string, patch: Partial<DesktopFolder>) => void;
  removeFolder: (id: string) => void;
  addItem: (item: DesktopItem) => void;
  updateItem: (id: string, patch: Partial<DesktopItem>) => void;
  removeItem: (id: string) => void;
  persist: () => void;
}

export const useFilesStore = create<FilesState>((set, get) => ({
  folders: loadJson<DesktopFolder[]>(FILES_FOLDERS_KEY, []).map(normalizeFolder),
  items: loadJson<DesktopItem[]>(FILES_ITEMS_KEY, []).map(normalizeItem),
  activeFolderId: "",
  setActiveFolderId: (id) => set({ activeFolderId: id }),
  setFolders: (folders) => set({ folders }),
  setItems: (items) => set({ items }),
  addFolder: (folder) => set((s) => ({ folders: [...s.folders, folder] })),
  updateFolder: (id, patch) =>
    set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
  removeFolder: (id) => set((s) => ({ folders: s.folders.filter((f) => f.id !== id) })),
  addItem: (item) => set((s) => ({ items: [...s.items, item] })),
  updateItem: (id, patch) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  persist: () => {
    const { folders, items } = get();
    localStorage.setItem(FILES_FOLDERS_KEY, JSON.stringify(folders));
    localStorage.setItem(FILES_ITEMS_KEY, JSON.stringify(items));
  },
}));
