import { create } from "zustand";
import type { PreviewKind, PreviewMode } from "../services/helpers";

interface PreviewEditState {
  targetId: string;
  mode: PreviewMode;
  kind: PreviewKind;
  saving: boolean;
  canEdit: boolean;
  noteDraft: string;
  linkUrlDraft: string;
  linkNotesDraft: string;
  imageRotation: number;
  imageBrightness: number;
  imageObjectUrl: string;
  // ONLYOFFICE
  onlyofficeEditorInstance: { destroy?: () => void } | null;
  onlyofficeApiReady: boolean;
  onlyofficeApiScriptUrl: string;
  onlyofficeRelayContainerCallbackUrl: string;
  onlyofficeRelayHostCallbackUrl: string;
  onlyofficeRelayPollTimer: number | null;
  onlyofficeRelayLastSeenCount: number;
  onlyofficeActiveFileId: string;
  onlyofficeBaselineVersionCount: number;
  // Actions
  open: (targetId: string, mode: PreviewMode, kind: PreviewKind, canEdit: boolean, drafts: {
    noteDraft?: string;
    linkUrlDraft?: string;
    linkNotesDraft?: string;
  }) => void;
  close: () => void;
  setMode: (mode: PreviewMode) => void;
  setSaving: (saving: boolean) => void;
  setNoteDraft: (text: string) => void;
  setLinkUrlDraft: (text: string) => void;
  setLinkNotesDraft: (text: string) => void;
  setImageRotation: (deg: number) => void;
  setImageBrightness: (pct: number) => void;
  setOnlyofficeEditor: (instance: { destroy?: () => void } | null) => void;
  setOnlyofficeApiReady: (ready: boolean, scriptUrl?: string) => void;
  setOnlyofficeRelayUrls: (container: string, host: string) => void;
  setOnlyofficeRelayPollTimer: (id: number | null) => void;
  setOnlyofficeRelayLastSeenCount: (count: number) => void;
  setOnlyofficeActiveFileId: (fileId: string) => void;
  setOnlyofficeBaselineVersionCount: (count: number) => void;
}

const INITIAL_STATE = {
  targetId: "",
  mode: "preview" as PreviewMode,
  kind: "other" as PreviewKind,
  saving: false,
  canEdit: false,
  noteDraft: "",
  linkUrlDraft: "",
  linkNotesDraft: "",
  imageRotation: 0,
  imageBrightness: 100,
  imageObjectUrl: "",
};

export const usePreviewEditStore = create<PreviewEditState>((set, get) => ({
  ...INITIAL_STATE,
  onlyofficeEditorInstance: null,
  onlyofficeApiReady: false,
  onlyofficeApiScriptUrl: "",
  onlyofficeRelayContainerCallbackUrl: "http://host.docker.internal:17171/onlyoffice-callback",
  onlyofficeRelayHostCallbackUrl: "http://localhost:17171/onlyoffice-callback",
  onlyofficeRelayPollTimer: null,
  onlyofficeRelayLastSeenCount: 0,
  onlyofficeActiveFileId: "",
  onlyofficeBaselineVersionCount: 0,
  open: (targetId, mode, kind, canEdit, drafts) =>
    set({
      targetId,
      mode,
      kind,
      canEdit,
      saving: false,
      noteDraft: drafts.noteDraft || "",
      linkUrlDraft: drafts.linkUrlDraft || "",
      linkNotesDraft: drafts.linkNotesDraft || "",
      imageRotation: 0,
      imageBrightness: 100,
    }),
  close: () => {
    const { imageObjectUrl, onlyofficeEditorInstance, onlyofficeRelayPollTimer } = get();
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    if (onlyofficeRelayPollTimer !== null) window.clearInterval(onlyofficeRelayPollTimer);
    if (onlyofficeEditorInstance?.destroy) {
      try { onlyofficeEditorInstance.destroy(); } catch {}
    }
    set({
      ...INITIAL_STATE,
      onlyofficeEditorInstance: null,
      onlyofficeRelayPollTimer: null,
      onlyofficeRelayLastSeenCount: 0,
      onlyofficeActiveFileId: "",
      onlyofficeBaselineVersionCount: 0,
    });
  },
  setMode: (mode) => set({ mode }),
  setSaving: (saving) => set({ saving }),
  setNoteDraft: (text) => set({ noteDraft: text }),
  setLinkUrlDraft: (text) => set({ linkUrlDraft: text }),
  setLinkNotesDraft: (text) => set({ linkNotesDraft: text }),
  setImageRotation: (deg) => set({ imageRotation: deg }),
  setImageBrightness: (pct) => set({ imageBrightness: pct }),
  setOnlyofficeEditor: (instance) => set({ onlyofficeEditorInstance: instance }),
  setOnlyofficeApiReady: (ready, scriptUrl) =>
    set({ onlyofficeApiReady: ready, ...(scriptUrl ? { onlyofficeApiScriptUrl: scriptUrl } : {}) }),
  setOnlyofficeRelayUrls: (container, host) =>
    set({ onlyofficeRelayContainerCallbackUrl: container, onlyofficeRelayHostCallbackUrl: host }),
  setOnlyofficeRelayPollTimer: (id) => set({ onlyofficeRelayPollTimer: id }),
  setOnlyofficeRelayLastSeenCount: (count) => set({ onlyofficeRelayLastSeenCount: count }),
  setOnlyofficeActiveFileId: (fileId) => set({ onlyofficeActiveFileId: fileId }),
  setOnlyofficeBaselineVersionCount: (count) => set({ onlyofficeBaselineVersionCount: count }),
}));
