"use strict";

const fs = require("fs");

const marketDataDomain = require("../marketData");
const {
  buildChartTopic,
  normalizeBars,
  normalizeSymbol,
  normalizeTimeframe,
} = require("./realtimeCore");

const barsStorage = marketDataDomain.marketDataRepo;

function loadChartSnapshot({
  symbol = "",
  timeframe = "",
  bars = 300,
  dataRoot,
  duckdbPath,
  endTimeSec = null,
}) {
  const symbolNorm = normalizeSymbol(symbol);
  const tfNorm = normalizeTimeframe(timeframe);
  const limit = Math.max(50, Math.min(5000, Number(bars) || 300));
  if (!symbolNorm || !tfNorm) {
    throw new Error("symbol and timeframe are required");
  }
  const rows = barsStorage.readBrokerBarsFromFile(symbolNorm, tfNorm, limit, {
    dataRoot,
    duckdbPath,
    endTimeSec: Number.isFinite(Number(endTimeSec)) && Number(endTimeSec) > 0
      ? Number(endTimeSec)
      : null,
  });
  const normalizedBars = normalizeBars(rows);
  const filePath = dataRoot
    ? barsStorage.resolveBrokerBarsFilePath(symbolNorm, tfNorm, { dataRoot })
    : "";
  const fileUpdatedAt =
    filePath && fs.existsSync(filePath)
      ? fs.statSync(filePath).mtime.toISOString()
      : null;
  const lastBar = normalizedBars.length
    ? normalizedBars[normalizedBars.length - 1]
    : null;
  return {
    topic: buildChartTopic(symbolNorm, tfNorm),
    symbol: symbolNorm,
    timeframe: tfNorm,
    bars: normalizedBars,
    lastPrice: Number(lastBar?.close) || null,
    metadata: {
      bars_count: normalizedBars.length,
      file_updated_at: fileUpdatedAt,
      source_kind: "broker",
      storage_provider: barsStorage.getBarsStorageProvider(),
    },
  };
}

function barsEqual(left, right) {
  return (
    Number(left?.time) === Number(right?.time) &&
    Number(left?.open) === Number(right?.open) &&
    Number(left?.high) === Number(right?.high) &&
    Number(left?.low) === Number(right?.low) &&
    Number(left?.close) === Number(right?.close) &&
    Number(left?.volume || 0) === Number(right?.volume || 0)
  );
}

function diffChartSnapshots(previousSnapshot, nextSnapshot) {
  if (!previousSnapshot) {
    return [
      {
        type: "snapshot",
        data: nextSnapshot,
      },
    ];
  }
  const prevBars = Array.isArray(previousSnapshot?.bars)
    ? previousSnapshot.bars
    : [];
  const nextBars = Array.isArray(nextSnapshot?.bars) ? nextSnapshot.bars : [];
  if (!prevBars.length && nextBars.length) {
    return [
      {
        type: "snapshot",
        data: nextSnapshot,
      },
    ];
  }
  if (prevBars.length !== nextBars.length) {
    return [
      {
        type: "snapshot",
        data: nextSnapshot,
      },
    ];
  }
  const prevLastBar = prevBars.length ? prevBars[prevBars.length - 1] : null;
  const nextLastBar = nextBars.length ? nextBars[nextBars.length - 1] : null;
  if (nextLastBar && !barsEqual(prevLastBar, nextLastBar)) {
    return [
      {
        type: "bar_update",
        data: {
          symbol: nextSnapshot.symbol,
          timeframe: nextSnapshot.timeframe,
          bar: nextLastBar,
          metadata: nextSnapshot.metadata,
        },
      },
    ];
  }
  if (Number(previousSnapshot?.lastPrice) !== Number(nextSnapshot?.lastPrice)) {
    return [
      {
        type: "price_tick",
        data: {
          symbol: nextSnapshot.symbol,
          timeframe: nextSnapshot.timeframe,
          lastPrice: nextSnapshot.lastPrice,
        },
      },
    ];
  }
  return [];
}

module.exports = {
  diffChartSnapshots,
  loadChartSnapshot,
};
