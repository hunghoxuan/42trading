import { useEffect, useRef, useCallback } from "react";
import { api } from "../api";
import { playSound, SoundEvents } from "../utils/SoundManager";
import {
  formatNotificationLine,
  isMeaningfulEntry,
  normalizeServerEntry,
} from "../utils/notificationDisplay";
import { showToast } from "../../shared/components/ToastContainer";
import { NotificationFacade } from "../services/NotificationFacade";
import { realtimeClient } from "../realtime/realtimeClientSingleton";

window.__tickerFilledTrades = window.__tickerFilledTrades || [];
window.__tickerMessages = window.__tickerMessages || [];

/**
 * Global component: SSE stream listener for real-time notifications.
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
        showToast({
          message:
            p.message ||
            `[${(p.event || "").replace(/_/g, " ").toUpperCase()}]`,
          type: p.type,
          position: p.position || "bottom-right",
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
          console.warn("[NotificationWatcher] realtime notifications error:", error);
        },
      },
    );
    mt5UnsubscribeRef.current = realtimeClient.subscribe(
      "mt5:self",
      {},
      (envelope) => {
        if (!envelope?.data) return;
        handleMt5Event(envelope.data);
      },
      {
        onError: (error) => {
          console.warn("[NotificationWatcher] realtime mt5 error:", error);
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
