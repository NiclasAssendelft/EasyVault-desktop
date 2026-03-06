import { invoke } from "@tauri-apps/api/core";
import { getPreferredUploadToken, getAuthToken, getApiKey, getOnlyofficeServerUrl } from "../storage";
import { usePreviewEditStore } from "../stores/previewEditStore";
import { useFilesStore } from "../stores/filesStore";
import { useUiStore } from "../stores/uiStore";
import { syncRemoteDelta } from "./deltaSyncService";
import { asString } from "./helpers";
import { invokeEdgeFunction } from "../api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RELAY_POLL_INTERVAL_MS = 1500;

// ---------------------------------------------------------------------------
// Relay setup
// ---------------------------------------------------------------------------

export async function setupOnlyofficeLocalRelay(): Promise<void> {
  try {
    const relayInfo = await invoke<{
      enabled?: boolean;
      container_callback_url?: string;
      host_callback_url?: string;
      target_callback_url?: string;
      port?: number;
    }>("get_onlyoffice_relay_info");

    if (!relayInfo?.enabled) return;

    const store = usePreviewEditStore.getState();

    if (typeof relayInfo.container_callback_url === "string" && relayInfo.container_callback_url.length > 0) {
      store.setOnlyofficeRelayUrls(
        relayInfo.container_callback_url,
        store.onlyofficeRelayHostCallbackUrl,
      );
    }
    if (typeof relayInfo.host_callback_url === "string" && relayInfo.host_callback_url.length > 0) {
      const current = usePreviewEditStore.getState();
      store.setOnlyofficeRelayUrls(
        current.onlyofficeRelayContainerCallbackUrl,
        relayInfo.host_callback_url,
      );
    }

    const relayToken = getPreferredUploadToken() || getAuthToken();
    if (relayToken) {
      await invoke("set_onlyoffice_relay_auth", {
        token: relayToken,
        apiKey: getApiKey(),
      });
    }
    console.log(`ONLYOFFICE relay ready on ${usePreviewEditStore.getState().onlyofficeRelayHostCallbackUrl}`);
  } catch (err) {
    console.warn("ONLYOFFICE relay init failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Relay polling
// ---------------------------------------------------------------------------

type RelayStats = {
  callback_count?: number;
  last_status?: number | null;
  last_key?: string | null;
  last_upstream_status?: number | null;
  last_upstream_body?: string | null;
  last_commit_method?: string | null;
  last_error?: string | null;
  last_save_status?: number | null;
  last_save_key?: string | null;
  last_save_upstream_status?: number | null;
  last_save_upstream_body?: string | null;
  last_save_commit_method?: string | null;
  last_save_error?: string | null;
};

export function stopOnlyofficeRelayPolling(): void {
  const timer = usePreviewEditStore.getState().onlyofficeRelayPollTimer;
  if (timer !== null) {
    window.clearInterval(timer);
    usePreviewEditStore.getState().setOnlyofficeRelayPollTimer(null);
  }
}

export async function startOnlyofficeRelayPolling(): Promise<void> {
  stopOnlyofficeRelayPolling();
  usePreviewEditStore.getState().setOnlyofficeRelayLastSeenCount(0);

  const pull = async () => {
    try {
      const stats = await invoke<RelayStats>("get_onlyoffice_relay_stats");
      const count = Number(stats.callback_count || 0);
      const saveStatus = stats.last_save_status ?? "-";

      if (stats.last_error) {
        console.warn("ONLYOFFICE relay error:", stats.last_error);
      } else if (stats.last_save_error) {
        console.warn("ONLYOFFICE relay save error:", stats.last_save_error);
      } else {
        const lastSeen = usePreviewEditStore.getState().onlyofficeRelayLastSeenCount;
        if (count > lastSeen) {
          usePreviewEditStore.getState().setOnlyofficeRelayLastSeenCount(count);
          if (saveStatus === 6 || saveStatus === 2) {
            await syncRemoteDelta();
            const activeFileId = usePreviewEditStore.getState().onlyofficeActiveFileId;
            if (activeFileId) {
              try {
                const versionsData = await invokeEdgeFunction<{ versions?: unknown[] }>("fileVersions", {
                  fileId: activeFileId,
                  action: "list",
                });
                const newCount = Array.isArray(versionsData.versions) ? versionsData.versions.length : 0;
                const baseline = usePreviewEditStore.getState().onlyofficeBaselineVersionCount;
                if (newCount > baseline) {
                  usePreviewEditStore.getState().setOnlyofficeBaselineVersionCount(newCount);
                }
              } catch (err) {
                console.warn("ONLYOFFICE save sync check failed:", err);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("relay stats failed:", err);
    }
  };

  await pull();
  const timerId = window.setInterval(() => { void pull(); }, RELAY_POLL_INTERVAL_MS);
  usePreviewEditStore.getState().setOnlyofficeRelayPollTimer(timerId);
}

// ---------------------------------------------------------------------------
// Editor launch — cross-origin iframe via relay server
// ---------------------------------------------------------------------------
// ONLYOFFICE api.js wipes window.__TAURI_INTERNALS__ when loaded.
// To prevent this, we serve the editor page from the local relay server
// (http://localhost:17171) and load it in a cross-origin iframe.
// Since http://localhost:17171 ≠ tauri://localhost, the browser's
// Same-Origin Policy prevents api.js from accessing the parent window.
// ---------------------------------------------------------------------------

let _messageHandler: ((event: MessageEvent) => void) | null = null;

export async function launchOnlyofficeEditor(fileId: string): Promise<void> {
  const item = useFilesStore.getState().items.find((x) => x.id === fileId);
  const setStatus = useUiStore.getState().setStatus;

  if (!item) {
    console.warn("ONLYOFFICE launch failed: item not found");
    return;
  }

  setStatus("opening ONLYOFFICE...");
  console.log(`ONLYOFFICE launch: fileId=${fileId} title="${item.title}" ext=${item.fileExtension || "?"}`);

  try {
    usePreviewEditStore.getState().setOnlyofficeActiveFileId(fileId);

    // Capture baseline version count
    try {
      const versionsData = await invokeEdgeFunction<{ versions?: unknown[] }>("fileVersions", {
        fileId,
        action: "list",
      });
      usePreviewEditStore.getState().setOnlyofficeBaselineVersionCount(
        Array.isArray(versionsData.versions) ? versionsData.versions.length : 0,
      );
    } catch {
      usePreviewEditStore.getState().setOnlyofficeBaselineVersionCount(0);
    }

    // Get editor session config from edge function
    const containerCallbackUrl = usePreviewEditStore.getState().onlyofficeRelayContainerCallbackUrl;
    console.log("ONLYOFFICE: calling onlyofficeEditorSession edge function...");
    const payload = await invokeEdgeFunction<Record<string, unknown>>("onlyofficeEditorSession", {
      fileId,
      mode: "edit",
      callbackUrl: containerCallbackUrl,
      clientCallbackUrl: containerCallbackUrl,
    });
    console.log("ONLYOFFICE: edge function returned:", JSON.stringify(payload).slice(0, 200));

    const serverConfig = (payload.config as Record<string, unknown>) || {};

    // Resolve ONLYOFFICE document server URL
    const configuredServerUrl = getOnlyofficeServerUrl();
    let documentServerUrl =
      configuredServerUrl ||
      asString(payload.onlyoffice_url) ||
      "http://localhost:8080";
    if (!configuredServerUrl && documentServerUrl.includes("host.docker.internal")) {
      documentServerUrl = documentServerUrl.replace("host.docker.internal", "localhost");
    }
    console.log("ONLYOFFICE: document server URL:", documentServerUrl);

    // Store config in Rust relay server for the editor page to fetch
    const configForRelay = JSON.stringify({
      documentServerUrl,
      config: serverConfig,
    });
    const sessionId = await invoke<string>("store_onlyoffice_editor_config", {
      configJson: configForRelay,
    });
    console.log("ONLYOFFICE: stored config with session ID:", sessionId);

    // Get relay port from relay info
    const relayInfo = await invoke<{ port?: number }>("get_onlyoffice_relay_info");
    const relayPort = relayInfo?.port || 17171;

    // Find or create host element
    let hostEl = document.getElementById("onlyoffice-editor-host");
    if (!hostEl) {
      hostEl = document.createElement("div");
      hostEl.id = "onlyoffice-editor-host";
      hostEl.className = "onlyoffice-host";
      hostEl.style.cssText = "height:100%;width:100%;min-height:600px;";
      document.body.appendChild(hostEl);
    }
    hostEl.innerHTML = "";

    // Create cross-origin iframe pointing to the relay server
    const iframe = document.createElement("iframe");
    iframe.id = "onlyoffice-editor-iframe";
    iframe.style.cssText = "width:100%;height:100%;border:none;";
    const iframeSrc = `http://localhost:${relayPort}/editor?id=${encodeURIComponent(sessionId)}`;
    console.log("ONLYOFFICE: loading iframe from:", iframeSrc);
    iframe.src = iframeSrc;
    hostEl.appendChild(iframe);

    // Listen for postMessage events from the editor iframe
    if (_messageHandler) {
      window.removeEventListener("message", _messageHandler);
    }
    _messageHandler = (event: MessageEvent) => {
      // Only accept messages from our relay server
      if (!event.origin.includes(`localhost:${relayPort}`)) return;
      const data = event.data as { type?: string; detail?: unknown } | undefined;
      if (!data?.type) return;

      switch (data.type) {
        case "oo-ready":
          setStatus("");
          console.log(`ONLYOFFICE ready: ${item.title}`);
          break;
        case "oo-mounted":
          console.log("ONLYOFFICE: editor mounted in cross-origin iframe");
          break;
        case "oo-error":
          console.error("ONLYOFFICE iframe error:", data.detail);
          setStatus(`ONLYOFFICE error: ${String(data.detail)}`);
          // Close editor panel so files aren't hidden behind blank overlay
          usePreviewEditStore.getState().close();
          break;
        case "oo-warning":
          console.warn("ONLYOFFICE warning:", data.detail);
          break;
        case "oo-close":
          setStatus("");
          stopOnlyofficeRelayPolling();
          void syncRemoteDelta();
          break;
      }
    };
    window.addEventListener("message", _messageHandler);

    // Store a reference so close() can clean up the iframe
    usePreviewEditStore.getState().setOnlyofficeEditor({
      destroy: () => {
        if (_messageHandler) {
          window.removeEventListener("message", _messageHandler);
          _messageHandler = null;
        }
        const el = document.getElementById("onlyoffice-editor-iframe");
        if (el) el.remove();
      },
    });

    // Force relayout for ONLYOFFICE inside modals
    window.setTimeout(() => { window.dispatchEvent(new Event("resize")); }, 50);
    window.setTimeout(() => { window.dispatchEvent(new Event("resize")); }, 250);

    // Timeout: if editor doesn't become ready in 20s, show error
    let editorReady = false;
    const origHandler = _messageHandler;
    if (origHandler) {
      const wrappedHandler = (event: MessageEvent) => {
        origHandler(event);
        const data = event.data as { type?: string } | undefined;
        if (data?.type === "oo-ready" || data?.type === "oo-mounted") {
          editorReady = true;
        }
      };
      window.removeEventListener("message", origHandler);
      _messageHandler = wrappedHandler;
      window.addEventListener("message", wrappedHandler);
    }
    window.setTimeout(() => {
      if (!editorReady) {
        console.warn("ONLYOFFICE: editor did not become ready within 20s");
        setStatus("ONLYOFFICE editor timed out — check if the server is reachable");
        // Close the editor panel so files aren't hidden behind a blank overlay
        usePreviewEditStore.getState().close();
      }
    }, 20000);

    console.log("ONLYOFFICE: cross-origin iframe created, loading editor...");
    await startOnlyofficeRelayPolling();
  } catch (err) {
    console.error(`ONLYOFFICE launch failed for fileId=${fileId}:`, err);
    setStatus(`ONLYOFFICE failed: ${String(err)}`);
    // Close the editor panel so files aren't hidden behind the overlay
    usePreviewEditStore.getState().close();
  }
}
