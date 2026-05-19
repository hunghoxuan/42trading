import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { showDateTime } from "../../utils/format";

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
const EVENT_TYPE_BUTTONS = [
  "AI_API_CALL_REQUEST",
  "AI_API_CALL_RESPONSE",
  "AI_ANALYZE_REQUEST",
  "AI_RESPONSE",
  "AI_ANALYZE_RESPONSE",
  "AI_ANALYZE_ERROR",
  "FETCH_API",
  "CRON_MD",
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
  "TRADE_FILLED",
  "BROKER_SYNC",
];

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
  const { logId } = useParams();
  const navigate = useNavigate();
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
  const [initialAutoSelectDone, setInitialAutoSelectDone] = useState(false);

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

  // Auto-select the log entry when logId param is provided after data loads
  useEffect(() => {
    if (logId && events.length > 0 && !initialAutoSelectDone) {
      const match = events.find(
        (ev) => String(getEventId(ev)) === String(logId),
      );
      if (match) {
        setSelectedEvent(match);
        setInitialAutoSelectDone(true);
      }
    }
  }, [logId, events, initialAutoSelectDone]);

  useEffect(() => {
    loadSymbols();
  }, []);
  useEffect(() => {
    setInitialAutoSelectDone(false);
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
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          <span
            className="minor-text"
            style={{ fontWeight: 600, fontSize: 10, marginRight: 2 }}
          >
            TYPE:
          </span>
          <button
            className={`secondary-button ${!filter.type ? "active" : ""}`}
            style={{ fontSize: 10, padding: "2px 8px" }}
            onClick={() => {
              setFilter((f) => ({ ...f, type: "" }));
              setPage(0);
            }}
          >
            ALL
          </button>
          {EVENT_TYPE_BUTTONS.map((et) => (
            <button
              key={et}
              className={`secondary-button ${filter.type === et ? "active" : ""}`}
              style={{ fontSize: 10, padding: "2px 8px" }}
              onClick={() => {
                setFilter((f) => ({ ...f, type: f.type === et ? "" : et }));
                setPage(0);
              }}
            >
              {et}
            </button>
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
            <label htmlFor="logs-page-size" className="sr-only">
              Page Size
            </label>
            <select
              id="logs-page-size"
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
          <label htmlFor="logs-search" className="sr-only">
            Search
          </label>
          <input
            id="logs-search"
            placeholder="SEARCH TICKET, ID..."
            value={filter.q}
            onChange={(e) => {
              setFilter((f) => ({ ...f, q: e.target.value }));
              setPage(0);
            }}
            style={{ width: "180px" }}
          />
          <label htmlFor="logs-symbol" className="sr-only">
            Symbol
          </label>
          <select
            id="logs-symbol"
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
          <label htmlFor="logs-range" className="sr-only">
            Time Range
          </label>
          <select
            id="logs-range"
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
          <label htmlFor="logs-bulk-action" className="sr-only">
            Bulk Action
          </label>
          <select
            id="logs-bulk-action"
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
                  <th>RESULT</th>
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
                      navigate(`/system/logs/${getEventId(ev)}`);
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
                      {ev.event_type === "EA" ? (
                        <div className="cell-wrap">
                          <span className={`badge ${ev.metadata?.level === "ERROR" ? "SL" : ev.metadata?.level === "WARNING" ? "OK" : "FILLED"}`}>
                            {ev.metadata?.level || "INFO"}
                          </span>
                          <div className="minor-text" style={{ 
                            maxWidth: "150px", 
                            overflow: "hidden", 
                            textOverflow: "ellipsis", 
                            whiteSpace: "nowrap" 
                          }}>
                            {ev.metadata?.message}
                          </div>
                        </div>
                      ) : (ev.status === "ERROR" || ev.error) ? (
                        <span className="badge SL" title={ev.error || "Error"}>ERROR</span>
                      ) : ev.status ? (
                        <span className="badge FILLED">{ev.status}</span>
                      ) : (
                        <span className="badge" style={{ opacity: 0.6 }}>OK</span>
                      )}
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
                {(selectedEvent.error || selectedEvent.status === "ERROR") && (
                  <div style={{ marginBottom: 12, padding: 8, background: "rgba(255,0,0,0.1)", borderRadius: 4, border: "1px solid rgba(255,0,0,0.2)" }}>
                    <div className="minor-text" style={{ color: "var(--sl)", fontWeight: 600, marginBottom: 4 }}>ERROR DETAIL</div>
                    <div style={{ fontSize: 12, color: "var(--sl)", wordBreak: "break-word" }}>{selectedEvent.error || "Unknown Error"}</div>
                  </div>
                )}
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
