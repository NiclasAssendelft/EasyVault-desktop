import { useEffect } from "react";
import {
  refreshAllRemoteData,
  startRemotePolling,
  stopRemotePolling,
} from "../services/deltaSyncService";

/**
 * Side-effect-only hook that refreshes all remote data on mount,
 * starts 15s delta-sync polling, and stops polling on unmount.
 */
export function useDeltaSync(): void {
  useEffect(() => {
    void refreshAllRemoteData();
    startRemotePolling();
    return () => {
      stopRemotePolling();
    };
  }, []);
}
