import { useMemo, useCallback } from "react";
import { useFilesStore } from "../../stores/filesStore";
import { useUiStore } from "../../stores/uiStore";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { asString, asBool } from "../../services/helpers";
import { useT } from "../../i18n";

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDateShort(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function HomeTab() {
  const items = useFilesStore((s) => s.items);
  const events = useRemoteDataStore((s) => s.events);
  const emails = useRemoteDataStore((s) => s.emails);
  const spaces = useRemoteDataStore((s) => s.spaces);
  const packs = useRemoteDataStore((s) => s.packs);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const t = useT();

  // Today's schedule — events that start today
  const todayEvents = useMemo(() => {
    const now = new Date();
    return events
      .filter((e) => {
        const st = asString(e.start_time);
        if (!st) return false;
        return isSameDay(new Date(st), now);
      })
      .sort((a, b) => asString(a.start_time).localeCompare(asString(b.start_time)));
  }, [events]);

  // Pinned items
  const pinnedItems = useMemo(() => items.filter((i) => i.isPinned), [items]);

  // Upcoming meetings — next 7 days
  const upcomingMeetings = useMemo(() => {
    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nowIso = now.toISOString();
    const weekIso = weekLater.toISOString();
    return events
      .filter((e) => {
        const st = asString(e.start_time);
        return st >= nowIso && st <= weekIso;
      })
      .sort((a, b) => asString(a.start_time).localeCompare(asString(b.start_time)))
      .slice(0, 8);
  }, [events]);

  // Recent files — top 10 by updated_date
  const recentFiles = useMemo(() => {
    return [...items]
      .sort((a, b) => {
        const aDate = a.updatedAtIso || a.createdAtIso || "";
        const bDate = b.updatedAtIso || b.createdAtIso || "";
        return bDate.localeCompare(aDate);
      })
      .slice(0, 10);
  }, [items]);

  // Important emails
  const importantEmails = useMemo(() => {
    return emails
      .filter((e) => asBool(e.is_important))
      .sort((a, b) => asString(b.received_at, asString(b.created_date, "")).localeCompare(
        asString(a.received_at, asString(a.created_date, ""))
      ))
      .slice(0, 8);
  }, [emails]);

  const goTo = useCallback((tab: "files" | "email" | "calendar" | "shared" | "vault" | "queue") => {
    setActiveTab(tab);
  }, [setActiveTab]);

  return (
    <section className="tab-panel">
      <div className="home-hero">
        <h1>{t("home.greeting")}</h1>
      </div>

      {/* ── Navigation cards row ── */}
      <div className="home-nav-row">
        <div className="home-nav-card" onClick={() => goTo("files")}>
          <span className="home-nav-icon">{"\uD83D\uDCC1"}</span>
          <span className="home-nav-label">{t("home.files")}</span>
          <span className="home-nav-count">{items.length}</span>
        </div>
        <div className="home-nav-card" onClick={() => goTo("email")}>
          <span className="home-nav-icon">{"\u2709\uFE0F"}</span>
          <span className="home-nav-label">{t("home.emails")}</span>
          <span className="home-nav-count">{emails.length}</span>
        </div>
        <div className="home-nav-card" onClick={() => goTo("calendar")}>
          <span className="home-nav-icon">{"\uD83D\uDCC5"}</span>
          <span className="home-nav-label">{t("home.calendar")}</span>
          <span className="home-nav-count">{events.length}</span>
        </div>
        <div className="home-nav-card" onClick={() => goTo("shared")}>
          <span className="home-nav-icon">{"\uD83D\uDC65"}</span>
          <span className="home-nav-label">{t("home.spaces")}</span>
          <span className="home-nav-count">{spaces.length}</span>
        </div>
        <div className="home-nav-card" onClick={() => goTo("vault")}>
          <span className="home-nav-icon">{"\uD83D\uDCE6"}</span>
          <span className="home-nav-label">{t("home.gatherPacks")}</span>
          <span className="home-nav-count">{packs.length}</span>
        </div>
      </div>

      {/* ── Today's Schedule ── */}
      <div className="home-panel home-panel-wide">
        <div className="home-panel-head">
          <h3>{t("home.todaySchedule")}</h3>
          <button type="button" className="home-panel-link" onClick={() => goTo("calendar")}>{t("home.viewAll")}</button>
        </div>
        {todayEvents.length === 0 ? (
          <p className="home-panel-empty">{t("home.noSchedule")}</p>
        ) : (
          <div className="home-schedule-list">
            {todayEvents.map((ev) => {
              const id = asString(ev.id);
              const title = asString(ev.title, "—");
              const start = asString(ev.start_time);
              const end = asString(ev.end_time);
              const provider = asString(ev.provider, "manual");
              const location = asString(ev.location);
              return (
                <div key={id} className="home-schedule-item">
                  <div className={`home-schedule-time-pill ${provider}`}>
                    {formatTime(start)}
                  </div>
                  <div className="home-schedule-body">
                    <p className="home-schedule-title">{title}</p>
                    <p className="home-schedule-meta">
                      {end ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start)}
                      {location ? ` \u2022 ${location}` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 4-panel grid ── */}
      <div className="home-panels-grid">
        {/* Pinned Items */}
        <div className="home-panel">
          <div className="home-panel-head">
            <h3>{t("home.pinnedItems")}</h3>
            <button type="button" className="home-panel-link" onClick={() => goTo("files")}>{t("home.viewAll")}</button>
          </div>
          {pinnedItems.length === 0 ? (
            <p className="home-panel-empty">{t("home.noPinned")}</p>
          ) : (
            <div className="home-panel-list">
              {pinnedItems.slice(0, 6).map((item) => (
                <div key={item.id} className="home-panel-row" onClick={() => goTo("files")}>
                  <span className="home-panel-row-icon">{"\uD83D\uDCCC"}</span>
                  <div className="home-panel-row-body">
                    <p className="home-panel-row-title">{item.title}</p>
                    <p className="home-panel-row-sub">{item.fileExtension ? item.fileExtension.toUpperCase() : item.itemType}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Meetings */}
        <div className="home-panel">
          <div className="home-panel-head">
            <h3>{t("home.upcomingMeetingsPanel")}</h3>
            <button type="button" className="home-panel-link" onClick={() => goTo("calendar")}>{t("home.viewAll")}</button>
          </div>
          {upcomingMeetings.length === 0 ? (
            <p className="home-panel-empty">{t("home.noMeetings")}</p>
          ) : (
            <div className="home-panel-list">
              {upcomingMeetings.map((ev) => {
                const id = asString(ev.id);
                const title = asString(ev.title, "—");
                const start = asString(ev.start_time);
                return (
                  <div key={id} className="home-panel-row" onClick={() => goTo("calendar")}>
                    <span className="home-panel-row-icon">{"\uD83D\uDCC5"}</span>
                    <div className="home-panel-row-body">
                      <p className="home-panel-row-title">{title}</p>
                      <p className="home-panel-row-sub">{formatDateShort(start)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Files */}
        <div className="home-panel">
          <div className="home-panel-head">
            <h3>{t("home.recentFiles")}</h3>
            <button type="button" className="home-panel-link" onClick={() => goTo("files")}>{t("home.viewAll")}</button>
          </div>
          {recentFiles.length === 0 ? (
            <p className="home-panel-empty">{t("home.noRecentFiles")}</p>
          ) : (
            <div className="home-panel-list">
              {recentFiles.slice(0, 6).map((item) => (
                <div key={item.id} className="home-panel-row" onClick={() => goTo("files")}>
                  <span className="home-panel-row-icon">{item.fileExtension ? "\uD83D\uDCC4" : "\uD83D\uDCDD"}</span>
                  <div className="home-panel-row-body">
                    <p className="home-panel-row-title">{item.title}</p>
                    <p className="home-panel-row-sub">
                      {item.fileExtension ? item.fileExtension.toUpperCase() + " \u2022 " : ""}
                      {item.updatedAtIso ? formatDateShort(item.updatedAtIso) : formatDateShort(item.createdAtIso)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Important Emails */}
        <div className="home-panel">
          <div className="home-panel-head">
            <h3>{t("home.importantEmails")}</h3>
            <button type="button" className="home-panel-link" onClick={() => goTo("email")}>{t("home.viewAll")}</button>
          </div>
          {importantEmails.length === 0 ? (
            <p className="home-panel-empty">{t("home.noImportantEmails")}</p>
          ) : (
            <div className="home-panel-list">
              {importantEmails.map((email) => {
                const id = asString(email.id);
                const subject = asString(email.subject, asString(email.title, "—"));
                const from = asString(email.from_address, asString(email.sender, ""));
                return (
                  <div key={id} className="home-panel-row" onClick={() => goTo("email")}>
                    <span className="home-panel-row-icon">{"\u2757"}</span>
                    <div className="home-panel-row-body">
                      <p className="home-panel-row-title">{subject}</p>
                      <p className="home-panel-row-sub">{from}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
