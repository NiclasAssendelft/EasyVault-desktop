import { invoke } from "@tauri-apps/api/core";
import { invokeBase44Function, listVersions } from "../api";
import { getPreferredUploadToken, getAuthToken, getApiKey, getOnlyofficeJwtSecret } from "../storage";
import { usePreviewEditStore } from "../stores/previewEditStore";
import { useFilesStore } from "../stores/filesStore";
import { useUiStore } from "../stores/uiStore";
import { syncRemoteDelta } from "./deltaSyncService";
import {
  asString,
  extOf,
  onlyofficeDocumentTypeForExt,
  signOnlyofficeConfigToken,
} from "./helpers";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ONLYOFFICE_LOCAL_JWT_SECRET_FALLBACK = "ev_9fK2mQ7xT4pL8vN3zR6cH1yB5uD0wS";
const RELAY_POLL_INTERVAL_MS = 1500;

// ---------------------------------------------------------------------------
// Relay setup
// ---------------------------------------------------------------------------

export async function setupOnlyofficeLocalRelay(): Promise<void> {
  const setStatus = useUiStore.getState().setStatus;
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
    setStatus(`ONLYOFFICE relay ready on ${usePreviewEditStore.getState().onlyofficeRelayHostCallbackUrl}`);
  } catch (err) {
    setStatus(`ONLYOFFICE relay init failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Callback URL rewriting
// ---------------------------------------------------------------------------

export function rewriteOnlyofficeCallbackUrls(value: unknown): unknown {
  const containerUrl = usePreviewEditStore.getState().onlyofficeRelayContainerCallbackUrl;

  if (typeof value === "string") {
    if (/^https?:\/\/(app\.base44\.com|easy-vault\.com)\/api\/apps\/[^/]+\/functions\/onlyofficeCallback\/?$/i.test(value)) {
      return containerUrl;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteOnlyofficeCallbackUrls(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteOnlyofficeCallbackUrls(v);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// ONLYOFFICE API loader
// ---------------------------------------------------------------------------

export async function ensureOnlyofficeApi(documentServerUrl: string): Promise<void> {
  const normalized = documentServerUrl.replace(/\/+$/, "");
  const scriptUrl = `${normalized}/web-apps/apps/api/documents/api.js`;
  const store = usePreviewEditStore.getState();

  if (store.onlyofficeApiReady && store.onlyofficeApiScriptUrl === scriptUrl) return;

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`ONLYOFFICE API load timeout: ${scriptUrl}`));
    }, 12000);

    const existing = document.querySelector<HTMLScriptElement>(`script[data-onlyoffice-api="${scriptUrl}"]`);
    if (existing) {
      if ((window as unknown as { DocsAPI?: unknown }).DocsAPI) {
        usePreviewEditStore.getState().setOnlyofficeApiReady(true, scriptUrl);
        window.clearTimeout(timer);
        resolve();
        return;
      }
      existing.addEventListener("load", () => {
        usePreviewEditStore.getState().setOnlyofficeApiReady(true, scriptUrl);
        window.clearTimeout(timer);
        resolve();
      });
      existing.addEventListener("error", () => {
        window.clearTimeout(timer);
        reject(new Error("Failed to load ONLYOFFICE API"));
      });
      return;
    }

    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.dataset.onlyofficeApi = scriptUrl;
    script.onload = () => {
      usePreviewEditStore.getState().setOnlyofficeApiReady(true, scriptUrl);
      window.clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`Failed to load ONLYOFFICE API from ${scriptUrl}`));
    };
    document.head.appendChild(script);
  });
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

  const setStatus = useUiStore.getState().setStatus;

  const pull = async () => {
    try {
      const stats = await invoke<RelayStats>("get_onlyoffice_relay_stats");
      const count = Number(stats.callback_count || 0);
      const status = stats.last_status ?? "-";
      const commitMethod = stats.last_commit_method ?? "-";
      const saveStatus = stats.last_save_status ?? "-";
      const saveUpstream = stats.last_save_upstream_status ?? "-";
      const saveCommitMethod = stats.last_save_commit_method ?? "-";
      const saveUpstreamBody = typeof stats.last_save_upstream_body === "string" ? stats.last_save_upstream_body : "";
      const upstreamBody = typeof stats.last_upstream_body === "string" ? stats.last_upstream_body : "";

      if (stats.last_error) {
        setStatus(`relay error: ${stats.last_error}`);
      } else if (stats.last_save_error) {
        setStatus(`relay save error: ${stats.last_save_error}`);
      } else {
        setStatus(
          `relay callbacks: ${count} | callback status: ${status} | save status: ${saveStatus} | save upstream: ${saveUpstream} | save commit: ${saveCommitMethod}`,
        );

        const lastSeen = usePreviewEditStore.getState().onlyofficeRelayLastSeenCount;
        if (count > lastSeen) {
          usePreviewEditStore.getState().setOnlyofficeRelayLastSeenCount(count);
          if (saveStatus === 6 || saveStatus === 2) {
            setStatus("ONLYOFFICE save callback received, syncing...");
            await syncRemoteDelta();
            const activeFileId = usePreviewEditStore.getState().onlyofficeActiveFileId;
            if (activeFileId) {
              try {
                const versionToken = getPreferredUploadToken() || getAuthToken();
                if (!versionToken) throw new Error("missing token for version check");
                const versions = await listVersions(versionToken, activeFileId);
                const newCount = Array.isArray(versions) ? versions.length : 0;
                const baseline = usePreviewEditStore.getState().onlyofficeBaselineVersionCount;
                if (newCount > baseline) {
                  usePreviewEditStore.getState().setOnlyofficeBaselineVersionCount(newCount);
                  setStatus(`ONLYOFFICE save synced (${newCount} versions)`);
                } else {
                  const upstreamSummary = saveUpstreamBody
                    ? ` | upstream body: ${saveUpstreamBody.slice(0, 120)}`
                    : upstreamBody
                      ? ` | upstream body: ${upstreamBody.slice(0, 120)}`
                      : "";
                  const methodSummary =
                    saveCommitMethod && saveCommitMethod !== "-"
                      ? ` | commit: ${saveCommitMethod}`
                      : commitMethod
                        ? ` | commit: ${commitMethod}`
                        : "";
                  setStatus(`ONLYOFFICE callback received but no new version was created${methodSummary}${upstreamSummary}`);
                }
              } catch (err) {
                setStatus(`ONLYOFFICE save sync check failed: ${String(err)}`);
              }
            } else {
              setStatus("ONLYOFFICE save synced to desktop");
            }
          } else {
            const method = saveCommitMethod && saveCommitMethod !== "-" ? saveCommitMethod : commitMethod;
            if (method === "skipped_file_not_found_callback" || method === "skipped_non_vault_key") {
              setStatus("ONLYOFFICE print/export callback acknowledged");
            } else if (status === 1) {
              setStatus("ONLYOFFICE session callback received");
            } else if (status === 4) {
              setStatus("ONLYOFFICE session closed callback received");
            } else if (status === 7) {
              setStatus("ONLYOFFICE force-save error callback received");
            } else {
              setStatus(`ONLYOFFICE callback received (status ${status})`);
            }
          }
        }
      }
    } catch (err) {
      useUiStore.getState().setStatus(`relay stats failed: ${String(err)}`);
    }
  };

  await pull();
  const timerId = window.setInterval(() => { void pull(); }, RELAY_POLL_INTERVAL_MS);
  usePreviewEditStore.getState().setOnlyofficeRelayPollTimer(timerId);
}

// ---------------------------------------------------------------------------
// Editor launch
// ---------------------------------------------------------------------------

export async function launchOnlyofficeEditor(fileId: string): Promise<void> {
  const item = useFilesStore.getState().items.find((x) => x.id === fileId);
  const setStatus = useUiStore.getState().setStatus;

  if (!item) {
    setStatus("ONLYOFFICE launch failed: item not found");
    return;
  }

  setStatus("opening ONLYOFFICE...");

  try {
    usePreviewEditStore.getState().setOnlyofficeActiveFileId(fileId);

    // Capture baseline version count
    try {
      const versionToken = getPreferredUploadToken() || getAuthToken();
      if (!versionToken) throw new Error("missing token for version baseline");
      const versions = await listVersions(versionToken, fileId);
      usePreviewEditStore.getState().setOnlyofficeBaselineVersionCount(Array.isArray(versions) ? versions.length : 0);
    } catch {
      usePreviewEditStore.getState().setOnlyofficeBaselineVersionCount(0);
    }

    // Request editor session from server
    const payload = await invokeBase44Function<Record<string, unknown>>("onlyofficeEditorSession", {
      fileId,
      mode: "edit",
      device_id: "easyvault-desktop-mac",
    });

    const editorNode = (payload.editor as Record<string, unknown> | undefined) || payload;
    let documentServerUrl =
      asString(editorNode.document_server_url) ||
      asString(payload.document_server_url) ||
      "http://host.docker.internal";
    if (documentServerUrl.includes("host.docker.internal")) {
      documentServerUrl = documentServerUrl.replace("host.docker.internal", "localhost");
    }

    const editorConfigRaw =
      (editorNode.editor as Record<string, unknown> | undefined) ||
      (editorNode.config as Record<string, unknown> | undefined) ||
      editorNode;
    const editorConfigNormalized = rewriteOnlyofficeCallbackUrls(editorConfigRaw) as Record<string, unknown>;

    // Force correct document type from local metadata
    const fileExt = (item.fileExtension || extOf(item.title || "")).replace(/^\./, "").toLowerCase();
    const documentType = onlyofficeDocumentTypeForExt(fileExt);
    const normalizedDocument = (editorConfigNormalized.document as Record<string, unknown> | undefined) || {};
    if (fileExt) {
      normalizedDocument.fileType = fileExt;
    }
    editorConfigNormalized.document = normalizedDocument;
    editorConfigNormalized.documentType = documentType;

    const containerCallbackUrl = usePreviewEditStore.getState().onlyofficeRelayContainerCallbackUrl;
    const normalizedEditorConfig = (editorConfigNormalized.editorConfig as Record<string, unknown> | undefined) || {};
    normalizedEditorConfig.callbackUrl = containerCallbackUrl;
    editorConfigNormalized.editorConfig = normalizedEditorConfig;

    // Sign JWT
    const localOnlyofficeJwtSecret =
      (getOnlyofficeJwtSecret() || ONLYOFFICE_LOCAL_JWT_SECRET_FALLBACK).trim();
    if (localOnlyofficeJwtSecret) {
      editorConfigNormalized.token = await signOnlyofficeConfigToken(editorConfigNormalized, localOnlyofficeJwtSecret);
    }

    setStatus(`ONLYOFFICE: loading API from ${documentServerUrl}`);
    await ensureOnlyofficeApi(documentServerUrl);
    setStatus("ONLYOFFICE: API loaded");

    // Find the host element created by the adapter in the modal body.
    // Fall back to appending to document.body if opened outside a modal.
    let hostEl = document.getElementById("onlyoffice-editor-host");
    if (!hostEl) {
      hostEl = document.createElement("div");
      hostEl.id = "onlyoffice-editor-host";
      hostEl.className = "onlyoffice-host";
      hostEl.style.cssText = "height:100%;width:100%;min-height:600px;";
      document.body.appendChild(hostEl);
    }

    // Destroy any previous editor
    const prev = usePreviewEditStore.getState().onlyofficeEditorInstance;
    if (prev?.destroy) {
      try { prev.destroy(); } catch { /* ignore */ }
    }

    const DocsAPI = (window as unknown as { DocsAPI?: { DocEditor: new (id: string, config: unknown) => { destroy?: () => void } } }).DocsAPI;
    if (!DocsAPI?.DocEditor) {
      throw new Error("ONLYOFFICE API is not available");
    }

    const normalizedEditorConfigForUi = (editorConfigNormalized.editorConfig as Record<string, unknown> | undefined) || {};
    const normalizedCustomization = (normalizedEditorConfigForUi.customization as Record<string, unknown> | undefined) || {};

    setStatus(`ONLYOFFICE: callback via relay ${asString(normalizedEditorConfigForUi.callbackUrl) || containerCallbackUrl}`);

    const editorConfig = {
      ...editorConfigNormalized,
      width: "100%",
      height: "100%",
      editorConfig: {
        ...normalizedEditorConfigForUi,
        customization: {
          ...normalizedCustomization,
          forcesave: true,
        },
      },
      events: {
        ...(editorConfigNormalized.events as Record<string, unknown> | undefined),
        onAppReady: () => setStatus(`ONLYOFFICE ready: ${item.title}`),
        onDocumentStateChange: (evt: { data?: boolean }) => {
          if (evt?.data) setStatus("document changed (unsaved)");
          else setStatus("document state clean");
        },
        onRequestPrint: () => setStatus("ONLYOFFICE print requested..."),
        onError: (evt: { data?: { errorDescription?: string } }) =>
          setStatus(`ONLYOFFICE error: ${evt?.data?.errorDescription || "unknown"}`),
        onRequestClose: () => {
          setStatus("ONLYOFFICE editor closed");
          stopOnlyofficeRelayPolling();
          void syncRemoteDelta();
        },
      },
    };

    setStatus("ONLYOFFICE: creating editor");
    const editorInstance = new DocsAPI.DocEditor("onlyoffice-editor-host", editorConfig);
    usePreviewEditStore.getState().setOnlyofficeEditor(editorInstance);

    // Force relayout for ONLYOFFICE inside modals
    window.setTimeout(() => { window.dispatchEvent(new Event("resize")); }, 50);
    window.setTimeout(() => { window.dispatchEvent(new Event("resize")); }, 250);

    setStatus("ONLYOFFICE: editor mounted");
    await startOnlyofficeRelayPolling();
  } catch (err) {
    setStatus(`ONLYOFFICE launch failed: ${String(err)}`);
  }
}
