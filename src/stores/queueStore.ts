import { create } from "zustand";
import type { ImportQueueItem } from "../types";
import { getUploadedWatchSignatures, saveUploadedWatchSignatures } from "../storage";

interface QueueState {
  items: ImportQueueItem[];
  isRunning: boolean;
  watchPollId: number | null;
  uploadedSignatures: Set<string>;
  setItems: (items: ImportQueueItem[]) => void;
  addItem: (item: ImportQueueItem) => void;
  updateItem: (id: string, patch: Partial<ImportQueueItem>) => void;
  setIsRunning: (running: boolean) => void;
  setWatchPollId: (id: number | null) => void;
  markSignature: (sig: string) => void;
  hasSignature: (sig: string) => boolean;
  reset: () => void;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],
  isRunning: false,
  watchPollId: null,
  uploadedSignatures: getUploadedWatchSignatures(),
  setItems: (items) => set({ items }),
  addItem: (item) => set((s) => ({ items: [...s.items, item] })),
  updateItem: (id, patch) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  setIsRunning: (running) => set({ isRunning: running }),
  setWatchPollId: (id) => set({ watchPollId: id }),
  markSignature: (sig) => {
    const next = new Set(get().uploadedSignatures);
    next.add(sig);
    set({ uploadedSignatures: next });
    saveUploadedWatchSignatures(next);
  },
  hasSignature: (sig) => get().uploadedSignatures.has(sig),
  /** Clear queue items + uploaded-signature dedupe (in memory + localStorage). Used on logout. */
  reset: () => {
    const empty = new Set<string>();
    set({ items: [], uploadedSignatures: empty });
    saveUploadedWatchSignatures(empty);
  },
}));
