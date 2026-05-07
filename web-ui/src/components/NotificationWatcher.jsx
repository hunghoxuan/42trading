import { useEffect, useRef, useCallback } from "react";
import { api } from "../api";
import { playSound, SoundEvents } from "../utils/SoundManager";
import { showToast } from "./ToastContainer";

window.__tickerEvents = window.__tickerEvents || [];

/**
 * Global component: SSE stream listener for real-time notifications.
 * Dispatches events to: browser notification, console log, ticker, page refresh, sound.
 */
export default function NotificationWatcher() {
  const esRef = useRef(null);
  const reconnectTimer = useRef(null);
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
      const shouldShowToast =
        ns.toast !== false &&
        p.notification !== false &&
        userPref.notification !== false;
      const showTicker =
        ns.ticker !== false && p.ticker !== false && userPref.ticker !== false;
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

      // 3. Ticker — dedup: skip if same message+event as last entry
      if (showTicker) {
        const last = window.__tickerEvents[window.__tickerEvents.length - 1];
        if (!last || last.message !== p.message || last.event !== p.event) {
          window.__tickerEvents.push({
            ts: Date.now(),
            event: p.event,
            message: p.message,
            type: p.type,
          });
          if (window.__tickerEvents.length > 50) window.__tickerEvents.shift();
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
          window.location.reload();
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
    } catch (e) {
      console.warn("[NotificationWatcher] Failed to handle event:", e);
    }
  }, []);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }
    try {
      const es = api.notificationStream();
      esRef.current = es;
      es.onmessage = (e) => {
        if (!e.data || e.data.startsWith(":")) return; // heartbeat
        handleEvent(e.data);
      };
      es.onerror = () => {
        es.close();
        esRef.current = null;
        // Reconnect after 5s
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(connect, 5000);
      };
    } catch (e) {
      console.warn(
        "[NotificationWatcher] SSE connect failed, retrying in 5s:",
        e,
      );
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connect, 5000);
    }
  }, [handleEvent]);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) esRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  return null;
}
