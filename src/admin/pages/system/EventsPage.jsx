import { useEffect, useState } from "react";
import { api } from "../../api";
import FormComboSelect from "../../../shared/components/FormComboSelect";
import { StatusDisplay } from "../../../shared/components/StatusBadge";

const SOUNDS = [
  { v: "", l: "Mute" },
  { v: "NEW_SIGNAL", l: "New Signal" },
  { v: "TRADE_FILLED", l: "Trade Filled" },
  { v: "TRADE_CLOSED", l: "Trade Closed" },
  { v: "NEWS_ALERT", l: "News Alert" },
  { v: "SESSION_START", l: "Session Start" },
];

function useNotificationState() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [testMsg, setTestMsg] = useState("");

  async function fire(overrides = {}) {
    try {
      setTestMsg("");
      const res = await api.notificationTest(overrides);
      setTestMsg(`Sent: ${res.sent.event}`);
      setTimeout(() => setTestMsg(""), 3000);
    } catch (e) {
      setTestMsg(`Failed: ${e?.message || e}`);
    }
  }

  async function load() {
    try {
      setLoading(true);
      const data = await api.notificationEvents();
      setEvents(data.events || []);
      setError("");
    } catch (e) {
      setError(e?.message || "Failed to load notification events.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    try {
      setSaving(true);
      const s = {};
      events.forEach((ev) => {
        s[ev.event] = {
          toast: ev.toast ?? true,
          console_log: ev.console_log ?? false,
          ticker: ev.ticker ?? false,
          db_log: ev.db_log ?? true,
          hub: ev.hub ?? true,
          sound: ev.sound || null,
        };
      });
      await api.notificationSaveSettings(s);
      setMsg("Saved.");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setError(e?.message || "Failed to save notification settings.");
    } finally {
      setSaving(false);
    }
  }

  function toggle(idx, key) {
    setEvents((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: !next[idx][key] };
      return next;
    });
  }

  function setField(idx, key, val) {
    setEvents((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: val };
      return next;
    });
  }

  return {
    events,
    loading,
    saving,
    msg,
    error,
    testMsg,
    fire,
    load,
    save,
    toggle,
    setField,
  };
}

function EventRow({ event, idx, toggle, setField, state }) {
  return (
    <tr>
      <td>
        <span style={{ fontWeight: 700, fontSize: 12 }}>
          {event.label || event.event}
        </span>
      </td>
      <td style={{ textAlign: "center" }}>
        <input
          type="checkbox"
          checked={event.toast !== false}
          onChange={() => toggle(idx, "toast")}
        />
      </td>
      <td style={{ textAlign: "center" }}>
        <input
          type="checkbox"
          checked={event.console_log === true}
          onChange={() => toggle(idx, "console_log")}
        />
      </td>
      <td style={{ textAlign: "center" }}>
        <input
          type="checkbox"
          checked={event.ticker === true}
          onChange={() => toggle(idx, "ticker")}
        />
      </td>
      <td style={{ textAlign: "center" }}>
        <input
          type="checkbox"
          checked={event.db_log !== false}
          onChange={() => toggle(idx, "db_log")}
        />
      </td>
      <td style={{ textAlign: "center" }}>
        <input
          type="checkbox"
          checked={event.hub !== false}
          onChange={() => toggle(idx, "hub")}
        />
      </td>
      <td>
        <FormComboSelect
          value={event.sound || ""}
          onChange={(e) => setField(idx, "sound", e.target.value)}
          style={{ width: "100%", fontSize: 10, padding: "2px 4px" }}
        >
          {SOUNDS.map((s) => (
            <option key={s.v} value={s.v}>
              {s.l}
            </option>
          ))}
        </FormComboSelect>
      </td>
      <td style={{ textAlign: "center" }}>
        <button
          className="secondary-button"
          title="Test this event"
          onClick={() => {
            state.fire({
              event: event.event,
              message: `Test: ${event.label || event.event}`,
              settings: {
                toast: event.toast !== false,
                console_log: event.console_log === true,
                ticker: event.ticker === true,
                db_log: event.db_log !== false,
                hub: event.hub !== false,
                sound: event.sound || null,
              },
            });
          }}
        >
          ▶
        </button>
      </td>
    </tr>
  );
}

export function EventsPageContent({ embedded = false }) {
  const state = useNotificationState();
  const { events, loading, msg, error, load, save, toggle, setField } = state;
  return (
    <section className="stack-layout" style={{ gap: 14 }}>
      <div
        className={embedded ? "stack-layout" : "panel"}
        style={embedded ? { gap: 14 } : undefined}
      >
        <div className="panel-label">
          NOTIFICATION SETTINGS
          <span className="minor-text" style={{ marginLeft: 8, fontSize: 10 }}>
            Configure channels per event type
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            marginBottom: 12,
          }}
        >
          {msg && (
            <StatusDisplay status="ok" label={msg} size="md" />
          )}
          {error && (
            <StatusDisplay status="error" label={error} size="md" />
          )}
          <button
            className="secondary-button"
            onClick={load}
            disabled={loading}
          >
            {loading ? "..." : "REFRESH"}
          </button>
          <button
            className="primary-button"
            onClick={save}
            disabled={state.saving}
          >
            {state.saving ? "..." : "SAVE"}
          </button>
          {state.testMsg && (
            <StatusDisplay status="ok" label={state.testMsg} size="md" />
          )}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table
            className="events-table"
            style={{ width: "100%", minWidth: 600 }}
          >
            <thead>
              <tr>
                <th>EVENT</th>
                <th style={{ width: 60, textAlign: "center" }}>TOAST</th>
                <th style={{ width: 60, textAlign: "center" }}>CONSOLE</th>
                <th style={{ width: 60, textAlign: "center" }}>TICKER</th>
                <th style={{ width: 60, textAlign: "center" }}>LOG</th>
                <th style={{ width: 60, textAlign: "center" }}>HUB</th>
                <th style={{ width: 110 }}>SOUND</th>
                <th style={{ width: 40 }}>TEST</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={7}
                    style={{ textAlign: "center", padding: 30 }}
                    className="minor-text"
                  >
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && events.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    style={{ textAlign: "center", padding: 30 }}
                    className="minor-text"
                  >
                    No events configured.
                  </td>
                </tr>
              )}
              {!loading &&
                events.map((ev, idx) => (
                  <EventRow
                    key={ev.event}
                    event={ev}
                    idx={idx}
                    toggle={toggle}
                    setField={setField}
                    state={state}
                  />
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default function EventsPage() {
  return <EventsPageContent />;
}
