import { useEffect } from "react";

/**
 * Generic realtime data hook — any page can use.
 * Listens for SSE `data-update` events matching `pageId`.
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
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.page_id === pageId) {
        onData(e.detail.data);
      }
    };
    window.addEventListener("data-update", handler);
    return () => window.removeEventListener("data-update", handler);
  }, [pageId, onData]);
}
