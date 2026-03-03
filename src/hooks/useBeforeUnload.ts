import { useEffect } from "react";
import { getActiveEditSession } from "../syncEngine";
import { callFileLock } from "../api";

/**
 * On `beforeunload`, checks for an active edit session and
 * sends an unlock request so the file is not left locked on the server.
 */
export function useBeforeUnload(): void {
  useEffect(() => {
    const handler = () => {
      const session = getActiveEditSession();
      if (session) {
        void callFileLock(session.extensionToken, session.fileId, "unlock");
      }
    };

    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, []);
}
