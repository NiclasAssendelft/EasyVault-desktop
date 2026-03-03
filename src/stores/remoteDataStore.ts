import { create } from "zustand";

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
  emails: [],
  events: [],
  packs: [],
  spaces: [],
  dropzoneItems: [],
  setEmails: (data) => set({ emails: data }),
  setEvents: (data) => set({ events: data }),
  setPacks: (data) => set({ packs: data }),
  setSpaces: (data) => set({ spaces: data }),
  setDropzoneItems: (data) => set({ dropzoneItems: data }),
}));
