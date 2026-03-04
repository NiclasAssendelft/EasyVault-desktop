import { useState, useCallback, useMemo } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useUiStore } from "../../stores/uiStore";
import { asString, asBool, getStartOfWeek, addDays } from "../../services/helpers";
import { safeEntityCreate } from "../../services/entityService";
import { refreshCalendarFromRemote } from "../../services/deltaSyncService";
import { invokeBase44Function } from "../../api";
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

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarTab() {
  const events = useRemoteDataStore((s) => s.events);
  const openManageModal = useUiStore((s) => s.openManageModal);
  const openDeleteModal = useUiStore((s) => s.openDeleteModal);
  const setStatus = useUiStore((s) => s.setStatus);
  const tr = useT();

  const [calendarWeekStart, setCalendarWeekStart] = useState<Date>(() => getStartOfWeek(new Date()));
  const [syncing, setSyncing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState(todayDateStr);
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("10:00");

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

  const eventsByDay = useMemo(() => {
    const map = new Map<string, Record<string, unknown>[]>();
    for (const ev of events) {
      const st = asString(ev.start_time);
      if (!st) continue;
      const d = new Date(st);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) || [];
      arr.push(ev);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  const handlePrev = useCallback(() => { setCalendarWeekStart((prev) => addDays(prev, -7)); }, []);
  const handleNext = useCallback(() => { setCalendarWeekStart((prev) => addDays(prev, 7)); }, []);
  const handleToday = useCallback(() => { setCalendarWeekStart(getStartOfWeek(new Date())); }, []);

  const handleSyncOutlook = useCallback(async () => {
    setSyncing(true);
    try {
      setStatus(t("calendar.syncing"));
      await invokeBase44Function("syncOutlookCalendar", {});
      await refreshCalendarFromRemote();
      setStatus(t("calendar.outlookSynced"));
    } catch (err) {
      setStatus(t("calendar.outlookFailed", { error: String(err) }));
    } finally {
      setSyncing(false);
    }
  }, [setStatus]);

  const handleCreateEvent = useCallback(async () => {
    if (!newTitle.trim()) return;
    try {
      const start = new Date(`${newDate}T${newStart}`);
      const end = new Date(`${newDate}T${newEnd}`);
      await safeEntityCreate("CalendarEvent", {
        title: newTitle.trim(),
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        provider: "manual",
      });
      setStatus(t("calendar.created"));
      setShowCreate(false);
      setNewTitle("");
      await refreshCalendarFromRemote();
    } catch (err) {
      setStatus(t("calendar.createFailed", { error: String(err) }));
    }
  }, [newTitle, newDate, newStart, newEnd, setStatus]);

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
        <div className="actions-row" style={{ gap: 8 }}>
          <button type="button" className="calendar-sync-btn" onClick={handleSyncOutlook} disabled={syncing}>
            {syncing ? tr("calendar.syncing") : tr("calendar.syncOutlook")}
          </button>
          <button type="button" onClick={() => setShowCreate(!showCreate)}>{tr("calendar.newEvent")}</button>
        </div>
      </div>

      {showCreate && (
        <div className="calendar-create-modal">
          <div>
            <label>{tr("calendar.eventTitle")}</label>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} autoFocus />
          </div>
          <div>
            <label>{tr("calendar.eventDate")}</label>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label>{tr("calendar.startTime")}</label>
              <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
            </div>
            <div>
              <label>{tr("calendar.endTime")}</label>
              <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
            </div>
          </div>
          <div className="cal-modal-actions">
            <button type="button" className="ghost" onClick={() => setShowCreate(false)}>{tr("calendar.cancel")}</button>
            <button type="button" onClick={handleCreateEvent} disabled={!newTitle.trim()}>{tr("calendar.create")}</button>
          </div>
        </div>
      )}

      <div className="actions-row">
        <button type="button" className="ghost" onClick={handlePrev}>&#x2039;</button>
        <div className="week-label">{weekLabel}</div>
        <button type="button" className="ghost" onClick={handleNext}>&#x203A;</button>
        <button type="button" className="ghost" onClick={handleToday}>{tr("calendar.today")}</button>
      </div>

      <div className="week-grid">
        {weekDays.map((day) => {
          const isToday = isSameDay(day, today);
          const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
          const dayEvents = eventsByDay.get(key) || [];
          return (
            <div key={day.toISOString()} className={`week-day-cell${isToday ? " today" : ""}`}>
              <span className="week-day-label">{formatDayLabel(day)}</span>
              {dayEvents.slice(0, 3).map((ev) => {
                const provider = asString(ev.provider, "manual");
                return (
                  <div key={asString(ev.id)} className={`calendar-event-chip ${provider}`} title={asString(ev.title)}>
                    {formatTime(asString(ev.start_time))} {asString(ev.title, tr("calendar.untitled"))}
                  </div>
                );
              })}
              {dayEvents.length > 3 && (
                <div className="calendar-event-chip" style={{ opacity: 0.6 }}>+{dayEvents.length - 3}</div>
              )}
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
            const provider = asString(event.provider, "manual");
            return (
              <article key={id} className="file-row group" data-entity="CalendarEvent">
                <div className="file-row-icon">{"\u2637"}</div>
                <div className="file-row-body">
                  <p className="file-row-title">
                    {title}
                    {isImportant && <span className="badge badge-important"> {tr("email.important")}</span>}
                    <span className={`calendar-provider-badge ${provider}`}>
                      {provider === "outlook" ? tr("calendar.outlook") : tr("calendar.manual")}
                    </span>
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
