import { useMemo } from "react";
import { useRealtimeChartData } from "./useRealtimeChartData";

function normalizeTimeframe(rawTf = "") {
  const value = String(rawTf || "")
    .trim()
    .toLowerCase();
  if (!value) return "";
  if (["1", "1m", "1min", "m1"].includes(value)) return "1m";
  if (["5", "5m", "5min", "m5"].includes(value)) return "5m";
  if (["15", "15m", "15min", "m15"].includes(value)) return "15m";
  if (["60", "1h", "h1"].includes(value)) return "1h";
  if (["240", "4h", "h4"].includes(value)) return "4h";
  if (["d", "1d", "day"].includes(value)) return "d";
  return value;
}

export function useRealtimeSymbolChartAdapter({
  symbol = "",
  timeframe = "5m",
  bars = 300,
  pollMs = 2500,
  replaySession = null,
}) {
  const liveState = useRealtimeChartData({
    symbol,
    timeframe,
    bars,
    pollMs,
  });

  const tfKey = useMemo(() => normalizeTimeframe(timeframe), [timeframe]);

  return useMemo(() => {
    const replayBars = Array.isArray(replaySession?.visibleBars)
      ? replaySession.visibleBars
      : [];
    const barsToRender = replayBars.length ? replayBars : liveState.bars;
    const liveStatus = String(liveState.status || "IDLE").toUpperCase();
    const replayActive = Boolean(replaySession?.sessionId);
    const status =
      liveStatus === "CONNECTING"
        ? "LOADING"
        : liveStatus === "EMPTY"
          ? "IDLE"
          : liveStatus || "IDLE";
    const lastUpdatedAt =
      replaySession?.lastUpdatedAt ||
      liveState.lastUpdatedAt ||
      Date.now();
    return {
      status: replayActive && replayBars.length ? "READY" : status,
      error: liveState.error || "",
      cachedAt: lastUpdatedAt,
      liveKey: 0,
      snapMsg: "",
      snapshotState: {
        stage: liveState.error ? "error" : "idle",
        message: liveState.error || "",
      },
      refresh: async () => null,
      refreshTf: async () => null,
      master: tfKey
        ? {
            bars: {
              [tfKey]: barsToRender,
            },
            context: {
              [tfKey]: {
                last_price:
                  Number(replayBars[replayBars.length - 1]?.close) ||
                  liveState.lastPrice ||
                  null,
                freshness: replayActive ? "replay" : "stream",
                provider: replayActive ? "replay" : "realtime",
                metadata: replayActive
                  ? {
                      replay_session_id: replaySession?.sessionId || "",
                      replay_playing: Boolean(replaySession?.playing),
                      replay_cursor_index: Number(replaySession?.cursorIndex) || 0,
                    }
                  : {
                      stream_connected: Boolean(liveState.connected),
                      stream_status: String(liveState.status || "IDLE").toUpperCase(),
                      stream_topic: liveState.topic || "",
                    },
                cache_source: replayActive ? "replay" : "stream",
                reason: replayActive ? "server_replay" : "realtime_stream",
                cached_at: lastUpdatedAt,
              },
            },
            snapshots: {},
            cached_at: lastUpdatedAt,
          }
        : null,
    };
  }, [
    liveState.bars,
    liveState.connected,
    liveState.error,
    liveState.lastPrice,
    liveState.lastUpdatedAt,
    liveState.status,
    liveState.topic,
    replaySession?.cursorIndex,
    replaySession?.lastUpdatedAt,
    replaySession?.playing,
    replaySession?.sessionId,
    replaySession?.visibleBars,
    tfKey,
  ]);
}
