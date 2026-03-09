import { DEFAULT_API_KEY, STORAGE_KEYS } from "./config";

export function getApiKey(): string {
  return localStorage.getItem(STORAGE_KEYS.apiKey) || DEFAULT_API_KEY;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.authToken);
}

export function getExtensionToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.extensionToken);
}

export function getPreferredUploadToken(): string | null {
  return getExtensionToken() || getAuthToken();
}

export function getSavedEmail(): string {
  return localStorage.getItem(STORAGE_KEYS.email) || "";
}

export function saveSettings(apiKey: string, extensionToken: string): void {
  if (apiKey) {
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
  }

  if (extensionToken) {
    localStorage.setItem(STORAGE_KEYS.extensionToken, extensionToken);
  } else {
    localStorage.removeItem(STORAGE_KEYS.extensionToken);
  }
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.refreshToken);
}

export function saveLogin(accessToken: string, email: string, refreshToken?: string): void {
  localStorage.setItem(STORAGE_KEYS.authToken, accessToken);
  localStorage.setItem(STORAGE_KEYS.email, email);
  if (refreshToken) {
    localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken);
  }
}

export function clearLogin(): void {
  localStorage.removeItem(STORAGE_KEYS.authToken);
  localStorage.removeItem(STORAGE_KEYS.refreshToken);
}

export function getWatchEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.watchEnabled) === "true";
}

export function setWatchEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.watchEnabled, String(enabled));
}

export function getWatchFolder(): string {
  return localStorage.getItem(STORAGE_KEYS.watchFolder) || "";
}

export function setWatchFolder(path: string): void {
  localStorage.setItem(STORAGE_KEYS.watchFolder, path);
}

export function getUploadedWatchSignatures(): Set<string> {
  const raw = localStorage.getItem(STORAGE_KEYS.uploadedWatchSignatures);
  if (!raw) return new Set<string>();
  try {
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set<string>();
  }
}

export function saveUploadedWatchSignatures(signatures: Set<string>): void {
  localStorage.setItem(STORAGE_KEYS.uploadedWatchSignatures, JSON.stringify(Array.from(signatures)));
}

export function getOnlyofficeJwtSecret(): string {
  return localStorage.getItem(STORAGE_KEYS.onlyofficeJwtSecret) || "ev-oo-jwt-8491fda228f7c788ae2ee056155bbcd0";
}

export function setOnlyofficeJwtSecret(secret: string): void {
  if (secret) {
    localStorage.setItem(STORAGE_KEYS.onlyofficeJwtSecret, secret);
  } else {
    localStorage.removeItem(STORAGE_KEYS.onlyofficeJwtSecret);
  }
}

export function getOnlyofficeServerUrl(): string {
  return localStorage.getItem(STORAGE_KEYS.onlyofficeServerUrl) || "http://89.167.67.171:8080";
}

export function setOnlyofficeServerUrl(url: string): void {
  if (url) {
    localStorage.setItem(STORAGE_KEYS.onlyofficeServerUrl, url);
  } else {
    localStorage.removeItem(STORAGE_KEYS.onlyofficeServerUrl);
  }
}

export function getDeviceId(): string {
  let id = localStorage.getItem(STORAGE_KEYS.deviceId);
  if (!id) {
    id = `ev-${crypto.randomUUID()}`;
    localStorage.setItem(STORAGE_KEYS.deviceId, id);
  }
  return id;
}

export function getEmailSyncCount(): number {
  const raw = localStorage.getItem(STORAGE_KEYS.emailSyncCount);
  const n = Number(raw);
  return n > 0 ? n : 50;
}

export function setEmailSyncCount(count: number): void {
  localStorage.setItem(STORAGE_KEYS.emailSyncCount, String(count));
}
