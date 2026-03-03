import { useEffect } from "react";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useUiStore } from "../stores/uiStore";

/**
 * Listens for incoming deep-link URLs. When a URL with a `fileId` query
 * parameter arrives, sets it on the UI store and switches to the files tab.
 */
export function useDeepLink(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void onOpenUrl((urls: string[]) => {
      for (const raw of urls) {
        try {
          const parsed = new URL(raw);
          const fileId = parsed.searchParams.get("fileId");
          if (fileId) {
            const store = useUiStore.getState();
            store.setFileActionTargetId(fileId);
            store.setActiveTab("files");
          }
        } catch {
          // ignore malformed URLs
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}
