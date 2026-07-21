import { useEffect, useRef, useCallback } from "react";
import { api } from "../../app/api";
import { playSound, SoundEvents } from "../utils/SoundManager";
import {
  buildNotificationHubMeta,
  formatNotificationLine,
  isMeaningfulEntry,
  normalizeServerEntry,
} from "../utils/notificationDisplay";
import { showToast } from "./ToastContainer";
import { NotificationFacade } from "../../modules/42trade/services/NotificationFacade";
import { realtimeClient } from "../../modules/42trade/realtime/realtimeClientSingleton";
import { resultStatusToToastType } from "../utils/activityResult.js";

window.__tickerFilledTrades = window.__tickerFilledTrades || [];
window.__tickerMessages = window.__tickerMessages || [];

function shouldLogRealtimeWarnings() {
  try {
    return (
      window.localStorage.getItem("realtime_debug") === "1" ||
      window.localStorage.getItem("chart_debug") === "1"
    );
  } catch {
    return false;
  }
}

function isTransientRealtimeError(error) {
  const type = String(error?.type || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  return (
    type === "disconnect" ||
    type === "connect_error" ||
    message.includes("socket disconnected") ||
    message.includes("socket error") ||
    message.includes("subscribe timeout")
  );
}

function buildRealtimeHubPayload(kind, envelope = {}) {
  const data = envelope?.data && typeof envelope.data === "object" ? envelope.data : {};
  const type = String(envelope?.type || "").trim().toLowerCase();
  const symbol = String(data?.symbol || data?.instrument || "").trim().toUpperCase();
  const sid = String(
    data?.sid ||
      data?.trade_sid ||
      data?.tradeSid ||
      data?.id ||
      data?.ticket ||
      data?.broker_ticket ||
      "",
  ).trim();
  if (kind === "trade") {
    const status = String(data?.execution_status || "").trim().toUpperCase() || "UPDATED";
    const tradeLabel = sid || symbol || "";
    return {
      event: "TRADE_REALTIME_UPDATE",
      sub_type: type || "trade_update",
      type: "info",
      status: "ok",
      symbol,
      sid,
      source_type: "trade",
      source_id: sid || symbol,
      message: tradeLabel
        ? `Trade ${tradeLabel} ${status.toLowerCase()}`
        : `Trade ${status.toLowerCase()}`,
      hub: true,
      notification: true,
      ticker: true,
      toast: false,
      data,
    };
  }
  if (kind === "chart") {
    if (type === "artifact_snapshot") {
      return null;
    }
    const timeframe = String(data?.timeframe || data?.tf || "").trim();
    return {
      event: "CHART_REALTIME_UPDATE",
      sub_type: type || "chart_update",
      type: "info",
      status: "ok",
      symbol,
      source_type: "chart",
      source_id: [symbol, timeframe].filter(Boolean).join(":"),
      message: `Chart ${symbol || "unknown"} ${timeframe || ""} ${type || "update"}`.trim(),
      hub: true,
      notification: true,
      ticker: false,
      toast: false,
      data,
    };
  }
  return null;
}

/**
 * Global component: realtime notification listener.
 * Dispatches events to: browser notification, console log, ticker, page refresh, sound.
 */
export default function NotificationWatcher() {
  const notificationUnsubscribeRef = useRef(null);
  const mt5UnsubscribeRef = useRef(null);
  const prefsRef = useRef({}); // user's per-event notification prefs

  // Load user notification preferences once on mount
  useEffect(() => {
    api
      .notificationEvents()
      .then((res) => {
        if (res?.events) {
          const map = {};
          res.events.forEach((ev) => {
            map[ev.event] = ev;
          });
          prefsRef.current = map;
        }
      })
      .catch(() => {});
  }, []);

  const handleEvent = useCallback((payload) => {
    try {
      const p = typeof payload === "string" ? JSON.parse(payload) : payload;

      // 1. Console log
      if (p.console_log) {
        const fn =
          p.type === "error"
            ? console.error
            : p.type === "warning"
              ? console.warn
              : console.log;
        fn(`[${p.event}] ${p.message}`);
      }

      // Resolve: intersect SSE capability with user preferences
      const ns = p.notification_settings || {};
      const userPref = prefsRef.current[p.event] || {};
      // Read toast/ticker from notification_settings (legacy) or top-level payload (NotificationManager)
      const effectiveToast =
        ns.toast !== undefined
          ? ns.toast
          : p.toast !== undefined
            ? p.toast
            : true;
      const effectiveTicker =
        ns.ticker !== undefined
          ? ns.ticker
          : p.ticker !== undefined
            ? p.ticker
            : true;
      const shouldShowToast =
        effectiveToast !== false &&
        p.notification !== false &&
        userPref.notification !== false;
      const showTicker =
        effectiveTicker !== false &&
        p.ticker !== false &&
        userPref.ticker !== false;
      // Sound: only play if SSE allows, user has a sound selected AND sound event key is valid
      const userSound = userPref.sound;
      const sseSound = ns.sound !== false ? p.sound || userSound : null;
      const playAudio = !!sseSound && SoundEvents[sseSound];

      // 2. In-app toast
      if (shouldShowToast) {
        const normalizedEntry = normalizeServerEntry(p);
        const hubMeta = buildNotificationHubMeta(normalizedEntry);
        showToast({
          message: hubMeta.message || formatNotificationLine(normalizedEntry),
          fullMessage: hubMeta.fullMessage || p.message || "",
          type: resultStatusToToastType(normalizedEntry?.result?.status || p.type),
          position: p.position || "bottom-right",
          sourceType: hubMeta.sourceType,
          sourceId: hubMeta.sourceId,
          status: String(normalizedEntry?.result?.status || hubMeta.status || "").toUpperCase(),
          result: normalizedEntry?.result,
        });
      }

      // 3. Notification Ticker
      if (showTicker) {
        const normalizedEntry = normalizeServerEntry(p);
        if (isMeaningfulEntry(normalizedEntry)) {
          const tickerIdBase =
            normalizedEntry.requestId || Math.random().toString(36).slice(2, 9);
          const tickerTs = Date.now();
          const newItem = {
            id: `${tickerIdBase}:${tickerTs}:${Math.random().toString(36).slice(2, 6)}`,
            message: formatNotificationLine(normalizedEntry),
            type: p.type || "info",
            ts: tickerTs,
          };
          window.__tickerMessages = [newItem, ...(window.__tickerMessages || [])].slice(0, 15);
          window.dispatchEvent(new CustomEvent("ticker-update"));
        }
      }

// 4. Page refresh
      if (p.need_refresh && p.page) {
        const currentPath = window.location.pathname;
        if (
          p.page === "*" ||
          currentPath.startsWith(p.page) ||
          currentPath === p.page
        ) {
          window.dispatchEvent(
            new CustomEvent("server-requested-refresh", {
              detail: {
                page: p.page,
                event: p.event || "",
                action: p.action || "",
              },
            }),
          );
        }
      }

      // 5. Generic data update — any page can listen
      if (p.page_id && p.data != null) {
        window.dispatchEvent(
          new CustomEvent("data-update", {
            detail: { page_id: p.page_id, data: p.data },
          }),
        );
      }

      // 6. Component refresh (legacy)
      if (p.comp_refresh) {
        window.dispatchEvent(
          new CustomEvent("comp-refresh", {
            detail: { action: p.action, event: p.event, page: p.page },
          }),
        );
      }

      // 7. Sound
      if (playAudio) {
        playSound(sseSound);
      }

      // Bridge to NotificationHub for cross-page persistence (respect hub setting)
      try {
        const shouldHub = p.hub !== false && (ns.hub !== false);
        if (shouldHub) {
          NotificationFacade.emit(p.event, p.sub_type || "", p);
        }
      } catch {}
    } catch (e) {
      console.warn("[NotificationWatcher] Failed to handle event:", e);
    }
  }, []);

  const handleMt5Event = useCallback((payload) => {
    try {
      const p = typeof payload === "string" ? JSON.parse(payload) : payload;
      const eventName = String(p?.event || "").toUpperCase();
      const dataList = Array.isArray(p?.data) ? p.data : [];
      window.dispatchEvent(
        new CustomEvent("mt5-realtime-event", {
          detail: p,
        }),
      );
      if (eventName !== "BROKER_SYNC" || !dataList.length) return;
      const existing = new Map(
        (window.__tickerFilledTrades || []).map((t) => [String(t.sid), t]),
      );
      let changed = false;
      for (const row of dataList) {
        const sid = String(row?.sid || "").trim();
        if (!sid) continue;
        const status = String(row?.execution_status || "").trim().toUpperCase();
        const isSettled = status === "FILLED" || status === "CLOSED";
        if (!isSettled) {
          if (existing.has(sid)) {
            existing.delete(sid);
            changed = true;
          }
          continue;
        }
        const rawPnl = row?.pnl_realized ?? row?.broker_pnl ?? row?.pnl;
        const next = {
          sid,
          symbol: String(row?.symbol || "").toUpperCase(),
          pnl: Number.isFinite(Number(rawPnl)) ? Number(rawPnl) : null,
          ts: Date.now(),
        };
        const prev = existing.get(sid);
        if (!prev || prev.symbol !== next.symbol || Number(prev.pnl) !== Number(next.pnl)) {
          existing.set(sid, next);
          changed = true;
        }
      }
      if (!changed) return;
      window.__tickerFilledTrades = [...existing.values()]
        .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
        .slice(0, 12);
      window.dispatchEvent(new CustomEvent("ticker-update"));
    } catch (error) {
      console.warn("[NotificationWatcher] Failed to handle mt5 event:", error);
    }
  }, []);

  useEffect(() => {
    notificationUnsubscribeRef.current = realtimeClient.subscribe(
      "notifications:self",
      {},
      (envelope) => {
        if (!envelope?.data) return;
        handleEvent(envelope.data);
      },
      {
        onError: (error) => {
          if (!isTransientRealtimeError(error) || shouldLogRealtimeWarnings()) {
            console.warn("[NotificationWatcher] realtime notifications error:", error);
          }
        },
      },
    );
    mt5UnsubscribeRef.current = realtimeClient.subscribe(
      "broker:self",
      {},
      (envelope) => {
        if (!envelope?.data) return;
        handleMt5Event(envelope.data);
      },
      {
        onError: (error) => {
          if (!isTransientRealtimeError(error) || shouldLogRealtimeWarnings()) {
            console.warn("[NotificationWatcher] realtime broker error:", error);
          }
        },
      },
    );
    return () => {
      if (typeof notificationUnsubscribeRef.current === "function") {
        notificationUnsubscribeRef.current();
      }
      if (typeof mt5UnsubscribeRef.current === "function") {
        mt5UnsubscribeRef.current();
      }
      notificationUnsubscribeRef.current = null;
      mt5UnsubscribeRef.current = null;
    };
  }, [handleEvent, handleMt5Event]);

  return null;
}
