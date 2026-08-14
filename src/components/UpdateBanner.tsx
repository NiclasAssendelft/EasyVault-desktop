import { useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useUpdateStore } from "../stores/updateStore";
import { useT } from "../i18n";

const RELEASES_URL = "https://github.com/NiclasAssendelft/EasyVault-desktop/releases/latest";

async function detectCpuArch(): Promise<string> {
  try {
    const arch = await invoke("get_cpu_arch");
    if (typeof arch === "string" && arch) return arch;
  } catch {
    // Command unavailable — fall back to UA sniffing below.
  }
  const ua = navigator.userAgent.toLowerCase();
  const uaArm = ua.includes("arm") || navigator.platform.toLowerCase().includes("arm");
  return uaArm ? "aarch64" : "x86_64";
}

async function downloadUrlForPlatform(version: string): Promise<string> {
  const ua = navigator.userAgent.toLowerCase();
  const isMac = ua.includes("mac");
  const isWin = ua.includes("win");

  const base = `https://github.com/NiclasAssendelft/EasyVault-desktop/releases/download/v${version}`;
  if (isMac) {
    const arch = await detectCpuArch();
    return arch === "aarch64"
      ? `${base}/EasyVault_${version}_aarch64.dmg`
      : `${base}/EasyVault_${version}_x64.dmg`;
  }
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
  const t = useT();

  const handleManualDownload = useCallback(async () => {
    const url = availableVersion ? await downloadUrlForPlatform(availableVersion) : RELEASES_URL;
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
            <span className="update-banner-title">{t("update.availableTitle", { version: availableVersion })}</span>
            <span className="update-banner-sub">{t("update.availableSub")}</span>
          </>
        )}
        {status === "downloading" && (
          <>
            <span className="update-banner-title">{t("update.downloadingTitle", { version: availableVersion })}</span>
            <span className="update-banner-sub">
              {showProgress
                ? t("update.progress", { done: formatBytes(bytesDownloaded), total: formatBytes(bytesTotal), pct })
                : t("update.starting")}
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
            <span className="update-banner-title">{t("update.installingTitle")}</span>
            <span className="update-banner-sub">{t("update.installingSub")}</span>
          </>
        )}
        {status === "ready-restart" && (
          <>
            <span className="update-banner-title">{t("update.readyTitle", { version: availableVersion })}</span>
            <span className="update-banner-sub">{t("update.readySub")}</span>
          </>
        )}
        {status === "failed" && (
          <>
            <span className="update-banner-title">{t("update.failedTitle")}</span>
            <span className="update-banner-sub">{t("update.failedSub", { error: errorMessage || t("update.genericError") })}</span>
          </>
        )}
      </div>

      <div className="update-banner-actions">
        {status === "available" && (
          <>
            <button type="button" className="update-banner-btn primary" onClick={install}>{t("update.installNow")}</button>
            <button type="button" className="update-banner-btn" onClick={handleManualDownload}>{t("update.downloadInstaller")}</button>
            <button type="button" className="update-banner-btn ghost" onClick={dismiss} aria-label={t("update.dismiss")}>✕</button>
          </>
        )}
        {status === "ready-restart" && (
          <button type="button" className="update-banner-btn ghost" onClick={dismiss} aria-label={t("update.dismiss")}>✕</button>
        )}
        {status === "failed" && (
          <>
            <button type="button" className="update-banner-btn primary" onClick={handleManualDownload}>{t("update.downloadInstaller")}</button>
            <button type="button" className="update-banner-btn ghost" onClick={dismiss} aria-label={t("update.dismiss")}>✕</button>
          </>
        )}
      </div>
    </div>
  );
}
