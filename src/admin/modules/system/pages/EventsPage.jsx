import { useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import { StatusDisplay } from "../../../shared/components/StatusBadge";
import {
  EVENT_FILTERS,
  buildSortedEvents,
  matchesEventFilter,
  matchesEventSearch,
} from "../../../shared/utils/notificationEventFilters.js";

const SOUNDS = [
  { v: "", l: "Mute" },
  { v: "NEW_SIGNAL", l: "New Signal" },
  { v: "TRADE_FILLED", l: "Trade Filled" },
  { v: "TRADE_CLOSED", l: "Trade Closed" },
  { v: "NEWS_ALERT", l: "News Alert" },
  { v: "SESSION_START", l: "Session Start" },
];
const CHANNEL_TYPES = [
  { v: "telegram", l: "Telegram" },
  { v: "slack", l: "Slack" },
  { v: "whatsapp", l: "WhatsApp" },
];

function slugChannelId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildChannelId(label, fallback = "") {
  const slug = slugChannelId(label);
  if (slug) return slug;
  const suffix = String(Date.now()).slice(-8);
  const base = slugChannelId(fallback) || "channel";
  return `${base}_${suffix}`;
}

function useNotificationState() {
  const [events, setEvents] = useState([]);
  const [channels, setChannels] = useState([]);
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
      const [data, channelsRes] = await Promise.all([
        api.notificationEvents(),
        api.notificationChannels().catch(() => ({ channels: [] })),
      ]);
      setEvents(data.events || []);
      setChannels(channelsRes.channels || []);
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
          telegram: ev.telegram === true,
          telegram_channel: ev.telegram_channel || "",
          sound: ev.sound || null,
        };
      });
      await api.notificationSaveSettings(s);
      await api.notificationSaveChannels(channels);
      setMsg("Saved.");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setError(e?.message || "Failed to save notification settings.");
    } finally {
      setSaving(false);
    }
  }

  async function saveChannelsOnly() {
    try {
      setSaving(true);
      await api.notificationSaveChannels(channels);
      await load();
      setMsg("Channels saved.");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setError(e?.message || "Failed to save notification channels.");
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

  function addChannel() {
    const nextId = buildChannelId("", "channel");
    setChannels((prev) => [
      ...prev,
      {
        id: nextId,
        label: "New channel",
        type: "telegram",
        bot_token: "",
        chat_id: "",
        webhook_url: "",
        target: "",
        is_enabled: true,
      },
    ]);
  }

  function updateChannel(idx, key, val) {
    setChannels((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: val };
      return next;
    });
  }

  function removeChannel(idx) {
    setChannels((prev) => prev.filter((_, index) => index !== idx));
  }

  return {
    events,
    channels,
    loading,
    saving,
    msg,
    error,
    testMsg,
    fire,
    load,
    save,
    saveChannelsOnly,
    toggle,
    setField,
    addChannel,
    updateChannel,
    removeChannel,
  };
}

