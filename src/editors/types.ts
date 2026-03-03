export type SupportedEditorKind = "pdf" | "image" | "office";

export type AdapterItem = {
  id: string;
  title: string;
  itemType: string;
  folderId: string;
  createdAtIso: string;
  updatedAtIso?: string;
  notes?: string;
  tags: string[];
  storedFileUrl?: string;
  sourceUrl?: string;
  localPath?: string;
  fileExtension?: string;
  contentText?: string;
  spaceId?: string;
  createdBy?: string;
};

export type AdapterRenderContext = {
  item: AdapterItem;
  bodyEl: HTMLDivElement;
  draft: Record<string, unknown>;
  setStatus: (text: string) => void;
  getPreviewUrl: (item: AdapterItem) => string;
  featureFlags: {
    nutrient: boolean;
    onlyoffice: boolean;
    pintura: boolean;
  };
};

export type AdapterSaveContext = {
  item: AdapterItem;
  draft: Record<string, unknown>;
  setStatus: (text: string) => void;
  getAuthToken: () => string;
  getUploadToken: () => string;
  checkoutFile: (fileId: string, requestToken: string) => Promise<{ download_url: string; edit_session_id: string }>;
  downloadFile: (url: string) => Promise<Uint8Array>;
  uploadFileWithToken: (token: string, filename: string, bytes: Uint8Array) => Promise<string>;
  createNewVersion: (session: {
    fileId: string;
    filename: string;
    localPath: string;
    editSessionId: string;
    authToken: string;
    extensionToken: string;
    lastModifiedMs: number;
    lastSize: number;
    intervalId: number | null;
    debounceId: number | null;
    uploading: boolean;
    queued: boolean;
  }, fileUrl: string, checksum: string) => Promise<void>;
  listVersions: (token: string, fileId: string) => Promise<Array<Record<string, unknown>>>;
  sha256Hex: (bytes: Uint8Array) => Promise<string>;
};

export type AdapterSaveResult = {
  ok: boolean;
  message?: string;
  updatedAtIso?: string;
  versionId?: string;
};

export interface EditorAdapter {
  kind: SupportedEditorKind;
  canEdit(item: AdapterItem): boolean;
  openPreview(ctx: AdapterRenderContext): void;
  openEditor(ctx: AdapterRenderContext): void;
  save(ctx: AdapterSaveContext): Promise<AdapterSaveResult>;
}
