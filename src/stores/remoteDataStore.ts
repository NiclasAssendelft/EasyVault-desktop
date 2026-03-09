import { create } from "zustand";
import { loadJson } from "../services/helpers";

const EVENTS_CACHE_KEY = "ev.remote.events";
const EMAILS_CACHE_KEY = "ev.remote.emails";

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
}

export const useRemoteDataStore = create<RemoteDataState>((set) => ({
  emails: loadJson<Record<string, unknown>[]>(EMAILS_CACHE_KEY, []),
  events: loadJson<Record<string, unknown>[]>(EVENTS_CACHE_KEY, []),
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
}));
