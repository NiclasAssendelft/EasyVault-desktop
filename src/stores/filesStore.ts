import { create } from "zustand";
import type { DesktopFolder, DesktopItem } from "../services/helpers";
import { loadJson, normalizeFolder, normalizeItem, FILES_FOLDERS_KEY, FILES_ITEMS_KEY } from "../services/helpers";

/** Parse a cached array from localStorage, dropping non-array values and non-object entries. */
function loadJsonArray<T extends object>(key: string): T[] {
  const parsed = loadJson<unknown>(key, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is T => typeof entry === "object" && entry !== null);
}

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
  reset: () => void;
}

export const useFilesStore = create<FilesState>((set, get) => ({
  folders: loadJsonArray<Partial<DesktopFolder>>(FILES_FOLDERS_KEY).map(normalizeFolder),
  items: loadJsonArray<Partial<DesktopItem>>(FILES_ITEMS_KEY).map(normalizeItem),
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
    try {
      localStorage.setItem(FILES_FOLDERS_KEY, JSON.stringify(folders));
      localStorage.setItem(FILES_ITEMS_KEY, JSON.stringify(items));
    } catch {
      /* quota — in-memory state stays authoritative */
    }
  },
  /** Clear all cached folders/items (in memory + localStorage). Used on logout. */
  reset: () => {
    set({ folders: [], items: [], activeFolderId: "" });
    localStorage.removeItem(FILES_FOLDERS_KEY);
    localStorage.removeItem(FILES_ITEMS_KEY);
  },
}));
