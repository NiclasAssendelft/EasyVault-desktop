import { useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useUpdateStore } from "../stores/updateStore";

const RELEASES_URL = "https://github.com/NiclasAssendelft/EasyVault-desktop/releases/latest";

function downloadUrlForPlatform(version: string): string {
  const ua = navigator.userAgent.toLowerCase();
  const isMac = ua.includes("mac");
  const isWin = ua.includes("win");
  const isAppleSilicon =
    isMac && (ua.includes("arm") || (typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("arm")));

  const base = `https://github.com/NiclasAssendelft/EasyVault-desktop/releases/download/v${version}`;
  if (isMac && isAppleSilicon) return `${base}/EasyVault_${version}_aarch64.dmg`;
  if (isMac) return `${base}/EasyVault_${version}_x64.dmg`;
  if (isWin) return `${base}/EasyVault_${version}_x64-setup.exe`;
  return RELEASES_URL;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

export default function UpdateBanner() {
  const status = useUpdateStore((s) => s.status);
  const availableVersion = useUpdateStore((s) => s.availableVersion);
  const errorMessage = useUpdateStore((s) => s.errorMessage);
  const bytesDownloaded = useUpdateStore((s) => s.bytesDownloaded);
  const bytesTotal = useUpdateStore((s) => s.bytesTotal);
  const install = useUpdateStore((s) => s.install);
  const dismiss = useUpdateStore((s) => s.dismiss);

  const handleManualDownload = useCallback(async () => {
    const url = availableVersion ? downloadUrlForPlatform(availableVersion) : RELEASES_URL;
    try { await openUrl(url); } catch { window.open(url, "_blank"); }
  }, [availableVersion]);


  if (status === "idle" || status === "checking" || status === "up-to-date") return null;

  const showProgress = status === "downloading" && bytesTotal > 0;
  const pct = showProgress ? Math.min(100, Math.round((bytesDownloaded / bytesTotal) * 100)) : 0;

  return (
    <div className={`update-banner update-banner--${status}`} role="status" aria-live="polite">
      <span className="update-banner-icon" aria-hidden="true">
        {status === "ready-restart" ? "✓" : status === "failed" ? "!" : "↑"}
      </span>

      <div className="update-banner-body">
        {status === "available" && (
          <>
            <span className="update-banner-title">Update available — v{availableVersion}</span>
            <span className="update-banner-sub">Install in-place, or grab the installer manually.</span>
          </>
        )}
        {status === "downloading" && (
          <>
            <span className="update-banner-title">Downloading v{availableVersion}…</span>
            <span className="update-banner-sub">
              {showProgress
                ? `${formatBytes(bytesDownloaded)} of ${formatBytes(bytesTotal)} (${pct}%)`
                : "Starting…"}
            </span>
            {showProgress && (
              <div className="update-banner-progress" aria-hidden="true">
                <div className="update-banner-progress-fill" style={{ width: `${pct}%` }} />
              </div>
            )}
          </>
        )}
        {status === "installing" && (
          <>
            <span className="update-banner-title">Installing…</span>
            <span className="update-banner-sub">Don't quit EasyVault.</span>
          </>
        )}
        {status === "ready-restart" && (
          <>
            <span className="update-banner-title">v{availableVersion} installed</span>
            <span className="update-banner-sub">Restart EasyVault to start using the new version.</span>
          </>
        )}
        {status === "failed" && (
          <>
            <span className="update-banner-title">Auto-update couldn't finish</span>
            <span className="update-banner-sub">{errorMessage || "Something went wrong."} Download the installer manually instead.</span>
          </>
        )}
      </div>

      <div className="update-banner-actions">
        {status === "available" && (
          <>
            <button type="button" className="update-banner-btn primary" onClick={install}>Install now</button>
            <button type="button" className="update-banner-btn" onClick={handleManualDownload}>Download installer</button>
            <button type="button" className="update-banner-btn ghost" onClick={dismiss} aria-label="Dismiss">✕</button>
          </>
        )}
        {status === "ready-restart" && (
          <button type="button" className="update-banner-btn ghost" onClick={dismiss} aria-label="Dismiss">✕</button>
        )}
        {status === "failed" && (
          <>
            <button type="button" className="update-banner-btn primary" onClick={handleManualDownload}>Download installer</button>
            <button type="button" className="update-banner-btn ghost" onClick={dismiss} aria-label="Dismiss">✕</button>
          </>
        )}
      </div>
    </div>
  );
}
