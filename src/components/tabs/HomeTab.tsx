import { useMemo, useCallback } from "react";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useQueueStore } from "../../stores/queueStore";
import { asString, asBool } from "../../services/helpers";
import { useT } from "../../i18n";

export default function HomeTab() {
  const items = useFilesStore((s) => s.items);
  const folders = useFilesStore((s) => s.folders);
  const events = useRemoteDataStore((s) => s.events);
  const emails = useRemoteDataStore((s) => s.emails);
  const spaces = useRemoteDataStore((s) => s.spaces);
  const packs = useRemoteDataStore((s) => s.packs);
  const queueItems = useQueueStore((s) => s.items);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const t = useT();

  const recentFile = useMemo(() => {
    if (items.length === 0) return null;
    const sorted = [...items].sort((a, b) => {
      const aDate = a.updatedAtIso || a.createdAtIso || "";
      const bDate = b.updatedAtIso || b.createdAtIso || "";
      return bDate.localeCompare(aDate);
    });
    return sorted[0];
  }, [items]);

  const unreadCount = useMemo(() => {
    return emails.filter((e) => asBool(e.is_unread)).length;
  }, [emails]);

  const nextEvent = useMemo(() => {
    const now = new Date().toISOString();
    const upcoming = events
      .filter((e) => asString(e.start_time) >= now)
      .sort((a, b) => asString(a.start_time).localeCompare(asString(b.start_time)));
    return upcoming[0] || null;
  }, [events]);

  const goTo = useCallback((tab: "files" | "email" | "calendar" | "shared" | "vault" | "queue") => {
    setActiveTab(tab);
  }, [setActiveTab]);

  const queueActive = queueItems.filter(
    (i) => i.status === "uploading" || i.status === "retrying",
  ).length;

  return (
    <section className="tab-panel">
      <div className="home-hero">
        <h1>{t("home.greeting")}</h1>
        <p>{t("home.subtitle")}</p>
      </div>

      <div className="home-dashboard-grid">
        {/* Files */}
        <article className="home-card-clickable" onClick={() => goTo("files")}>
          <div className="home-card-icon">{"\uD83D\uDCC1"}</div>
          <h4 className="home-card-title">{t("home.files")}</h4>
          <p className="home-card-stat">
            {t("home.fileCount", { count: items.length })} &middot; {t("home.folders", { count: folders.length })}
          </p>
          <p className="home-card-detail">
            {recentFile ? t("home.recentFile", { name: recentFile.title }) : t("home.noRecentFile")}
          </p>
        </article>

        {/* Email */}
        <article className="home-card-clickable" onClick={() => goTo("email")}>
          <div className="home-card-icon">{"\u2709\uFE0F"}</div>
          <h4 className="home-card-title">{t("home.emails")}</h4>
          <p className="home-card-stat">
            {t("home.emailCount", { count: emails.length })}
          </p>
          <p className="home-card-detail">
            {unreadCount > 0 ? t("home.unread", { count: unreadCount }) : ""}
          </p>
        </article>

        {/* Calendar */}
        <article className="home-card-clickable" onClick={() => goTo("calendar")}>
          <div className="home-card-icon">{"\uD83D\uDCC5"}</div>
          <h4 className="home-card-title">{t("home.calendar")}</h4>
          <p className="home-card-stat">{t("home.eventCount", { count: events.length })}</p>
          <p className="home-card-detail">
            {nextEvent
              ? t("home.nextEvent", { title: asString(nextEvent.title, "—") })
              : t("home.noUpcoming")}
          </p>
        </article>

        {/* Shared Spaces */}
        <article className="home-card-clickable" onClick={() => goTo("shared")}>
          <div className="home-card-icon">{"\uD83D\uDC65"}</div>
          <h4 className="home-card-title">{t("home.spaces")}</h4>
          <p className="home-card-stat">{t("home.spaceCount", { count: spaces.length })}</p>
        </article>

        {/* Gather Packs */}
        <article className="home-card-clickable" onClick={() => goTo("vault")}>
          <div className="home-card-icon">{"\uD83D\uDCE6"}</div>
          <h4 className="home-card-title">{t("home.gatherPacks")}</h4>
          <p className="home-card-stat">{t("home.packCount", { count: packs.length })}</p>
        </article>

        {/* Import Queue */}
        <article className="home-card-clickable" onClick={() => goTo("queue")}>
          <div className="home-card-icon">{"\u2B07\uFE0F"}</div>
          <h4 className="home-card-title">{t("home.importQueue")}</h4>
          <p className="home-card-stat">
            {t("home.total", { total: queueItems.length })} &middot; {t("home.active", { active: queueActive })}
          </p>
        </article>
      </div>

      <div className="home-quick-actions">
        <h4 className="section-label" style={{ width: "100%", marginBottom: 0 }}>{t("home.quickActions")}</h4>
        <button type="button" onClick={() => goTo("files")}>{t("home.goToFiles")}</button>
        <button type="button" onClick={() => goTo("email")}>{t("home.goToEmail")}</button>
        <button type="button" onClick={() => goTo("calendar")}>{t("home.goToCalendar")}</button>
        <button type="button" onClick={() => goTo("shared")}>{t("home.goToShared")}</button>
        <button type="button" onClick={() => goTo("vault")}>{t("home.goToVault")}</button>
      </div>
    </section>
  );
}
