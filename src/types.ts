export type FileStat = { modified_ms: number; size: number };

export type CheckoutPayload = {
  download_url?: string;
  edit_session_id?: string;
  lock_acquired?: boolean;
  file_metadata?: { name?: string };
};

export type ResolvedCheckout = {
  download_url: string;
  edit_session_id: string;
  lock_acquired?: boolean;
  file_metadata: { name: string };
};

export type ActiveEditSession = {
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
};

export type UiCallbacks = {
  onStatus: (text: string) => void;
  onResult: (payload: unknown) => void;
  onCurrentFile: (text: string) => void;
  onLastSync: (text: string) => void;
};

export type LocalFolderFile = {
  path: string;
  name: string;
  size: number;
  modified_ms: number;
};

export type ImportQueueStatus = "queued" | "uploading" | "retrying" | "done" | "failed";

export type ImportQueueItem = {
  id: string;
  signature: string;
  sourcePath: string;
  filename: string;
  status: ImportQueueStatus;
  attempts: number;
  progress: number;
  error?: string;
  createdAtIso: string;
  finishedAtIso?: string;
};
