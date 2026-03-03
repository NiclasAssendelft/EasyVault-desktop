export const APP_ID = "69970fbb1f1de2b0bede99df";
export const BASE_URL = "https://ceo-vault.base44.app/api/functions";
export const APP_API_BASE_URL = `https://easy-vault.com/api/apps/${APP_ID}`;

export const LOGIN_URL = `https://easy-vault.com/api/apps/${APP_ID}/auth/login`;
export const CHECKOUT_FUNCTION_URL = `${BASE_URL}/fileCheckout`;
export const FILE_LOCK_FUNCTION_URL = `${BASE_URL}/fileLock`;
export const FILE_RESTORE_FUNCTION_URL = `${BASE_URL}/fileRestore`;
export const UPLOAD_INIT_URL = `${BASE_URL}/extensionUploadInit`;
export const UPLOAD_CHUNK_URL = `${BASE_URL}/extensionUploadChunk`;
export const UPLOAD_COMPLETE_URL = `${BASE_URL}/extensionUploadComplete`;
export const FILE_VERSIONS_FUNCTION_URL = `${BASE_URL}/fileVersions`;

export const STORAGE_KEYS = {
  apiKey: "easyvault_api_key",
  extensionToken: "easyvault_extension_token",
  authToken: "easyvault_token",
  email: "easyvault_email",
  watchEnabled: "easyvault_watch_enabled",
  watchFolder: "easyvault_watch_folder",
  uploadedWatchSignatures: "easyvault_uploaded_watch_signatures",
  onlyofficeJwtSecret: "easyvault_onlyoffice_jwt_secret",
} as const;

export const DEFAULT_API_KEY = "830e035bb5ad402a9534f1ac08cf2dc6";
export const CHUNK_SIZE = 5 * 1024 * 1024;
export const WATCH_INTERVAL_MS = 1500;
export const WATCH_DEBOUNCE_MS = 2000;
export const WATCH_FOLDER_POLL_MS = 4000;
export const IMPORT_MAX_RETRIES = 5;
