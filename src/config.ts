// Backend toggle: "supabase" or "base44"
export const BACKEND: "supabase" | "base44" = "supabase";

// Supabase
export const SUPABASE_URL = "https://ocokoemfmdodzftqbjim.supabase.co";
export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jb2tvZW1mbWRvZHpmdHFiamltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTA2NjgsImV4cCI6MjA4ODE4NjY2OH0.YQPrNUVDCgIDYP5054PoRdnDyph70gPcNJZSlHjbUH8";

// Base44 (legacy — used as fallback for unmigrated functions)
export const APP_ID = "69970fbb1f1de2b0bede99df";
export const BASE_URL = "https://ceo-vault.base44.app/api/functions";
export const APP_API_BASE_URL = `https://ceo-vault.base44.app/api/apps/${APP_ID}`;

export const LOGIN_URL = `https://ceo-vault.base44.app/api/apps/${APP_ID}/auth/login`;
export const CHECKOUT_FUNCTION_URL = `${BASE_URL}/fileCheckout`;
export const FILE_LOCK_FUNCTION_URL = `${BASE_URL}/fileLock`;
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
  onlyofficeServerUrl: "easyvault_onlyoffice_server_url",
  locale: "easyvault_locale",
} as const;

export const DEFAULT_API_KEY = "830e035bb5ad402a9534f1ac08cf2dc6";
export const CHUNK_SIZE = 5 * 1024 * 1024;
export const WATCH_INTERVAL_MS = 1500;
export const WATCH_DEBOUNCE_MS = 2000;
export const WATCH_FOLDER_POLL_MS = 4000;
export const IMPORT_MAX_RETRIES = 5;
