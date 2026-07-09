import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  api,
  getRuntimeActiveUserId,
  getRuntimeApiKey,
} from "../../../app/api";
import { realtimeClient } from "../realtime/realtimeClientSingleton";
import GroupButtons from "../../../shared/components/GroupButtons";
import Tooltip from "../../../shared/components/Tooltip";
import {
  buildNotificationHubMeta,
  isErrorEntry,
} from "../../../shared/utils/notificationDisplay";
import {
  formatCompactDuration,
  formatRelativeDateTime,
  showDateTime,
} from "../../../shared/utils/format";
import { HUB_MAX_VISIBLE } from "../services/NotificationManager";
import { NotificationFacade } from "../services/NotificationFacade";
import { hasPermission } from "../../../shared/utils/permissions";

const IS_LOCAL_DEV =
  import.meta.env.DEV &&
  (String(import.meta.env.VITE_API_BASE || "").trim() ||
    String(import.meta.env.VITE_API_PROXY_TARGET || "").trim());
const MOBILE_BREAKPOINT = 768;
const DEFAULT_LAYOUT_MODE = "panel";
const DESKTOP_CHAT_WIDTH = 420;
const PANEL_TABS = [
  { value: "notification", label: "Notification Hub" },
  { value: "ai", label: "AI Chat" },
  { value: "news", label: "News" },
];
const NEWS_VIEW_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "thisWeek", label: "This Week" },
  { value: "nextWeek", label: "Next Week" },
];

const MODE_OPTIONS = [
  { id: "ask", label: "Ask" },
  { id: "trade", label: "Trade" },
  { id: "codex", label: "Codex" },
];

function makeConversationId() {
  return `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildInitialMessage() {
  return {
    id: "welcome_mixed",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "One conversation can mix Ask, Trade, and Codex. Pick the mode beside Send for each message and I will keep the current 42trade route context in mind.",
      },
    ],
  };
}

function normalizeSymbol(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_-]+:/, "")
    .replace(/[^A-Z0-9]/g, "");
}

function inferRouteContext(route = "") {
  const raw = String(route || "").trim();
  const [pathname, search = ""] = raw.split("?");
  const segments = String(pathname || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const out = {
    route: raw || "/",
    tradeSid: "",
    symbol: "",
    routeKind: "general",
  };

  const statusNames = new Set([
    "filled",
    "pending",
    "closed",
    "rejected",
    "cancelled",
    "draft",
  ]);

  if (segments[0] === "trades") {
    const tradeId = segments[2] || segments[1] || "";
    if (tradeId && !statusNames.has(String(tradeId).toLowerCase())) {
      out.tradeSid = tradeId;
      out.routeKind = "trade";
    }
  }

  if (segments[0] === "ai") {
    const area = segments[1] || "";
    const maybeSymbol = normalizeSymbol(segments[2] || "");
    if (maybeSymbol) out.symbol = maybeSymbol;
    if (area) out.routeKind = `ai:${area}`;
  }

  try {
    const params = new URLSearchParams(search);
    const queryTrade =
      String(
        params.get("tradeSid") || params.get("trade_sid") || params.get("sid") || "",
      ).trim();
    const querySymbol = normalizeSymbol(
      params.get("symbol") || params.get("sym") || "",
    );
    if (queryTrade) out.tradeSid = queryTrade;
    if (querySymbol) out.symbol = querySymbol;
  } catch {}

  return out;
}

function buildRuntimeHeaders() {
  const headers = {};
  const apiKey = getRuntimeApiKey();
  const activeUserId = getRuntimeActiveUserId();
  if (apiKey) headers["x-api-key"] = apiKey;
  if (activeUserId) headers["x-active-user-id"] = activeUserId;
  return headers;
}

function readMessageText(message) {
  if (!message || !Array.isArray(message.parts)) return "";
  return message.parts
    .filter((part) => part?.type === "text")
    .map((part) => String(part.text || ""))
    .join("");
}

function renderInlineText(text = "", keyPrefix = "inline") {
  const raw = String(text || "");
  const parts = raw.split(/(`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code key={`${keyPrefix}-${index}`}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={`${keyPrefix}-${index}`}>{part}</span>;
  });
}

