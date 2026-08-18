import { getSavedEmail } from "../../../storage";

const AVATAR_COLORS = [
  "#2563eb", "#7c3aed", "#db2777", "#ea580c",
  "#0891b2", "#059669", "#d97706", "#4f46e5",
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name[0] || "?").toUpperCase();
}

export function formatChatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatActivityTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function currentUserEmail(): string {
  return getSavedEmail().trim().toLowerCase();
}

/**
 * Accepts either a bare invite code or a full invite URL
 * (e.g. `https://…/functions/v1/invite/<token>` or `easyvault://invite/<token>`)
 * and returns the 48-hex token. Falls back to the trimmed input so plain
 * pasted codes keep working unchanged.
 */
export function extractInviteToken(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/invite\/([0-9a-f]{48})/i);
  if (match) return match[1].toLowerCase();
  return trimmed;
}

/** Copy text via the async clipboard API, with a textarea fallback for the Tauri WebView. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px";
      document.body.appendChild(el);
      el.focus();
      el.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(el);
      return copied;
    } catch {
      return false;
    }
  }
}

/** Locale-aware date for invite-link expiry display. */
export function formatExpiryDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
