import { create } from "zustand";
import { loadJson } from "../services/helpers";

const EVENTS_CACHE_KEY = "ev.remote.events";
const EMAILS_CACHE_KEY = "ev.remote.emails";

/** Parse a cached array from localStorage, dropping non-array values and non-object entries. */
function loadJsonArray<T extends object>(key: string): T[] {
  const parsed = loadJson<unknown>(key, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is T => typeof entry === "object" && entry !== null);
}

interface RemoteDataState {
  emails: Record<string, unknown>[];
  events: Record<string, unknown>[];
  packs: Record<string, unknown>[];
  spaces: Record<string, unknown>[];
  dropzoneItems: Record<string, unknown>[];
  setEmails: (data: Record<string, unknown>[]) => void;
  setEvents: (data: Record<string, unknown>[]) => void;
  setPacks: (data: Record<string, unknown>[]) => void;
  setSpaces: (data: Record<string, unknown>[]) => void;
  setDropzoneItems: (data: Record<string, unknown>[]) => void;
  reset: () => void;
}

export const useRemoteDataStore = create<RemoteDataState>((set) => ({
  emails: loadJsonArray<Record<string, unknown>>(EMAILS_CACHE_KEY),
  events: loadJsonArray<Record<string, unknown>>(EVENTS_CACHE_KEY),
  packs: [],
  spaces: [],
  dropzoneItems: [],
  setEmails: (data) => {
    set({ emails: data });
    try { localStorage.setItem(EMAILS_CACHE_KEY, JSON.stringify(data)); } catch { /* quota */ }
  },
  setEvents: (data) => {
    set({ events: data });
    try { localStorage.setItem(EVENTS_CACHE_KEY, JSON.stringify(data)); } catch { /* quota */ }
  },
  setPacks: (data) => set({ packs: data }),
  setSpaces: (data) => set({ spaces: data }),
  setDropzoneItems: (data) => set({ dropzoneItems: data }),
  /** Clear all remote caches (in memory + localStorage). Used on logout. */
  reset: () => {
    set({ emails: [], events: [], packs: [], spaces: [], dropzoneItems: [] });
    localStorage.removeItem(EMAILS_CACHE_KEY);
    localStorage.removeItem(EVENTS_CACHE_KEY);
  },
}));
