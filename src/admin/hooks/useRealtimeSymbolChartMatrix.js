import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { chartStreamStore, realtimeClient } from "../realtime/realtimeClientSingleton";

function normalizeSymbol(rawSymbol = "") {
  const base = String(rawSymbol || "")
    .trim()
    .toUpperCase();
  if (!base) return "";
  return base.includes(":") ? base.split(":").pop().trim().toUpperCase() : base;
}

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
  if (["d", "1d", "day", "1440"].includes(value)) return "d";
  return value;
}

function buildChartTopic(symbol, timeframe) {
  const sym = normalizeSymbol(symbol);
  const tf = normalizeTimeframe(timeframe);
  return sym && tf ? `chart:${sym}:${tf}` : "";
}

const EMPTY_STATE = {
  status: "IDLE",
  error: "",
  cachedAt: null,
  liveKey: 0,
  snapMsg: "",
  snapshotState: {
    stage: "idle",
    message: "",
  },
  refresh: async () => null,
  refreshTf: async () => null,
  master: null,
};

export function useRealtimeSymbolChartMatrix({
  enabled = false,
  symbol = "",
  timeframes = [],
  bars = 300,
  pollMs = 2500,
}) {
  const symbolNorm = useMemo(() => normalizeSymbol(symbol), [symbol]);
  const tfKeys = useMemo(
    () =>
      [...new Set((Array.isArray(timeframes) ? timeframes : []).map(normalizeTimeframe).filter(Boolean))],
    [timeframes],
  );
  const topicEntries = useMemo(
    () =>
      tfKeys
        .map((timeframe) => ({
          timeframe,
          topic: buildChartTopic(symbolNorm, timeframe),
        }))
        .filter((entry) => entry.topic),
    [symbolNorm, tfKeys],
  );
  const topicKey = useMemo(
    () => topicEntries.map((entry) => entry.topic).join("|"),
    [topicEntries],
  );
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !symbolNorm || !topicEntries.length) return undefined;
    const storeUnsubs = [];
    const streamUnsubs = [];
    let cancelled = false;

    for (const entry of topicEntries) {
      storeUnsubs.push(
        chartStreamStore.subscribe(entry.topic, () => {
          setVersion((prev) => prev + 1);
        }),
      );
      chartStreamStore.setConnected(entry.topic, false);
      api
        .realtimeChartBootstrap(symbolNorm, entry.timeframe, bars)
        .then((response) => {
          if (cancelled || !response?.snapshot) return;
          chartStreamStore.setBootstrap(entry.topic, response.snapshot);
        })
        .catch((error) => {
          if (cancelled) return;
          chartStreamStore.setError(entry.topic, error?.message || error);
        });
      streamUnsubs.push(
        realtimeClient.subscribe(
          entry.topic,
          { bars, pollMs },
          (envelope) => {
            chartStreamStore.applyEnvelope(envelope);
          },
          {
            onOpen: () => chartStreamStore.setConnected(entry.topic, true),
            onError: (error) => {
              chartStreamStore.setConnected(entry.topic, false);
              if (error) {
                chartStreamStore.setError(entry.topic, "Realtime connection lost");
              }
            },
          },
        ),
      );
    }

    return () => {
      cancelled = true;
      for (const fn of streamUnsubs) fn?.();
      for (const fn of storeUnsubs) fn?.();
    };
  }, [bars, enabled, pollMs, symbolNorm, topicEntries, topicKey]);

  return useMemo(() => {
    if (!enabled || !symbolNorm || !topicEntries.length) return EMPTY_STATE;
    const states = topicEntries.map((entry) => ({
      timeframe: entry.timeframe,
      topic: entry.topic,
      state: chartStreamStore.getState(entry.topic),
    }));
    const hasReady = states.some((entry) => entry.state.status === "READY");
    const hasConnecting = states.some(
      (entry) => entry.state.status === "CONNECTING" || entry.state.connected,
    );
    const hasError = states.some((entry) => entry.state.status === "ERROR");
    const allEmpty = states.every(
      (entry) =>
        entry.state.status === "EMPTY" ||
        entry.state.status === "IDLE" ||
        !Array.isArray(entry.state.bars) ||
        entry.state.bars.length === 0,
    );
    const cachedAt = states.reduce((latest, entry) => {
      const next = Number(entry.state.lastUpdatedAt || 0);
      return next > latest ? next : latest;
    }, 0);
    const master = {
      bars: {},
      context: {},
      snapshots: {},
      cached_at: cachedAt || Date.now(),
    };
    for (const entry of states) {
      master.bars[entry.timeframe] = Array.isArray(entry.state.bars)
        ? entry.state.bars
        : [];
      master.context[entry.timeframe] = {
        last_price: Number(entry.state.lastPrice) || null,
        freshness: "stream",
        provider: "realtime",
        metadata: {
          ...(entry.state.metadata && typeof entry.state.metadata === "object"
            ? entry.state.metadata
            : {}),
          stream_connected: Boolean(entry.state.connected),
          stream_status: String(entry.state.status || "IDLE").toUpperCase(),
          stream_topic: entry.topic,
        },
        cache_source: "stream",
        reason: "realtime_stream",
        cached_at: entry.state.lastUpdatedAt || cachedAt || Date.now(),
      };
    }
    return {
      status: hasReady ? "READY" : hasConnecting ? "LOADING" : hasError ? "ERROR" : allEmpty ? "IDLE" : "IDLE",
      error: hasError
        ? states.find((entry) => entry.state.status === "ERROR")?.state?.error || ""
        : "",
      cachedAt: cachedAt || Date.now(),
      liveKey: cachedAt || 0,
      snapMsg: "",
      snapshotState: {
        stage: hasError ? "error" : "idle",
        message: hasError
          ? states.find((entry) => entry.state.status === "ERROR")?.state?.error || ""
          : "",
      },
      refresh: async () => null,
      refreshTf: async () => null,
      master,
    };
  }, [enabled, symbolNorm, topicEntries, topicKey]);
}
