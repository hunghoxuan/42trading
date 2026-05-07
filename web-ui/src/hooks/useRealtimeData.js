import { useEffect, useRef } from "react";

/**
 * Generic realtime data hook — any page can use.
 * Listens for SSE `data-update` events matching `pageId`.
 *
 * Uses a ref for the callback so the event listener is not re-registered
 * on every render (which could cause missed events between cleanup and re-add).
 *
 * Usage:
 *   useRealtimeData("trades", (data) => {
 *     setRows(prev => prev.map(r => {
 *       const u = data.find(d => d.sid === tradeKeyOf(r));
 *       return u ? { ...r, ...u } : r;
 *     }));
 *   });
 */
export function useRealtimeData(pageId, onData) {
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.page_id === pageId) {
        onDataRef.current(e.detail.data);
      }
    };
    window.addEventListener("data-update", handler);
    return () => window.removeEventListener("data-update", handler);
  }, [pageId]);
}
