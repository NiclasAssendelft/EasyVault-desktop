import { useState, useCallback, useMemo } from "react";
import { useRemoteDataStore } from "../../stores/remoteDataStore";
import { useUiStore } from "../../stores/uiStore";
import { asString, asBool, getStartOfWeek, addDays, spaceColor, isSpaceOwner } from "../../services/helpers";
import { safeEntityCreate } from "../../services/entityService";
import { refreshCalendarFromRemote } from "../../services/deltaSyncService";
import { invokeEdgeFunction } from "../../api";
import { getSavedEmail } from "../../storage";
import { useT, t } from "../../i18n";

/** Filter-chip sentinels. Real space ids are UUIDs, so these can't collide. */
const FILTER_ALL = "all";
const FILTER_PERSONAL = "personal";

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
  const spaces = useRemoteDataStore((s) => s.spaces);
  const openManageModal = useUiStore((s) => s.openManageModal);
  const openDeleteModal = useUiStore((s) => s.openDeleteModal);
  const setStatus = useUiStore((s) => s.setStatus);
  const tr = useT();

  const me = useMemo(() => getSavedEmail().trim().toLowerCase(), []);

  const [calendarWeekStart, setCalendarWeekStart] = useState<Date>(() => getStartOfWeek(new Date()));
  const [syncing, setSyncing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [spaceFilter, setSpaceFilter] = useState<string>(FILTER_ALL);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState(todayDateStr);
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("10:00");
  const [newAllDay, setNewAllDay] = useState(false);
  const [newSpaceId, setNewSpaceId] = useState("");

  /** space id → display name, for the color chip on each event row. */
  const spaceNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of spaces) {
      const id = asString(s.id);
      if (id) map.set(id, asString(s.name, tr("calendar.space")));
    }
    return map;
  }, [spaces, tr]);

  /** Spaces the current user owns — owners may edit/delete anything in them. */
  const ownedSpaceIds = useMemo(() => {
    const owned = new Set<string>();
    for (const s of spaces) {
      const id = asString(s.id);
      if (id && isSpaceOwner(s, me)) owned.add(id);
    }
    return owned;
  }, [spaces, me]);

  /**
   * Members create and manage their own events; a space owner manages every
   * event in their space. Personal events have no space, so only the creator
   * can ever touch them.
   */
  const canEditEvent = useCallback(
    (event: Record<string, unknown>): boolean => {
      if (me && asString(event.created_by).toLowerCase() === me) return true;
      const spaceId = asString(event.space_id);
      return spaceId ? ownedSpaceIds.has(spaceId) : false;
    },
    [me, ownedSpaceIds],
  );

  const visibleEvents = useMemo(() => {
    if (spaceFilter === FILTER_ALL) return events;
    if (spaceFilter === FILTER_PERSONAL) return events.filter((e) => !asString(e.space_id));
    return events.filter((e) => asString(e.space_id) === spaceFilter);
  }, [events, spaceFilter]);

  const weekEnd = useMemo(() => addDays(calendarWeekStart, 6), [calendarWeekStart]);
  const weekDays = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) days.push(addDays(calendarWeekStart, i));
    return days;
  }, [calendarWeekStart]);
  const today = useMemo(() => new Date(), []);

  /**
   * Cutoff is the start of today, not "now": all-day events are written at
   * local 00:00, so a `now` cutoff would drop an all-day event the instant it
   * is created for today even though the week grid still shows it. Matches the
   * space calendar panel in WorkspaceDetail so both surfaces agree.
   */
  const upcomingEvents = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const cutoff = startOfToday.toISOString();
    return visibleEvents
      .filter((e) => asString(e.start_time) >= cutoff)
      .sort((a, b) => asString(a.start_time).localeCompare(asString(b.start_time)));
  }, [visibleEvents]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, Record<string, unknown>[]>();
    for (const ev of visibleEvents) {
      const st = asString(ev.start_time);
      if (!st) continue;
      const d = new Date(st);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) || [];
      arr.push(ev);
      map.set(key, arr);
    }
    return map;
  }, [visibleEvents]);

  const handlePrev = useCallback(() => { setCalendarWeekStart((prev) => addDays(prev, -7)); }, []);
  const handleNext = useCallback(() => { setCalendarWeekStart((prev) => addDays(prev, 7)); }, []);
  const handleToday = useCallback(() => { setCalendarWeekStart(getStartOfWeek(new Date())); }, []);

  const handleSyncOutlook = useCallback(async () => {
    setSyncing(true);
    try {
      setStatus(t("calendar.syncing"));
      await invokeEdgeFunction("syncOutlookCalendar", {});
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
      // All-day still writes a real ISO span (midnight → 23:59 local) so the
      // TEXT start_time/end_time columns keep sorting and grouping unchanged.
      const start = new Date(`${newDate}T${newAllDay ? "00:00" : newStart}`);
      const end = new Date(`${newDate}T${newAllDay ? "23:59" : newEnd}`);
      const payload: Record<string, unknown> = {
        title: newTitle.trim(),
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        provider: "manual",
      };
      // Only send the new columns when they carry meaning: on a backend that
      // predates the migration this avoids teaching syncStore that they are
      // unsupported, which would silently strip a real team assignment.
      if (newSpaceId) payload.space_id = newSpaceId;
      if (newAllDay) payload.all_day = true;
      await safeEntityCreate("CalendarEvent", payload);
      setStatus(t("calendar.created"));
      setShowCreate(false);
      setNewTitle("");
      setNewAllDay(false);
      await refreshCalendarFromRemote();
    } catch (err) {
      console.error("[CalendarTab] create event failed:", err);
      setStatus(t("calendar.createFailed", { error: String(err) }));
    }
  }, [newTitle, newDate, newStart, newEnd, newAllDay, newSpaceId, setStatus]);

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
          <p className="page-subtitle">{tr("calendar.count", { count: visibleEvents.length })}</p>
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
            <label htmlFor="cal-new-title">{tr("calendar.eventTitle")}</label>
            <input id="cal-new-title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} autoFocus />
          </div>
          <div>
            <label htmlFor="cal-new-space">{tr("calendar.addToSpace")}</label>
            <select id="cal-new-space" value={newSpaceId} onChange={(e) => setNewSpaceId(e.target.value)}>
              <option value="">{tr("calendar.personal")}</option>
              {spaces.map((s) => {
                const id = asString(s.id);
                if (!id) return null;
                return <option key={id} value={id}>{asString(s.name, tr("calendar.space"))}</option>;
              })}
            </select>
          </div>
          <div>
            <label htmlFor="cal-new-date">{tr("calendar.eventDate")}</label>
            <input id="cal-new-date" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </div>
          <label className="calendar-allday-toggle">
            <input type="checkbox" checked={newAllDay} onChange={(e) => setNewAllDay(e.target.checked)} />
            {tr("calendar.allDay")}
          </label>
          {!newAllDay && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label htmlFor="cal-new-start">{tr("calendar.startTime")}</label>
                <input id="cal-new-start" type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              </div>
              <div>
                <label htmlFor="cal-new-end">{tr("calendar.endTime")}</label>
                <input id="cal-new-end" type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
              </div>
            </div>
          )}
          <div className="cal-modal-actions">
            <button type="button" className="ghost" onClick={() => setShowCreate(false)}>{tr("calendar.cancel")}</button>
            <button type="button" onClick={handleCreateEvent} disabled={!newTitle.trim()}>{tr("calendar.create")}</button>
          </div>
        </div>
      )}

      <div className="links-filter-row">
        <button
          type="button"
          className={`links-filter-pill${spaceFilter === FILTER_ALL ? " active" : ""}`}
          aria-pressed={spaceFilter === FILTER_ALL}
          onClick={() => setSpaceFilter(FILTER_ALL)}
        >
          {tr("calendar.allSpaces")}
        </button>
        <button
          type="button"
          className={`links-filter-pill${spaceFilter === FILTER_PERSONAL ? " active" : ""}`}
          aria-pressed={spaceFilter === FILTER_PERSONAL}
          onClick={() => setSpaceFilter(FILTER_PERSONAL)}
        >
          <span className="calendar-space-dot" style={{ background: spaceColor("") }} aria-hidden="true" />
          {tr("calendar.personal")}
        </button>
        {spaces.map((s) => {
          const id = asString(s.id);
          if (!id) return null;
          return (
            <button
              key={id}
              type="button"
              className={`links-filter-pill${spaceFilter === id ? " active" : ""}`}
              aria-pressed={spaceFilter === id}
              onClick={() => setSpaceFilter(id)}
            >
              <span className="calendar-space-dot" style={{ background: spaceColor(id) }} aria-hidden="true" />
              {asString(s.name, tr("calendar.space"))}
            </button>
          );
        })}
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
          const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
          const dayEvents = eventsByDay.get(key) || [];
          return (
            <div key={day.toISOString()} className={`week-day-cell${isToday ? " today" : ""}`}>
              <span className="week-day-label">{formatDayLabel(day)}</span>
              {dayEvents.slice(0, 3).map((ev) => {
                const provider = asString(ev.provider, "manual");
                const evSpaceId = asString(ev.space_id);
                const evSpaceName = evSpaceId ? spaceNames.get(evSpaceId) || tr("calendar.space") : "";
                const chipTitle = evSpaceName
                  ? `${asString(ev.title)} • ${evSpaceName}`
                  : asString(ev.title);
                return (
                  <div key={asString(ev.id)} className={`calendar-event-chip ${provider}`} title={chipTitle}>
                    {evSpaceId && (
                      <span className="calendar-space-dot" style={{ background: spaceColor(evSpaceId) }} aria-hidden="true" />
                    )}
                    {asBool(ev.all_day) ? "" : `${formatTime(asString(ev.start_time))} `}
                    {asString(ev.title, tr("calendar.untitled"))}
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
            const allDay = asBool(event.all_day);
            const provider = asString(event.provider, "manual");
            const evSpaceId = asString(event.space_id);
            const evSpaceName = evSpaceId ? spaceNames.get(evSpaceId) || tr("calendar.space") : "";
            const when = startTime
              ? new Date(startTime).toLocaleString(
                  undefined,
                  allDay
                    ? { month: "short", day: "numeric" }
                    : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
                )
              : "";
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
                    {evSpaceId && (
                      <span className="calendar-space-tag">
                        <span className="calendar-space-dot" style={{ background: spaceColor(evSpaceId) }} aria-hidden="true" />
                        {evSpaceName}
                      </span>
                    )}
                    {when}
                    {allDay ? ` \u2022 ${tr("calendar.allDay")}` : ""}
                    {location ? ` \u2022 ${location}` : ""}
                  </p>
                </div>
                {canEditEvent(event) && <RowMenu onAction={(action) => handleRowAction(event, action)} />}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
