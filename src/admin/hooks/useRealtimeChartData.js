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
  if (["1m", "1min", "m1"].includes(value)) return "1m";
  if (["5m", "5min", "m5", "5"].includes(value)) return "5m";
  if (["15m", "15min", "m15", "15"].includes(value)) return "15m";
  if (["1h", "60", "h1"].includes(value)) return "1h";
  if (["4h", "240", "h4"].includes(value)) return "4h";
  if (["d", "1d", "day"].includes(value)) return "d";
  return value;
}

function buildChartTopic(symbol, timeframe) {
  const sym = normalizeSymbol(symbol);
  const tf = normalizeTimeframe(timeframe);
  return sym && tf ? `chart:${sym}:${tf}` : "";
}

export function useRealtimeChartData({
  symbol = "",
  timeframe = "5m",
  bars = 300,
  pollMs = 2500,
}) {
  const topic = useMemo(
    () => buildChartTopic(symbol, timeframe),
    [symbol, timeframe],
  );
  const [state, setState] = useState(() => chartStreamStore.getState(topic));

  useEffect(() => {
    if (!topic) return undefined;
    setState(chartStreamStore.getState(topic));
    const unsubscribeStore = chartStreamStore.subscribe(topic, setState);
    chartStreamStore.setConnected(topic, false);
    let cancelled = false;

    api
      .realtimeChartBootstrap(symbol, timeframe, bars)
      .then((response) => {
        if (cancelled || !response?.snapshot) return;
        chartStreamStore.setBootstrap(topic, response.snapshot);
      })
      .catch((error) => {
        if (cancelled) return;
        chartStreamStore.setError(topic, error?.message || error);
      });

    const unsubscribeRealtime = realtimeClient.subscribe(
      topic,
      { bars, pollMs },
      (envelope) => {
        chartStreamStore.applyEnvelope(envelope);
      },
      {
        onOpen: () => chartStreamStore.setConnected(topic, true),
        onError: (error) => {
          chartStreamStore.setConnected(topic, false);
          if (error) {
            chartStreamStore.setError(topic, "Realtime connection lost");
          }
        },
      },
    );

    return () => {
      cancelled = true;
      unsubscribeRealtime();
      unsubscribeStore();
    };
  }, [bars, pollMs, symbol, timeframe, topic]);

  return {
    ...state,
    topic,
  };
}
