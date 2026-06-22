import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { realtimeClient } from "../../realtime/realtimeClientSingleton";
import { formatRelativeDateTime, showDateTime } from "../../utils/format";
import GroupButtons from "../../../shared/components/GroupButtons";

const VIEW_OPTIONS = [
  { key: "yesterday", label: "Yesterday" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "thisWeek", label: "This Week" },
  { key: "nextWeek", label: "Next Week" },
];

function isSameLocalDay(date, target) {
  return (
    date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate()
  );
}

function startOfWeek(date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + diff);
  return next;
}

function endOfWeek(date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 6);
  next.setHours(23, 59, 59, 999);
  return next;
}

function formatEventDateLabel(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatEventTime(value) {
  return formatRelativeDateTime(value);
}

function normalizeMetric(value) {
  const raw = String(value ?? "").trim();
  return raw || "—";
}

function impactLabel(event) {
  return String(event?.impact || "").trim() || "—";
}

function impactClass(event) {
  const raw = String(event?.impact || "").trim().toLowerCase();
  if (raw === "high") return "high";
  if (raw === "medium") return "medium";
  if (raw === "holiday") return "holiday";
  return "low";
}

function eventPhaseLabel(event) {
  const phase = String(event?.phase || "").trim().toLowerCase();
  if (phase === "during") return "Live";
  if (phase === "before") return "Soon";
  if (phase === "done") return "Closed";
  return "Upcoming";
}

function buildComment(event) {
  const parts = [];
  const symbols = Array.isArray(event?.effective_symbols)
    ? event.effective_symbols.filter(Boolean)
    : [];
  const scenarios = Array.isArray(event?.scenario_summary)
    ? event.scenario_summary.filter(Boolean)
    : [];
  if (symbols.length) {
    parts.push(`Symbols: ${symbols.join(", ")}`);
  }
  if (scenarios.length) {
    parts.push(`Scenarios: ${scenarios.join(" | ")}`);
  }
  return parts.join(" · ");
}

function filterEventsByView(events, viewKey, now) {
  const current = new Date(now);
  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  const tomorrow = new Date(current);
  tomorrow.setDate(current.getDate() + 1);

  const thisWeekStart = startOfWeek(current);
  const thisWeekEnd = endOfWeek(thisWeekStart);
  const nextWeekStart = new Date(thisWeekStart);
  nextWeekStart.setDate(thisWeekStart.getDate() + 7);
  const nextWeekEnd = endOfWeek(nextWeekStart);

  return (Array.isArray(events) ? events : []).filter((event) => {
    const date = new Date(event?.start_at || event?.start_ts || 0);
    if (!Number.isFinite(date.getTime())) return false;

    switch (viewKey) {
      case "yesterday":
        return isSameLocalDay(date, yesterday);
      case "tomorrow":
        return isSameLocalDay(date, tomorrow);
      case "thisWeek":
        return date >= thisWeekStart && date <= thisWeekEnd;
      case "nextWeek":
        return date >= nextWeekStart && date <= nextWeekEnd;
      case "today":
      default:
        return isSameLocalDay(date, current);
    }
  });
}

export default function AiNewsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [viewKey, setViewKey] = useState("today");
  const unsubscribeRef = useRef(null);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await api.calendarWeek();
      setEvents(Array.isArray(res?.events) ? res.events : []);
    } catch (error) {
      setMessage(error?.message || "Failed to load news calendar.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    unsubscribeRef.current = realtimeClient.subscribe(
      "news:week",
      {},
      (envelope) => {
        if (envelope?.type !== "snapshot") return;
        const nextEvents = Array.isArray(envelope?.data?.events)
          ? envelope.data.events
          : [];
        setEvents(nextEvents);
      },
      {
        onError: (error) => {
          console.warn("[AiNewsPage] realtime news error:", error);
        },
      },
    );
    return () => {
      if (typeof unsubscribeRef.current === "function") {
        unsubscribeRef.current();
      }
      unsubscribeRef.current = null;
    };
  }, []);

  const filteredEvents = useMemo(() => {
    const now = new Date();
    return filterEventsByView(events, viewKey, now).sort(
      (a, b) => Number(a?.start_ts || 0) - Number(b?.start_ts || 0),
    );
  }, [events, viewKey]);

  const groupedEvents = useMemo(() => {
    const map = new Map();
    for (const event of filteredEvents) {
      const key = formatEventDateLabel(event.start_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(event);
    }
    return [...map.entries()];
  }, [filteredEvents]);

  return (
    <section className="news-calendar-page stack-layout fadeIn">
      <div className="news-calendar-header">
        <div className="news-calendar-heading">
          <h2 className="page-title">News Calendar</h2>
        </div>
        <div className="news-calendar-actions">
          {message ? <span className="badge PENDING">{message}</span> : null}
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate("/settings/notification")}
          >
            Alerts
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="news-calendar-panel">
        <div className="news-calendar-toolbar">
          <GroupButtons
            items={VIEW_OPTIONS.map((option) => ({
              label: option.label,
              value: option.key,
            }))}
            selectedItems={[viewKey]}
            selectionMode="single"
            onChange={([nextView]) => setViewKey(nextView)}
            border_type="single"
            className="news-calendar-tabs"
            buttonClassName="news-calendar-tab"
            ariaLabel="News range"
          />
        </div>

        <div className="news-calendar-surface">
          {groupedEvents.length ? (
            groupedEvents.map(([label, dayEvents]) => (
              <section key={label} className="news-calendar-day">
                <div className="news-calendar-day-header">{label}</div>

                <div className="news-calendar-mobile-list">
                  {dayEvents.map((event, index) => (
                    <article
                      key={`${event.title}-${event.start_at || index}`}
                      className="news-calendar-mobile-card"
                    >
                      <div className="news-calendar-mobile-top">
                        <span className="news-calendar-time">
                          {formatEventTime(event.start_at)}
                        </span>
                        <span className="news-calendar-currency">
                          {String(event.currency || event.country || "—").toUpperCase()}
                        </span>
                        <span
                          className={`news-calendar-impact-pill ${impactClass(event)}`}
                        >
                          {impactLabel(event)}
                        </span>
                        <span className="news-calendar-phase">
                          {eventPhaseLabel(event)}
                        </span>
                      </div>
                      <div className="news-calendar-event-title">{event.title}</div>
                      <div className="news-calendar-mobile-metrics">
                        <span>Actual {normalizeMetric(event.actual)}</span>
                        <span>Forecast {normalizeMetric(event.forecast)}</span>
                        <span>Previous {normalizeMetric(event.previous)}</span>
                      </div>
                      {buildComment(event) ? (
                        <div className="news-calendar-mobile-comment">
                          {buildComment(event)}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>

                <div className="news-calendar-table-wrap">
                  <table className="news-calendar-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Cur.</th>
                        <th>Imp.</th>
                        <th>Event</th>
                        <th>Actual</th>
                        <th>Forecast</th>
                        <th>Previous</th>
                        <th>Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayEvents.map((event, index) => (
                        <tr key={`${event.title}-${event.start_at || index}`}>
                          <td title={showDateTime(event.start_at)}>{formatEventTime(event.start_at)}</td>
                          <td className="news-calendar-currency-cell">
                            {String(event.currency || event.country || "—").toUpperCase()}
                          </td>
                          <td>
                            <span
                              className={`news-calendar-impact-pill ${impactClass(event)}`}
                            >
                              {impactLabel(event)}
                            </span>
                          </td>
                          <td className="news-calendar-event-cell">
                            <div className="news-calendar-event-name">
                              {event.title}
                            </div>
                            <div className="news-calendar-event-phase">
                              {eventPhaseLabel(event)}
                            </div>
                          </td>
                          <td>{normalizeMetric(event.actual)}</td>
                          <td>{normalizeMetric(event.forecast)}</td>
                          <td>{normalizeMetric(event.previous)}</td>
                          <td className="news-calendar-comment-cell">
                            {buildComment(event) || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          ) : (
            <div className="news-calendar-empty">
              <div className="news-calendar-empty-title">No tracked events</div>
              <div className="minor-text">
                No real feed events matched this view, so the calendar stays empty instead of showing placeholders.
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