function EventRow({ event, idx, toggle, setField, state }) {
  const telegramChannels = (state.channels || []).filter(
    (channel) => String(channel?.type || "").toLowerCase() === "telegram",
  );
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
        <InputComboSelect
          value={event.telegram_channel || ""}
          onChange={(e) => {
            const value = e.target.value;
            setField(idx, "telegram_channel", value);
            setField(idx, "telegram", Boolean(String(value || "").trim()));
          }}
          style={{ width: "100%", fontSize: 10, padding: "2px 4px" }}
        >
          <option value="">Off</option>
          {telegramChannels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.label || channel.id}
              {channel.label && channel.id ? ` (${channel.id})` : ""}
            </option>
          ))}
        </InputComboSelect>
      </td>
      <td>
        <InputComboSelect
          value={event.sound || ""}
          onChange={(e) => setField(idx, "sound", e.target.value)}
          style={{ width: "100%", fontSize: 10, padding: "2px 4px" }}
        >
          {SOUNDS.map((s) => (
            <option key={s.v} value={s.v}>
              {s.l}
            </option>
          ))}
        </InputComboSelect>
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
                telegram: event.telegram === true,
                telegram_channel: event.telegram_channel || "",
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
  const {
    events,
    channels,
    loading,
    msg,
    error,
    load,
    save,
    saveChannelsOnly,
    toggle,
    setField,
    addChannel,
    updateChannel,
    removeChannel,
  } = state;
  const [searchText, setSearchText] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const sortedEvents = useMemo(() => buildSortedEvents(events), [events]);
  const filteredEvents = useMemo(
    () =>
      sortedEvents.filter(
        (event) =>
          matchesEventSearch(event, searchText) &&
          matchesEventFilter(event, activeFilter),
      ),
    [sortedEvents, searchText, activeFilter],
  );
  const eventIndexMap = useMemo(() => {
    const next = new Map();
    events.forEach((event, index) => {
      next.set(event?.event, index);
    });
    return next;
  }, [events]);
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
        <div className="panel" style={{ padding: 12 }}>
          <div className="panel-label">
            CHANNEL CONFIGS
            <span className="minor-text" style={{ marginLeft: 8, fontSize: 10 }}>
              Telegram is active now. Slack/WhatsApp can be stored for later use.
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              flexWrap: "wrap",
            }}
          >
            <div className="minor-text" style={{ fontSize: 11 }}>
              Changes here are only draft until you click `SAVE CHANNELS`.
            </div>
            <button
              className="primary-button"
              onClick={saveChannelsOnly}
              disabled={state.saving}
            >
              {state.saving ? "..." : "SAVE CHANNELS"}
            </button>
          </div>
          <div className="stack-layout" style={{ gap: 8 }}>
            {channels.length === 0 ? (
              <div className="minor-text">No channels configured.</div>
            ) : null}
            {channels.map((channel, index) => (
              <div
                key={channel.id || index}
                className="card-item"
                style={{
                  display: "grid",
                  gridTemplateColumns: "140px 1fr 120px 1.2fr 1fr 1fr 90px",
                  gap: 8,
                  alignItems: "end",
                }}
              >
                <div>
                  <div className="minor-text" style={{ fontSize: 10 }}>CHANNEL ID</div>
                  <input
                    type="text"
                    value={channel.id || ""}
                    readOnly
                    title="Auto-generated from label"
                    style={{ opacity: 0.8, cursor: "not-allowed" }}
                  />
                </div>
                <div>
                  <div className="minor-text" style={{ fontSize: 10 }}>LABEL</div>
                  <input
                    type="text"
                    value={channel.label || ""}
                    onChange={(e) => {
                      const nextLabel = e.target.value;
                      updateChannel(index, "label", nextLabel);
                      const currentId = String(channel.id || "").trim();
                      if (!currentId || currentId.startsWith("channel_")) {
                        updateChannel(
                          index,
                          "id",
                          buildChannelId(nextLabel, channel.type || "channel"),
                        );
                      }
                    }}
                    placeholder="Main Telegram"
                  />
                </div>
                <div>
                  <div className="minor-text" style={{ fontSize: 10 }}>TYPE</div>
                  <InputComboSelect
                    value={channel.type || "telegram"}
                    onChange={(e) =>
                      updateChannel(index, "type", e.target.value)
                    }
                  >
                    {CHANNEL_TYPES.map((item) => (
                      <option key={item.v} value={item.v}>
                        {item.l}
                      </option>
                    ))}
                  </InputComboSelect>
                </div>
                <div>
                  <div className="minor-text" style={{ fontSize: 10 }}>
                    {channel.type === "telegram" ? "BOT TOKEN" : "WEBHOOK / TOKEN"}
                  </div>
                  <input
                    type="text"
                    value={
                      channel.type === "telegram"
                        ? channel.bot_token || ""
                        : channel.webhook_url || ""
                    }
                    onChange={(e) =>
                      updateChannel(
                        index,
                        channel.type === "telegram" ? "bot_token" : "webhook_url",
                        e.target.value,
                      )
                    }
                  />
                </div>
                <div>
                  <div className="minor-text" style={{ fontSize: 10 }}>
                    {channel.type === "telegram" ? "CHAT ID / USER ID" : "TARGET"}
                  </div>
                  <input
                    type="text"
                    value={
                      channel.type === "telegram"
                        ? channel.chat_id || ""
                        : channel.target || ""
                    }
                    onChange={(e) =>
                      updateChannel(
                        index,
                        channel.type === "telegram" ? "chat_id" : "target",
                        e.target.value,
                      )
                    }
                  />
                </div>
                <div>
                  <div className="minor-text" style={{ fontSize: 10 }}>STATUS</div>
                  <InputComboSelect
                    value={channel.is_enabled === false ? "off" : "on"}
                    onChange={(e) =>
                      updateChannel(index, "is_enabled", e.target.value === "on")
                    }
                  >
                    <option value="on">Enabled</option>
                    <option value="off">Disabled</option>
                  </InputComboSelect>
                </div>
                <div>
                  <button
                    className="secondary-button"
                    onClick={() => removeChannel(index)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <div>
              <button className="secondary-button" onClick={addChannel}>
                ADD CHANNEL
              </button>
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search event, label, sound, channel..."
            style={{ minWidth: 260, flex: "1 1 260px" }}
          />
          <InputComboSelect
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
            style={{ minWidth: 180 }}
          >
            {EVENT_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </InputComboSelect>
          <span className="minor-text" style={{ fontSize: 11 }}>
            Showing {filteredEvents.length} / {events.length}
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
        <div className="minor-text" style={{ fontSize: 11, marginTop: -4, marginBottom: 12 }}>
          `ADD CHANNEL` only creates the row. `SAVE CHANNELS` persists channel configs. Bottom `SAVE` persists both channel configs and event settings.
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
                <th style={{ width: 160, textAlign: "center" }}>TELEGRAM BOT</th>
                <th style={{ width: 110 }}>SOUND</th>
                <th style={{ width: 40 }}>TEST</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={9}
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
                    colSpan={9}
                    style={{ textAlign: "center", padding: 30 }}
                    className="minor-text"
                  >
                    No events configured.
                  </td>
                </tr>
              )}
              {!loading && events.length > 0 && filteredEvents.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    style={{ textAlign: "center", padding: 30 }}
                    className="minor-text"
                  >
                    No events match the current search/filter.
                  </td>
                </tr>
              )}
              {!loading &&
                filteredEvents.map((ev) => {
                  const idx = eventIndexMap.get(ev?.event) ?? -1;
                  return (
                    <EventRow
                      key={ev.event}
                      event={ev}
                      idx={idx}
                      toggle={toggle}
                      setField={setField}
                      state={state}
                    />
                  );
                })}
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
