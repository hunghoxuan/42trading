import { useEffect, useState, useMemo } from "react";
import { api } from "../../api";
import { showDateTime } from "../../utils/format";

const ALL_LOG_TYPES = [
  "CRON_MD",
  "FETCH_API",
  "CHART_API",
  "ANALYZE",
  "CACHE",
  "DB",
  "ORDER",
  "SYNC",
  "ERROR",
  "EA",
  "SIGNAL",
  "TRADE",
];
const TRACE_TYPES = new Set(ALL_LOG_TYPES);

function fDateTime(v) {
  return showDateTime(v);
}

function getEventId(ev) {
  return ev?.log_id ?? ev?.id ?? "";
}

function getEventObjectId(ev) {
  return ev?.object_id || ev?.signal_id || ev?.sid || "";
}

function getEventTime(ev) {
  return ev?.created_at || ev?.event_time || "";
}

function getEventPayload(ev) {
  return ev?.metadata || ev?.payload_json || {};
}

const PAGE_SIZE_OPTIONS = [50, 100, 200];
const BULK_ACTIONS = ["", "Delete All Log"];
const RANGE_OPTIONS = [
  { val: "all", lab: "All times" },
  { val: "today", lab: "Today" },
  { val: "yesterday", lab: "Yesterday" },
  { val: "last_week", lab: "Last week" },
  { val: "last_month", lab: "Last month" },
  { val: "week", lab: "This Week" },
  { val: "month", lab: "This Month" },
  { val: "year", lab: "This Year" },
];

export default function LogsPage() {
  const [events, setEvents] = useState([]);
  const [symbols, setSymbols] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [filter, setFilter] = useState({
    q: "",
    type: "",
    symbol: "",
    range: "all",
  });
  const [bulkAction, setBulkAction] = useState("");

  const query = useMemo(
    () => ({
      q: filter.q,
      type: filter.type,
      symbol: filter.symbol,
      range: filter.range,
      limit: pageSize,
      offset: page * pageSize,
    }),
    [filter, page, pageSize],
  );

  async function loadSymbols() {
    try {
      const data = await api.symbols();
      setSymbols(data.symbols || []);
    } catch {
      /* ignore */
    }
  }

  async function loadEvents() {
    try {
      setLoading(true);
      const data = await api.events(query);
      setEvents(data.events || []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load events");
    } finally {
      setLoading(false);
    }
  }

  async function onBulkOk() {
    if (bulkAction === "Delete All Log") {
      if (!window.confirm("CRITICAL: DELETE ALL EVENTS/LOGS?")) return;
      try {
        setLoading(true);
        await api.deleteEvents();
        setPage(0);
        await loadEvents();
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadSymbols();
  }, []);
  useEffect(() => {
    loadEvents();
  }, [query]);

  return (
    <section className="logs-page-container stack-layout">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h2 className="page-title" style={{ margin: 0 }}>
          Logs
        </h2>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span className="minor-text" style={{ fontWeight: 600 }}>
            TYPE:
          </span>
          {ALL_LOG_TYPES.map((lt) => (
            <label
              key={lt}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                cursor: "pointer",
                fontSize: 10,
              }}
            >
              <input
                type="checkbox"
                checked={filter.type === lt}
                onChange={(e) => {
                  setFilter((f) => ({
                    ...f,
                    type: e.target.checked ? lt : "",
                  }));
                  setPage(0);
                }}
              />
              <span className="minor-text">{lt}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="toolbar-panel">
        <div className="toolbar-group toolbar-pagination">
          <div className="pager-area">
            <strong>{events.length}</strong>
            {!(page === 0 && events.length < pageSize) && (
              <div className="pager-mini">
                <button
                  className="secondary-button"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  &lt;
                </button>
                <span className="minor-text">{page + 1}</span>
                <button
                  className="secondary-button"
                  disabled={events.length < pageSize}
                  onClick={() => setPage((p) => p + 1)}
                >
                  &gt;
                </button>
              </div>
            )}
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="toolbar-group toolbar-search-filter">
          <input
            placeholder="SEARCH TICKET, ID..."
            value={filter.q}
            onChange={(e) => {
              setFilter((f) => ({ ...f, q: e.target.value }));
              setPage(0);
            }}
            style={{ width: "180px" }}
          />
          <select
            value={filter.symbol}
            onChange={(e) => {
              setFilter((f) => ({ ...f, symbol: e.target.value }));
              setPage(0);
            }}
          >
            <option value="">ALL SYMBOLS</option>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={filter.range}
            onChange={(e) => {
              setFilter((f) => ({ ...f, range: e.target.value }));
              setPage(0);
            }}
          >
            {RANGE_OPTIONS.map((r) => (
              <option key={r.val} value={r.val}>
                {r.lab}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-group toolbar-bulk-action">
          <select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
          >
            {BULK_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a || "BULK ACTION..."}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary-button"
            onClick={onBulkOk}
            disabled={loading || !bulkAction}
          >
            APPLY
          </button>
        </div>
      </div>

      <div className="logs-layout-split">
        <div className="logs-list-pane">
          {error && <div className="error">{error}</div>}
          <div className="events-table-wrap">
            <table className="events-table">
              <thead>
                <tr>
                  <th>SYMBOL</th>
                  <th>EVENT TYPE</th>
                  <th>ID | TICKET</th>
                  <th>DATE TIME</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr
                    key={getEventId(ev)}
                    className={
                      getEventId(selectedEvent) === getEventId(ev)
                        ? "active"
                        : ""
                    }
                    onClick={() => {
                      setSelectedEvent(ev);
                    }}
                  >
                    <td>
                      <strong
                        className="minor-text"
                        style={{ color: "var(--text)" }}
                      >
                        {ev.symbol || "N/A"}
                      </strong>
                    </td>
                    <td>
                      <span className="badge">{ev.event_type}</span>
                    </td>
                    <td>
                      <div className="cell-wrap">
                        <div className="minor-text">{getEventObjectId(ev)}</div>
                        {!!ev.object_table && (
                          <div className="minor-text">{ev.object_table}</div>
                        )}
                        {ev.ack_ticket && (
                          <div
                            className="minor-text"
                            style={{ color: "var(--accent)" }}
                          >
                            # {ev.ack_ticket}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="minor-text">
                        {fDateTime(getEventTime(ev))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="logs-detail-pane">
          {selectedEvent ? (
            <div className="event-detail-card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "16px",
                }}
              >
                <div className="panel-label" style={{ margin: 0 }}>
                  EVENT DETAILS #{getEventId(selectedEvent)}
                </div>
                <div className="minor-text">
                  {fDateTime(getEventTime(selectedEvent))}
                </div>
              </div>
              <div className="panel" style={{ margin: 0, padding: 12 }}>
                <div className="panel-label" style={{ marginBottom: 8 }}>
                  RAW JSON
                </div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 12,
                    lineHeight: 1.45,
                  }}
                >
                  {JSON.stringify(getEventPayload(selectedEvent), null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="empty-state minor-text">
              SELECT AN ENTRY TO INSPECT FULL PAYLOAD
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
