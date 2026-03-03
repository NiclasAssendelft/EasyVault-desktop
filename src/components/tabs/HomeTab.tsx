import { useMemo } from "react";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useQueueStore } from "../../stores/queueStore";
import { asString } from "../../services/helpers";
import { getWatchEnabled, getWatchFolder } from "../../storage";

export default function HomeTab() {
  const items = useFilesStore((s) => s.items);
  const currentFile = useUiStore((s) => s.currentFile);
  const lastSync = useUiStore((s) => s.lastSync);
  const events = useRemoteDataStore((s) => s.events);
  const queueItems = useQueueStore((s) => s.items);

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
        <h1>Good afternoon</h1>
        <p>Here is what needs your attention today</p>
      </div>
      <div className="dashboard-grid">
        <article className="dash-card">
          <div className="dash-head">
            <h4>Pinned</h4>
            <span>Desktop</span>
          </div>
          <p>{pinnedCount} pinned item{pinnedCount !== 1 ? "s" : ""}</p>
          <p>Current file: {currentFile}</p>
        </article>

        <article className="dash-card">
          <div className="dash-head">
            <h4>Upcoming meetings</h4>
            <span>Next 24h</span>
          </div>
          <p>{upcomingCount} upcoming event{upcomingCount !== 1 ? "s" : ""}</p>
          <p>Last sync: {lastSync}</p>
        </article>

        <article className="dash-card">
          <div className="dash-head">
            <h4>Import queue</h4>
            <span>Queue</span>
          </div>
          <p>
            Total: {queueTotal} | Active: {queueActive} | Failed: {queueFailed}{" "}
            | Done: {queueDone}
          </p>
        </article>

        <article className="dash-card">
          <div className="dash-head">
            <h4>Import watcher</h4>
            <span>Dropzone</span>
          </div>
          <p>Watch folder: {watchEnabled ? "enabled" : "disabled"}</p>
          {watchFolder && <p>{watchFolder}</p>}
        </article>
      </div>
    </section>
  );
}
