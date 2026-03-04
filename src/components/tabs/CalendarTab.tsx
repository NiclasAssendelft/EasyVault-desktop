import { useState, useCallback, useMemo } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useUiStore } from "../../stores/uiStore";
import { asString, asBool, getStartOfWeek, addDays } from "../../services/helpers";
import { safeEntityCreate } from "../../services/entityService";
import { refreshCalendarFromRemote } from "../../services/deltaSyncService";
import { useT, t } from "../../i18n";

function RowMenu({ onAction }: { onAction: (action: string) => void }) {
  const [open, setOpen] = useState(false);
  const tr = useT();
  return (
    <div className="row-menu">
      <button className="row-menu-btn" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>&#x22EE;</button>
      {open && (
        <div className="row-menu-dropdown open">
          <button onClick={() => { onAction("manage"); setOpen(false); }}>{tr("menu.manage")}</button>
          <hr />
          <button className="danger" onClick={() => { onAction("delete"); setOpen(false); }}>{tr("menu.delete")}</button>
        </div>
      )}
    </div>
  );
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function CalendarTab() {
  const events = useRemoteDataStore((s) => s.events);
  const openManageModal = useUiStore((s) => s.openManageModal);
  const openDeleteModal = useUiStore((s) => s.openDeleteModal);
  const setStatus = useUiStore((s) => s.setStatus);
  const tr = useT();

  const [calendarWeekStart, setCalendarWeekStart] = useState<Date>(() => getStartOfWeek(new Date()));
  const weekEnd = useMemo(() => addDays(calendarWeekStart, 6), [calendarWeekStart]);
  const weekDays = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) days.push(addDays(calendarWeekStart, i));
    return days;
  }, [calendarWeekStart]);
  const today = useMemo(() => new Date(), []);

  const upcomingEvents = useMemo(() => {
    const now = new Date().toISOString();
    return events
      .filter((e) => asString(e.start_time) >= now)
      .sort((a, b) => asString(a.start_time).localeCompare(asString(b.start_time)));
  }, [events]);

  const handlePrev = useCallback(() => { setCalendarWeekStart((prev) => addDays(prev, -7)); }, []);
  const handleNext = useCallback(() => { setCalendarWeekStart((prev) => addDays(prev, 7)); }, []);
  const handleToday = useCallback(() => { setCalendarWeekStart(getStartOfWeek(new Date())); }, []);

  const handleNewEvent = useCallback(async () => {
    const title = window.prompt(t("calendar.eventPrompt"));
    if (!title) return;
    try {
      const now = new Date();
      const start = new Date(now.getTime() + 60 * 60 * 1000);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      await safeEntityCreate("CalendarEvent", {
        title, start_time: start.toISOString(), end_time: end.toISOString(), provider: "manual",
      });
      setStatus(t("calendar.created"));
      await refreshCalendarFromRemote();
    } catch (err) {
      setStatus(t("calendar.createFailed", { error: String(err) }));
    }
  }, [setStatus]);

  const handleRowAction = useCallback(
    (event: Record<string, unknown>, action: string) => {
      const id = asString(event.id);
      const updatedAt = asString(event.updated_date, asString(event.created_date, ""));
      if (action === "manage") openManageModal({ kind: "item", id, entity: "CalendarEvent" }, updatedAt);
      else if (action === "delete") openDeleteModal({ kind: "item", id, entity: "CalendarEvent" });
    },
    [openManageModal, openDeleteModal],
  );

  const weekLabel = `${formatDateShort(calendarWeekStart)} - ${formatDateShort(weekEnd)}`;

  return (
    <section className="tab-panel">
      <div className="tab-head-row">
        <div>
          <h2 className="page-title">{tr("calendar.title")}</h2>
          <p className="page-subtitle">{tr("calendar.count", { count: events.length })}</p>
        </div>
        <button type="button" onClick={handleNewEvent}>{tr("calendar.newEvent")}</button>
      </div>

      <div className="actions-row">
        <button type="button" className="ghost" onClick={handlePrev}>&#x2039;</button>
        <div className="week-label">{weekLabel}</div>
        <button type="button" className="ghost" onClick={handleNext}>&#x203A;</button>
        <button type="button" className="ghost" onClick={handleToday}>{tr("calendar.today")}</button>
      </div>

      <div className="week-grid">
        {weekDays.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div key={day.toISOString()} className={`week-day-cell${isToday ? " today" : ""}`}>
              <span className="week-day-label">{formatDayLabel(day)}</span>
            </div>
          );
        })}
      </div>

      <h4 className="section-label">{tr("calendar.agenda")}</h4>
      <div className="files-items">
        {upcomingEvents.length === 0 ? (
          <div className="dash-card"><p>{tr("calendar.noEvents")}</p></div>
        ) : (
          upcomingEvents.map((event) => {
            const id = asString(event.id);
            const title = asString(event.title, tr("calendar.untitled"));
            const startTime = asString(event.start_time);
            const location = asString(event.location);
            const isImportant = asBool(event.is_important);
            return (
              <article key={id} className="file-row group" data-entity="CalendarEvent">
                <div className="file-row-icon">{"\u2637"}</div>
                <div className="file-row-body">
                  <p className="file-row-title">
                    {title}
                    {isImportant && <span className="badge badge-important"> {tr("email.important")}</span>}
                  </p>
                  <p className="file-row-sub">
                    {startTime ? new Date(startTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                    {location ? ` \u2022 ${location}` : ""}
                  </p>
                </div>
                <RowMenu onAction={(action) => handleRowAction(event, action)} />
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
