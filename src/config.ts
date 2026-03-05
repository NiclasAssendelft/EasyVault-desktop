// Supabase
export const SUPABASE_URL = "https://ocokoemfmdodzftqbjim.supabase.co";
export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jb2tvZW1mbWRvZHpmdHFiamltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTA2NjgsImV4cCI6MjA4ODE4NjY2OH0.YQPrNUVDCgIDYP5054PoRdnDyph70gPcNJZSlHjbUH8";

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
  emailSyncCount: "easyvault_email_sync_count",
  refreshToken: "easyvault_refresh_token",
  deviceId: "easyvault_device_id",
} as const;

export const DEFAULT_API_KEY = "830e035bb5ad402a9534f1ac08cf2dc6";
export const CHUNK_SIZE = 5 * 1024 * 1024;
export const WATCH_INTERVAL_MS = 1500;
export const WATCH_DEBOUNCE_MS = 2000;
export const WATCH_FOLDER_POLL_MS = 4000;
export const IMPORT_MAX_RETRIES = 5;
