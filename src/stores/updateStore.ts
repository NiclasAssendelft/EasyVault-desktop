import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";

export type UpdateStatus =
  | "idle"           // never checked
  | "checking"       // hitting the update endpoint
  | "up-to-date"     // checked, no newer version
  | "available"      // newer version found, awaiting user action
  | "downloading"    // user clicked install, transfer in flight
  | "installing"     // archive landed, swap in progress
  | "ready-restart"  // install finished, app needs restart
  | "failed";        // anything went wrong — errorMessage will be set

interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string;
  releaseNotes: string;
  errorMessage: string;
  bytesDownloaded: number;
  bytesTotal: number;
  // Internal — populated when an update is found, consumed by install()
  pending: Update | null;
  checkForUpdate: (silent?: boolean) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  currentVersion: "",
  availableVersion: "",
  releaseNotes: "",
  errorMessage: "",
  bytesDownloaded: 0,
  bytesTotal: 0,
  pending: null,

  checkForUpdate: async (silent = false): Promise<void> => {
    if (get().status === "checking" || get().status === "downloading" || get().status === "installing") return;
    if (!silent) set({ status: "checking", errorMessage: "" });
    try {
      const current = await getVersion().catch(() => "");
      const update = await check();
      if (!update) {
        set({ status: "up-to-date", currentVersion: current, errorMessage: "" });
        return;
      }
      set({
        status: "available",
        currentVersion: current,
        availableVersion: update.version,
        releaseNotes: update.body || "",
        pending: update,
        errorMessage: "",
      });
    } catch (err) {
      set({
        status: "failed",
        errorMessage: String(err).replace(/^Error:\s*/, ""),
      });
    }
  },

  install: async (): Promise<void> => {
    const update = get().pending;
    if (!update) return;
    set({ status: "downloading", bytesDownloaded: 0, bytesTotal: 0, errorMessage: "" });
    try {
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength || 0;
          set({ bytesTotal: total, bytesDownloaded: 0 });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength || 0;
          set({ bytesDownloaded: downloaded });
        } else if (event.event === "Finished") {
          set({ status: "installing" });
        }
      });
      set({ status: "ready-restart" });
    } catch (err) {
      set({
        status: "failed",
        errorMessage: String(err).replace(/^Error:\s*/, ""),
      });
    }
  },

  dismiss: (): void => {
    set({ status: "idle", pending: null });
  },
}));