function renderAssistantContent(text = "") {
  const source = String(text || "").trim();
  if (!source) return null;

  const blocks = source.split(/\n{2,}/).filter((block) => block.trim());
  const nodes = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const trimmed = block.trim();
    const fenceMatch = trimmed.match(/^```([\w-]*)\n?([\s\S]*?)```$/);
    if (fenceMatch) {
      nodes.push(
        <pre key={`block-${index}`} className="ai-chat-markdown__pre">
          <code>{String(fenceMatch[2] || "").trim()}</code>
        </pre>,
      );
      continue;
    }

    const lines = trimmed.split("\n");
    const isBulletList = lines.every((line) => /^[-*]\s+/.test(line.trim()));
    if (isBulletList) {
      nodes.push(
        <ul key={`block-${index}`} className="ai-chat-markdown__list">
          {lines.map((line, lineIndex) => (
            <li key={`li-${index}-${lineIndex}`}>
              {renderInlineText(line.replace(/^[-*]\s+/, ""), `li-${index}-${lineIndex}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    nodes.push(
      <p key={`block-${index}`} className="ai-chat-markdown__paragraph">
        {lines.map((line, lineIndex) => (
          <span key={`p-${index}-${lineIndex}`}>
            {lineIndex > 0 ? <br /> : null}
            {renderInlineText(line, `p-${index}-${lineIndex}`)}
          </span>
        ))}
      </p>,
    );
  }

  return <div className="ai-chat-markdown">{nodes}</div>;
}

function formatConversationLabel(item = {}) {
  const title = String(item?.title || "").trim();
  if (title) return title;
  const preview = String(item?.preview || "").trim();
  if (preview) return preview.slice(0, 48);
  return "New chat";
}

function formatConversationMeta(item = {}) {
  const updated = String(item?.last_message_at || item?.updated_at || "").trim();
  if (!updated) return "";
  const date = new Date(updated);
  if (!Number.isFinite(date.getTime())) return "";
  const mode = String(item?.mode || "").trim();
  const timeLabel = date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return mode ? `${mode} · ${timeLabel}` : timeLabel;
}

function buildChatMessage(role = "user", text = "") {
  return {
    id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    parts: [{ type: "text", text: String(text || "") }],
  };
}

function buildChatConversationsTopic(userId = "") {
  const safeUserId = String(userId || "").trim();
  return safeUserId ? `chat:${safeUserId}:conversations` : "";
}

function buildChatConversationTopic(userId = "", conversationId = "") {
  const safeUserId = String(userId || "").trim();
  const safeConversationId = String(conversationId || "").trim();
  if (!safeUserId || !safeConversationId) return "";
  return `chat:${safeUserId}:conversation:${safeConversationId}`;
}

function parseSseEventBlocks(buffer = "") {
  const events = [];
  let rest = String(buffer || "");
  let splitIndex = rest.indexOf("\n\n");
  while (splitIndex >= 0) {
    const block = rest.slice(0, splitIndex);
    rest = rest.slice(splitIndex + 2);
    const data = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (data) {
      try {
        events.push(JSON.parse(data));
      } catch {}
    }
    splitIndex = rest.indexOf("\n\n");
  }
  return { events, rest };
}

function formatEntryDuration(entry) {
  const durationMs = Number(entry?.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "";
  return formatCompactDuration(durationMs, 2, 1000);
}

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

function impactClass(event) {
  const raw = String(event?.impact || "").trim().toLowerCase();
  if (raw === "high") return "high";
  if (raw === "medium") return "medium";
  if (raw === "holiday") return "holiday";
  return "low";
}

function filterEventsByView(events, viewKey, now) {
  const current = new Date(now);
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
      case "nextWeek":
        return date >= nextWeekStart && date <= nextWeekEnd;
      case "thisWeek":
        return date >= thisWeekStart && date <= thisWeekEnd;
      case "today":
      default:
        return isSameLocalDay(date, current) || isSameLocalDay(date, tomorrow);
    }
  });
}

function shouldIgnoreRealtimeWarning(error) {
  const type = String(error?.type || "").trim().toLowerCase();
  const reason = String(error?.reason || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  return (
    type === "disconnect" ||
    reason === "ping timeout" ||
    message === "realtime socket disconnected"
  );
}

function DockNewsPane() {
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
          if (shouldIgnoreRealtimeWarning(error)) return;
          console.warn("[DockNewsPane] realtime news error:", error);
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

  const visibleEvents = useMemo(() => {
    return filterEventsByView(events, viewKey, new Date())
      .sort((a, b) => Number(a?.start_ts || 0) - Number(b?.start_ts || 0))
      .slice(0, 16);
  }, [events, viewKey]);

  return (
    <div className="ai-hub-pane">
      <div className="ai-hub-pane__toolbar">
        <GroupButtons
          items={NEWS_VIEW_OPTIONS}
          selectedItems={[viewKey]}
          selectionMode="single"
          onChange={([nextView]) => setViewKey(nextView || "today")}
          border_type="multiple"
          className="ai-hub-tabs-inline"
          buttonClassName="ai-hub-tabs-inline__button"
          itemsLayout="row"
          ariaLabel="News range"
        />
        <button
          type="button"
          className="secondary-button"
          onClick={load}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {message ? <div className="error-inline">{message}</div> : null}
      <div className="ai-hub-list">
        {visibleEvents.length ? (
          visibleEvents.map((event, index) => (
            <article key={`${event.title}-${event.start_at || index}`} className="ai-hub-card">
              <div className="ai-hub-card__top">
                <span>{formatRelativeDateTime(event.start_at)}</span>
                <span>{String(event.currency || event.country || "—").toUpperCase()}</span>
                <span className={`ai-hub-impact ai-hub-impact--${impactClass(event)}`}>
                  {String(event.impact || "—")}
                </span>
              </div>
              <div className="ai-hub-card__title">{event.title}</div>
              <div className="ai-hub-card__meta">
                Actual {String(event.actual ?? "—")} · Forecast {String(event.forecast ?? "—")} · Previous {String(event.previous ?? "—")}
              </div>
            </article>
          ))
        ) : (
          <div className="ai-hub-empty">No upcoming tracked events.</div>
        )}
      </div>
    </div>
  );
}

function DockNotificationPane() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const merged = await NotificationFacade.listMerged(
        api.notificationList,
        HUB_MAX_VISIBLE,
      );
      setResults(merged);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return NotificationFacade.subscribe(refresh);
  }, [refresh]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refresh().catch(() => {});
    };
    const timer = window.setInterval(refreshIfVisible, 30_000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refresh]);

  const handleClear = () => {
    setResults([]);
    NotificationFacade.clearAllRemote(api.notificationClear);
  };

  const sourceToneStyle = (tone) => {
    switch (String(tone || "").trim().toLowerCase()) {
      case "trade":
        return {
          color: "#38bdf8",
          border: "rgba(56,189,248,0.28)",
          background: "rgba(56,189,248,0.12)",
        };
      case "symbol":
        return {
          color: "#f59e0b",
          border: "rgba(245,158,11,0.28)",
          background: "rgba(245,158,11,0.12)",
        };
      case "cron":
        return {
          color: "#a78bfa",
          border: "rgba(167,139,250,0.28)",
          background: "rgba(167,139,250,0.12)",
        };
      case "api":
        return {
          color: "#22c55e",
          border: "rgba(34,197,94,0.28)",
          background: "rgba(34,197,94,0.12)",
        };
      case "channel":
        return {
          color: "#f472b6",
          border: "rgba(244,114,182,0.28)",
          background: "rgba(244,114,182,0.12)",
        };
      default:
        return {
          color: "#94a3b8",
          border: "rgba(148,163,184,0.24)",
          background: "rgba(148,163,184,0.1)",
        };
    }
  };

  const statusToneStyle = (status) => {
    switch (String(status || "").trim().toUpperCase()) {
      case "FAIL":
        return {
          color: "#f87171",
          border: "rgba(239,68,68,0.35)",
          background: "rgba(239,68,68,0.12)",
        };
      case "WARNING":
        return {
          color: "#fbbf24",
          border: "rgba(251,191,36,0.34)",
          background: "rgba(251,191,36,0.12)",
        };
      default:
        return {
          color: "#34d399",
          border: "rgba(16,185,129,0.28)",
          background: "rgba(16,185,129,0.12)",
        };
    }
  };

  return (
    <div className="ai-hub-pane">
      <div className="ai-hub-pane__toolbar">
        <button type="button" className="secondary-button" onClick={refresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        <button type="button" className="secondary-button" onClick={handleClear}>
          Clear all
        </button>
      </div>
      <div className="ai-hub-list">
        {results.length ? (
          results.map((entry, entryIndex) => {
            const hubMeta = buildNotificationHubMeta(entry);
            const duration = formatEntryDuration(entry);
            const isError = isErrorEntry(entry);
            const toneStyle = sourceToneStyle(hubMeta.tone);
            const statusStyle = statusToneStyle(hubMeta.status);
            const sourceTypeTooltip = `${hubMeta.sourceType}: notification category, not transport`;
            const statusTooltip =
              hubMeta.status === "FAIL"
                ? "Request or event ended with an error"
                : hubMeta.status === "WARNING"
                  ? "Request or event finished with a warning"
                  : "Request or event finished successfully";
            const sourceIdTooltip = "Target symbol and timeframe";
            const fullMessageTooltip = hubMeta.fullMessage || hubMeta.message;
            const cardTooltip = [
              hubMeta.sourceType || "",
              hubMeta.status || "",
              hubMeta.sourceId || "",
              fullMessageTooltip || "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Tooltip
                key={`${entry.requestId || `${entry.createdAt || "na"}:${hubMeta.sourceId || "na"}:${hubMeta.message || "entry"}`}:${entryIndex}`}
                content={cardTooltip}
                side="top"
              >
                <article
                  className="ai-hub-card"
                  style={{ gap: 6 }}
                  title={cardTooltip}
                >
                  <div className="ai-hub-card__top">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        minWidth: 0,
                        flex: "1 1 auto",
                      }}
                    >
                      <span
                        style={{ display: "inline-flex", flexShrink: 0 }}
                      >
                        <Tooltip content={statusTooltip} side="top">
                          <span
                            style={{
                              fontSize: 9,
                              lineHeight: 1.2,
                              padding: "2px 6px",
                              borderRadius: 999,
                              border: `1px solid ${statusStyle.border}`,
                              color: statusStyle.color,
                              background: statusStyle.background,
                              cursor: "help",
                            }}
                          >
                            {hubMeta.status}
                          </span>
                        </Tooltip>
                      </span>
                      <span
                        style={{ display: "inline-flex", flexShrink: 0 }}
                      >
                        <Tooltip content={sourceTypeTooltip} side="top">
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 800,
                              lineHeight: 1.2,
                              padding: "2px 6px",
                              borderRadius: 999,
                              border: `1px solid ${toneStyle.border}`,
                              color: toneStyle.color,
                              background: toneStyle.background,
                              textTransform: "uppercase",
                              cursor: "help",
                            }}
                          >
                            {hubMeta.sourceType}
                          </span>
                        </Tooltip>
                      </span>
                      <Tooltip content={sourceIdTooltip} side="top">
                        <span
                          className={isError ? "msg-error" : ""}
                          title={hubMeta.sourceId}
                          style={{
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            cursor: "help",
                          }}
                        >
                          {hubMeta.sourceId}
                        </span>
                      </Tooltip>
                    </div>
                    <span title={showDateTime(entry.createdAt)}>
                      {formatRelativeDateTime(entry.createdAt)}
                      {duration ? ` · ${duration}` : ""}
                    </span>
                  </div>
                  <div
                    className="ai-hub-card__title"
                    title={fullMessageTooltip}
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      fontSize: "13px",
                      cursor: "help",
                    }}
                  >
                    {hubMeta.message}
                  </div>
                </article>
              </Tooltip>
            );
          })
        ) : (
          <div className="ai-hub-empty">No recent notifications.</div>
        )}
      </div>
    </div>
  );
}

function AiChatThread({
  selectedMode,
  setSelectedMode,
  canUseCodex,
  realtimeChatUserId,
  conversationId,
  contextSummary,
  initialMessages,
}) {
  const [draft, setDraft] = useState("");
  const [manualMessages, setManualMessages] = useState(initialMessages);
  const [manualStatus, setManualStatus] = useState("idle");
  const [manualError, setManualError] = useState("");
  const [codexActivities, setCodexActivities] = useState([]);
  const listRef = useRef(null);
  const codexRequestRef = useRef(null);
  const codexLiveAssistantIdRef = useRef("");
  const codexAssistantFlushFrameRef = useRef(0);
  const codexAssistantPendingTextRef = useRef("");
  const allowedMode =
    selectedMode === "codex" && !canUseCodex ? "ask" : selectedMode;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat/stream",
        credentials: "include",
        headers: buildRuntimeHeaders(),
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
  });

  useEffect(() => {
    setManualMessages(initialMessages);
    setManualStatus("idle");
    setManualError("");
    setCodexActivities([]);
    codexLiveAssistantIdRef.current = "";
    codexAssistantPendingTextRef.current = "";
    if (codexAssistantFlushFrameRef.current) {
      window.cancelAnimationFrame(codexAssistantFlushFrameRef.current);
      codexAssistantFlushFrameRef.current = 0;
    }
    codexRequestRef.current = null;
  }, [conversationId, initialMessages]);

  const pending =
    allowedMode === "codex"
      ? manualStatus === "submitted" ||
        manualStatus === "streaming" ||
        manualStatus === "stopping"
      : status === "submitted" || status === "streaming";
  const visibleMessages = allowedMode === "codex" ? manualMessages : messages;
  const visibleError =
    allowedMode === "codex" ? manualError : error?.message || "";

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [pending, visibleMessages, codexActivities]);

  useEffect(() => {
    if (allowedMode !== "codex" || pending) return undefined;
    const topic = buildChatConversationTopic(realtimeChatUserId, conversationId);
    if (!topic) return undefined;
    return realtimeClient.subscribe(
      topic,
      {},
      (envelope) => {
        if (!envelope || typeof envelope !== "object") return;
        if (envelope.type === "snapshot") {
          const nextMessages = Array.isArray(envelope?.data?.messages)
            ? envelope.data.messages
            : [];
          if (nextMessages.length) {
            codexLiveAssistantIdRef.current = "";
            setManualMessages(nextMessages);
          }
          return;
        }
        if (envelope.type === "codex-activity" && envelope?.data?.entry) {
          appendCodexActivity(envelope.data.entry);
          return;
        }
        if (envelope.type === "codex-assistant") {
          setManualStatus("streaming");
          scheduleLiveCodexAssistant(envelope?.data?.text || "");
          return;
        }
        if (envelope.type === "codex-finish") {
          if (envelope?.data?.reply) {
            flushLiveCodexAssistant(envelope.data.reply);
          }
          setManualStatus("idle");
        }
      },
      {
        onError: (error) => {
          if (shouldIgnoreRealtimeWarning(error)) return;
          console.warn("[AiChatThread] realtime chat error:", error);
        },
      },
    );
  }, [allowedMode, conversationId, pending, realtimeChatUserId]);

  function appendCodexActivity(entry = {}) {
    const normalized = {
      id:
        String(entry?.id || "").trim() ||
        `codex_evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      kind: String(entry?.kind || "status").trim() || "status",
      status: String(entry?.status || "in_progress").trim() || "in_progress",
      label: String(entry?.label || "").trim() || "Codex activity",
      detail: String(entry?.detail || "").trim(),
      ts: String(entry?.ts || new Date().toISOString()).trim(),
    };
    setCodexActivities((current) => {
      const next = [...current];
      const index = next.findIndex((item) => item.id === normalized.id);
      if (index >= 0) next[index] = normalized;
      else next.push(normalized);
      return next.slice(-10);
    });
  }

  function upsertLiveCodexAssistant(text = "") {
    const content = String(text || "").trim();
    if (!content) return;
    setManualMessages((current) => {
      const next = [...current];
      const liveId =
        codexLiveAssistantIdRef.current ||
        `msg_codex_live_${Date.now().toString(36)}`;
      codexLiveAssistantIdRef.current = liveId;
      const index = next.findIndex((message) => message.id === liveId);
      const assistantMessage = {
        id: liveId,
        role: "assistant",
        parts: [{ type: "text", text: content }],
      };
      if (index >= 0) next[index] = assistantMessage;
      else next.push(assistantMessage);
      return next;
    });
  }

  function flushLiveCodexAssistant(text = "") {
    const content = String(text || "").trim();
    if (codexAssistantFlushFrameRef.current) {
      window.cancelAnimationFrame(codexAssistantFlushFrameRef.current);
      codexAssistantFlushFrameRef.current = 0;
    }
    codexAssistantPendingTextRef.current = "";
    if (!content) return;
    upsertLiveCodexAssistant(content);
  }

  function scheduleLiveCodexAssistant(text = "") {
    const content = String(text || "").trim();
    if (!content) return;
    codexAssistantPendingTextRef.current = content;
    if (codexAssistantFlushFrameRef.current) return;
    codexAssistantFlushFrameRef.current = window.requestAnimationFrame(() => {
      codexAssistantFlushFrameRef.current = 0;
      const nextContent = codexAssistantPendingTextRef.current;
      codexAssistantPendingTextRef.current = "";
      if (nextContent) {
        upsertLiveCodexAssistant(nextContent);
      }
    });
  }

  useEffect(() => {
    return () => {
      if (codexAssistantFlushFrameRef.current) {
        window.cancelAnimationFrame(codexAssistantFlushFrameRef.current);
        codexAssistantFlushFrameRef.current = 0;
      }
    };
  }, []);

  async function submitCodexMessage(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed || pending) return;
    const userMessage = buildChatMessage("user", trimmed);
    const nextMessages = [...manualMessages, userMessage];
    setDraft("");
    setManualError("");
    setManualStatus("submitted");
    setCodexActivities([]);
    codexLiveAssistantIdRef.current = "";
    setManualMessages(nextMessages);
    appendCodexActivity({
      kind: "session",
      status: "in_progress",
      label: "Sending to Codex",
    });

    const headers = {
      ...buildRuntimeHeaders(),
      "Content-Type": "application/json",
    };
    const controller = new AbortController();
    codexRequestRef.current = controller;

    try {
      const response = await fetch("/api/ai/chat/stream", {
        method: "POST",
        credentials: "include",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          mode: "codex",
          provider: "codex",
          model: "codex-42trade",
          conversation_id: conversationId,
          context: contextSummary,
          messages: nextMessages,
        }),
      });
      if (!response.ok || !response.body) {
        const textBody = await response.text().catch(() => "");
        throw new Error(textBody || `Codex request failed (${response.status})`);
      }

      setManualStatus("streaming");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseEventBlocks(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) {
          if (!event || typeof event !== "object") continue;
          if (event.type === "codex-activity" && event.entry) {
            appendCodexActivity(event.entry);
            continue;
          }
          if (event.type === "codex-assistant") {
            setManualStatus("streaming");
            scheduleLiveCodexAssistant(event.text || "");
            continue;
          }
          if (event.type === "codex-finish") {
            if (event.reply) flushLiveCodexAssistant(event.reply);
            setManualStatus("idle");
            appendCodexActivity({
              kind: "session",
              status: event.stopped ? "cancelled" : "completed",
              label: event.stopped ? "Codex stopped" : "Codex finished",
            });
            finished = true;
            continue;
          }
          if (event.type === "error") {
            setManualStatus("idle");
            setManualError(String(event.errorText || "Codex request failed."));
            appendCodexActivity({
              kind: "session",
              status: "failed",
              label: "Codex failed",
              detail: String(event.errorText || ""),
            });
            finished = true;
            continue;
          }
          if (event.type === "finish") {
            setManualStatus((current) =>
              current === "stopping" ? "idle" : current,
            );
            finished = true;
          }
        }
      }
    } catch (fetchError) {
      setManualStatus("idle");
      setManualError(
        fetchError instanceof Error ? fetchError.message : String(fetchError),
      );
      appendCodexActivity({
        kind: "session",
        status: "failed",
        label: "Codex request failed",
        detail:
          fetchError instanceof Error ? fetchError.message : String(fetchError),
      });
    } finally {
      codexRequestRef.current = null;
    }
  }

  async function handleStopCodex() {
    if (!pending || allowedMode !== "codex") return;
    setManualStatus("stopping");
    appendCodexActivity({
      kind: "session",
      status: "in_progress",
      label: "Stopping Codex run",
    });
    try {
      await api.aiChatCodexControl({
        conversation_id: conversationId,
        action: "stop",
        context: contextSummary,
      });
    } catch (stopError) {
      setManualStatus("idle");
      setManualError(
        stopError instanceof Error ? stopError.message : String(stopError),
      );
    }
  }

  async function handleSubmit(event) {
    event?.preventDefault?.();
    const trimmed = String(draft || "").trim();
    if (!trimmed || pending) return;
    if (allowedMode === "codex") {
      await submitCodexMessage(trimmed);
      return;
    }
    setDraft("");
    sendMessage(
      { text: trimmed },
      {
        body: {
          mode: allowedMode,
          provider: allowedMode === "codex" ? "codex" : "ollama",
          model: allowedMode === "codex" ? "codex-42trade" : "",
          conversation_id: conversationId,
          context: contextSummary,
        },
      },
    );
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  }

  return (
    <>
      <div ref={listRef} className="ai-chat-message-list">
        {allowedMode === "codex" ? (
          <div className="ai-chat-codex-activity">
            <div className="ai-chat-codex-activity__header">
              <strong>Codex Activity</strong>
              <span>
                {pending
                  ? manualStatus === "stopping"
                    ? "Stopping..."
                    : "Running..."
                  : "Idle"}
              </span>
            </div>
            <div className="ai-chat-codex-activity__list">
              {codexActivities.length ? (
                codexActivities.map((entry) => (
                  <div
                    key={entry.id}
                    className={`ai-chat-codex-activity__item ai-chat-codex-activity__item--${entry.status}`}
                  >
                    <div className="ai-chat-codex-activity__title">
                      {entry.label}
                    </div>
                    {entry.detail ? (
                      <div className="ai-chat-codex-activity__detail">
                        {entry.detail}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="ai-chat-codex-activity__empty">
                  Codex activity will appear here during a run.
                </div>
              )}
            </div>
          </div>
        ) : null}
        {visibleMessages.map((message) => {
          const content = readMessageText(message).trim();
          return (
            <div
              key={message.id}
              className={`ai-chat-message ai-chat-message--${message.role}`}
            >
              <div className="ai-chat-message__role">{message.role}</div>
              <div className="ai-chat-message__content">
                {message.role === "assistant"
                  ? renderAssistantContent(content || "...")
                  : content}
              </div>
            </div>
          );
        })}
        {pending ? (
          <div className="ai-chat-message ai-chat-message--assistant">
            <div className="ai-chat-message__role">assistant</div>
            <div className="ai-chat-message__content">
              {allowedMode === "codex"
                ? manualStatus === "stopping"
                  ? "Stopping Codex..."
                  : "Codex is working..."
                : status === "streaming"
                  ? "Streaming..."
                  : "Thinking..."}
            </div>
          </div>
        ) : null}
      </div>

      {visibleError ? <div className="error-inline">{visibleError}</div> : null}

      <form className="ai-chat-composer" onSubmit={handleSubmit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            allowedMode === "trade"
              ? "Ask about this trade, snapshots, or new trade ideas..."
              : allowedMode === "codex"
                ? "Describe a bug, feature, or code task..."
                : "Ask the assistant anything..."
          }
          rows={4}
        />
        <div className="ai-chat-composer__actions">
          <select
            className="ai-chat-mode-select"
            value={allowedMode}
            onChange={(event) => setSelectedMode(event.target.value)}
            disabled={pending}
          >
            {MODE_OPTIONS.map((option) => (
              <option
                key={option.id}
                value={option.id}
                disabled={option.id === "codex" && !canUseCodex}
              >
                {option.label}
              </option>
            ))}
          </select>
          {allowedMode === "codex" ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => submitCodexMessage("Continue.")}
              disabled={pending}
            >
              Continue
            </button>
          ) : null}
          {allowedMode === "codex" && pending ? (
            <button
              type="button"
              className="secondary-button"
              onClick={handleStopCodex}
              disabled={manualStatus === "stopping"}
            >
              {manualStatus === "stopping" ? "Stopping..." : "Stop"}
            </button>
          ) : null}
          <button type="submit" className="primary-button" disabled={pending}>
            Send
          </button>
        </div>
      </form>
    </>
  );
}

export default function AiChatDock({
  pathname = "",
  authUser = null,
  layoutMode = DEFAULT_LAYOUT_MODE,
}) {
  const [open, setOpen] = useState(false);
  const [notificationBadgeCount, setNotificationBadgeCount] = useState(0);
  const [selectedMode, setSelectedMode] = useState("codex");
  const [activeTab, setActiveTab] = useState("notification");
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < MOBILE_BREAKPOINT;
  });
  const [modalOffset, setModalOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef(null);
  const [conversationItems, setConversationItems] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [initialMessages, setInitialMessages] = useState([buildInitialMessage()]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const routeContext = useMemo(() => inferRouteContext(pathname), [pathname]);
  const canUseCodex =
    IS_LOCAL_DEV || hasPermission(authUser, "pages.system.users");
  const safeLayoutMode =
    layoutMode === "modal" || layoutMode === "overlay" ? layoutMode : "panel";
  const effectiveLayoutMode = safeLayoutMode;
  const realtimeChatUserId = useMemo(
    () =>
      String(
        getRuntimeActiveUserId() ||
          authUser?.user_id ||
          authUser?.id ||
          authUser?.username ||
          "",
      ).trim(),
    [authUser?.id, authUser?.user_id, authUser?.username],
  );

  const contextSummary = useMemo(
    () => ({
      route: pathname || "/",
      routeKind: routeContext.routeKind,
      symbol: routeContext.symbol,
      tradeSid: routeContext.tradeSid,
      userRole:
        Array.isArray(authUser?.roles) && authUser.roles.length > 0
          ? String(authUser.roles[0] || "").trim().toLowerCase() || "user"
          : "user",
    }),
    [authUser?.roles, pathname, routeContext],
  );

  async function refreshConversations() {
    setLoadingConversations(true);
    setHistoryError("");
    try {
      const response = await api.aiChatConversations({ limit: 24 });
      const items = Array.isArray(response?.conversations)
        ? response.conversations
        : [];
      setConversationItems(items);
      if (!items.some((item) => item.conversation_id === selectedConversationId)) {
        if (items[0]?.conversation_id) {
          setSelectedConversationId(items[0].conversation_id);
        } else {
          const newId = makeConversationId();
          setSelectedConversationId(newId);
          setInitialMessages([buildInitialMessage()]);
        }
      }
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
      if (!selectedConversationId) {
        setSelectedConversationId(makeConversationId());
        setInitialMessages([buildInitialMessage()]);
      }
    } finally {
      setLoadingConversations(false);
    }
  }

  useEffect(() => {
    if (!open || activeTab !== "ai") return;
    refreshConversations();
  }, [activeTab, open]);

  useEffect(() => {
    if (!open || activeTab !== "ai") return undefined;
    const topic = buildChatConversationsTopic(realtimeChatUserId);
    if (!topic) return undefined;
    return realtimeClient.subscribe(
      topic,
      {},
      (envelope) => {
        if (envelope?.type !== "snapshot") return;
        const items = Array.isArray(envelope?.data?.conversations)
          ? envelope.data.conversations
          : [];
        setConversationItems(items);
        setHistoryError("");
        setLoadingConversations(false);
        if (!items.some((item) => item.conversation_id === selectedConversationId)) {
          if (items[0]?.conversation_id) {
            setSelectedConversationId(items[0].conversation_id);
          }
        }
      },
      {
        onError: (error) => {
          if (shouldIgnoreRealtimeWarning(error)) return;
          console.warn("[AiChatDock] realtime conversations error:", error);
        },
      },
    );
  }, [activeTab, open, realtimeChatUserId, selectedConversationId]);

  const refreshNotificationBadge = async () => {
    const merged = await NotificationFacade.listMerged(
      api.notificationList,
      HUB_MAX_VISIBLE,
    );
    setNotificationBadgeCount(NotificationFacade.getBadgeCount(merged));
  };

  useEffect(() => {
    refreshNotificationBadge();
    return NotificationFacade.subscribe(refreshNotificationBadge);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (event) => setIsMobile(event.matches);
    setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const body = document.body;
    if (!body) return undefined;
    const className = "ai-chat-layout-panel-open";
    const shouldDock = open && !isMobile && effectiveLayoutMode === "panel";
    if (shouldDock) {
      body.classList.add(className);
      body.style.setProperty("--ai-chat-panel-width", `${DESKTOP_CHAT_WIDTH}px`);
    } else {
      body.classList.remove(className);
      body.style.removeProperty("--ai-chat-panel-width");
    }
    return () => {
      body.classList.remove(className);
      body.style.removeProperty("--ai-chat-panel-width");
    };
  }, [effectiveLayoutMode, isMobile, open]);

  useEffect(() => {
    if (effectiveLayoutMode !== "modal" || !open) {
      setModalOffset({ x: 0, y: 0 });
    }
  }, [effectiveLayoutMode, open]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleMove = (event) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      setModalOffset({
        x: drag.startOffset.x + (event.clientX - drag.startPointer.x),
        y: drag.startOffset.y + (event.clientY - drag.startPointer.y),
      });
    };
    const handleUp = () => {
      dragStateRef.current = null;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, []);

  const beginModalDrag = (event) => {
    if (effectiveLayoutMode !== "modal" || isMobile) return;
    dragStateRef.current = {
      startPointer: { x: event.clientX, y: event.clientY },
      startOffset: { ...modalOffset },
    };
  };

  const handleOpenChange = (nextOpen) => {
    if (nextOpen) {
      NotificationFacade.markAllSeen();
      setNotificationBadgeCount(0);
    }
    setOpen(nextOpen);
  };

  useEffect(() => {
    if (!selectedConversationId) return;
    const selected = conversationItems.find(
      (item) => item.conversation_id === selectedConversationId,
    );
    if (!selected) {
      setInitialMessages([buildInitialMessage()]);
      return;
    }

    let cancelled = false;
    setLoadingMessages(true);
    setHistoryError("");
    api
      .aiChatConversation(selectedConversationId)
      .then((response) => {
        if (cancelled) return;
        const loaded = Array.isArray(response?.messages) ? response.messages : [];
        setInitialMessages(loaded.length ? loaded : [buildInitialMessage()]);
      })
      .catch((error) => {
        if (cancelled) return;
        setHistoryError(error instanceof Error ? error.message : String(error));
        setInitialMessages([buildInitialMessage()]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationItems, selectedConversationId]);

  function handleNewConversation() {
    const newId = makeConversationId();
    setSelectedConversationId(newId);
    setInitialMessages([buildInitialMessage()]);
  }

  return (
    <>
      <button
        type="button"
        className="ai-chat-launcher"
        aria-label={open ? "Close AI chat" : "Open AI chat"}
        aria-expanded={open}
        onClick={() => handleOpenChange(!open)}
      >
        <span className="ai-chat-launcher__glyph">?</span>
        {notificationBadgeCount > 0 ? (
          <span className="ai-chat-launcher__badge">
            {notificationBadgeCount > 9 ? "9+" : notificationBadgeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {effectiveLayoutMode === "panel" && !isMobile ? null : (
            <button
              type="button"
              className="ai-chat-backdrop"
              aria-label="Close AI chat panel"
              onClick={() => handleOpenChange(false)}
            />
          )}
          <aside
            className={`ai-chat-panel ai-chat-panel--${effectiveLayoutMode}`}
            style={
              effectiveLayoutMode === "modal"
                ? {
                    transform: `translate(calc(-50% + ${modalOffset.x}px), calc(-50% + ${modalOffset.y}px))`,
                  }
                : undefined
            }
          >
            <div
              className="ai-chat-panel__header"
              onPointerDown={beginModalDrag}
            >
              <div>
                <strong>Chat</strong>
              </div>
              <div className="ai-chat-panel__header-actions">
                <button
                  type="button"
                  className="secondary-button icon-button"
                  onClick={() => handleOpenChange(false)}
                  aria-label="Close AI chat"
                >
                  X
                </button>
              </div>
            </div>

            <GroupButtons
              items={PANEL_TABS}
              selectedItems={[activeTab]}
              selectionMode="single"
              onChange={([nextTab]) => setActiveTab(nextTab || "notification")}
              border_type="multiple"
              className="ai-hub-top-tabs"
              buttonClassName="ai-hub-top-tabs__button"
              itemsLayout="row"
              ariaLabel="Hub section"
            />

            {activeTab === "notification" ? <DockNotificationPane /> : null}

            {activeTab === "ai" ? (
              <>
                <div className="ai-chat-history">
                  <div className="ai-chat-history__header">
                    <strong>Conversations</strong>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleNewConversation}
                    >
                      New
                    </button>
                  </div>
                  <div className="ai-chat-history__list">
                    {loadingConversations ? (
                      <div className="ai-chat-history__empty">Loading history...</div>
                    ) : conversationItems.length ? (
                      conversationItems.map((item) => (
                        <button
                          key={item.conversation_id}
                          type="button"
                          className={`ai-chat-history__item${selectedConversationId === item.conversation_id ? " active" : ""}`}
                          onClick={() => setSelectedConversationId(item.conversation_id)}
                        >
                          <div className="ai-chat-history__title">
                            {formatConversationLabel(item)}
                          </div>
                          <div className="ai-chat-history__meta">
                            {formatConversationMeta(item)}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="ai-chat-history__empty">
                        No saved conversations yet.
                      </div>
                    )}
                  </div>
                </div>

                {historyError ? <div className="error-inline">{historyError}</div> : null}

                {loadingMessages && conversationItems.some(
                  (item) => item.conversation_id === selectedConversationId,
                ) ? (
                  <div className="ai-chat-history__empty">Loading conversation...</div>
                ) : (
                  <AiChatThread
                    key={selectedConversationId}
                    selectedMode={selectedMode}
                    setSelectedMode={setSelectedMode}
                    canUseCodex={canUseCodex}
                    realtimeChatUserId={realtimeChatUserId}
                    conversationId={selectedConversationId || makeConversationId()}
                    contextSummary={contextSummary}
                    initialMessages={initialMessages}
                  />
                )}
              </>
            ) : null}

            {activeTab === "news" ? <DockNewsPane /> : null}
          </aside>
        </>
      ) : null}
    </>
  );
}
