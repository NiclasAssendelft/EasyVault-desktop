import { useMemo } from "react";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useQueueStore } from "../../stores/queueStore";
import { asString } from "../../services/helpers";
import { getWatchEnabled, getWatchFolder } from "../../storage";
import { useT } from "../../i18n";

export default function HomeTab() {
  const items = useFilesStore((s) => s.items);
  const currentFile = useUiStore((s) => s.currentFile);
  const lastSync = useUiStore((s) => s.lastSync);
  const events = useRemoteDataStore((s) => s.events);
  const queueItems = useQueueStore((s) => s.items);
  const t = useT();

  const pinnedCount = useMemo(
    () => items.filter((i) => i.isPinned).length,
    [items],
  );

  const upcomingCount = useMemo(() => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return events.filter((e) => {
      const startTime = asString(e.start_time);
      return startTime >= cutoff;
    }).length;
  }, [events]);

  const queueTotal = queueItems.length;
  const queueActive = queueItems.filter(
    (i) => i.status === "uploading" || i.status === "retrying",
  ).length;
  const queueFailed = queueItems.filter((i) => i.status === "failed").length;
  const queueDone = queueItems.filter((i) => i.status === "done").length;

  const watchEnabled = getWatchEnabled();
  const watchFolder = getWatchFolder();

  return (
    <section className="tab-panel">
      <div className="home-hero">
        <h1>{t("home.greeting")}</h1>
        <p>{t("home.subtitle")}</p>
      </div>
      <div className="dashboard-grid">
        <article className="dash-card">
          <div className="dash-head">
            <h4>{t("home.pinned")}</h4>
            <span>{t("home.desktop")}</span>
          </div>
          <p>{t("home.pinnedItems", { count: pinnedCount })}</p>
          <p>{t("home.currentFile", { name: currentFile })}</p>
        </article>

        <article className="dash-card">
          <div className="dash-head">
            <h4>{t("home.upcomingMeetings")}</h4>
            <span>{t("home.next24h")}</span>
          </div>
          <p>{t("home.upcomingEvents", { count: upcomingCount })}</p>
          <p>{t("home.lastSync", { time: lastSync })}</p>
        </article>

        <article className="dash-card">
          <div className="dash-head">
            <h4>{t("home.importQueue")}</h4>
            <span>{t("home.queue")}</span>
          </div>
          <p>
            {t("home.total", { total: queueTotal })} | {t("home.active", { active: queueActive })} | {t("home.failed", { failed: queueFailed })}{" "}
            | {t("home.done", { done: queueDone })}
          </p>
        </article>

        <article className="dash-card">
          <div className="dash-head">
            <h4>{t("home.importWatcher")}</h4>
            <span>{t("home.dropzone")}</span>
          </div>
          <p>{watchEnabled ? t("home.watchEnabled") : t("home.watchDisabled")}</p>
          {watchFolder && <p>{watchFolder}</p>}
        </article>
      </div>
    </section>
  );
}
