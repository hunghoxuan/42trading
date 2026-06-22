import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const barsStorage = require("../src/api/marketData/marketDataRepo");

function makeTempDataRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bars-time-"));
}

function writeCsvBars(dataRoot, symbol, tf, rows) {
  const filePath = path.join(dataRoot, "market_data", symbol, "bars", `${tf}.csv`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = ["time,open,high,low,close,volume"];
  for (const row of rows) {
    lines.push(
      [row.time, row.open, row.high, row.low, row.close, row.volume ?? 0].join(","),
    );
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

test("parseTfTokenToSeconds normalizes supported timeframe aliases", () => {
  assert.equal(barsStorage.parseTfTokenToSeconds("1"), 60);
  assert.equal(barsStorage.parseTfTokenToSeconds("5m"), 300);
  assert.equal(barsStorage.parseTfTokenToSeconds("15min"), 900);
  assert.equal(barsStorage.parseTfTokenToSeconds("1h"), 3600);
  assert.equal(barsStorage.parseTfTokenToSeconds("240"), 14400);
  assert.equal(barsStorage.parseTfTokenToSeconds("1d"), 86400);
});

test("normalizeBarTimeToUTC floors timestamps to timeframe bucket boundaries", () => {
  assert.equal(barsStorage.normalizeBarTimeToUTC(1781699696, 60), 1781699640);
  assert.equal(barsStorage.normalizeBarTimeToUTC(1781699696, 300), 1781699400);
  assert.equal(barsStorage.normalizeBarTimeToUTC(1781699696, 900), 1781699400);
  assert.equal(barsStorage.normalizeBarTimeToUTC(1781699696, 3600), 1781697600);
});

test("aggregateBarsFromLowerTimeframe builds correct OHLCV and bucket timestamps", () => {
  const bars = [
    { time: 0, open: 1.0, high: 1.1, low: 0.9, close: 1.02, volume: 10 },
    { time: 300, open: 1.02, high: 1.15, low: 1.0, close: 1.1, volume: 11 },
    { time: 600, open: 1.1, high: 1.18, low: 1.05, close: 1.12, volume: 12 },
    { time: 900, open: 1.12, high: 1.2, low: 1.08, close: 1.18, volume: 13 },
    { time: 1200, open: 1.18, high: 1.22, low: 1.12, close: 1.16, volume: 14 },
    { time: 1500, open: 1.16, high: 1.19, low: 1.1, close: 1.11, volume: 15 },
  ];
  const aggregated = barsStorage.aggregateBarsFromLowerTimeframe(
    bars,
    15 * 60,
    5 * 60,
    0,
  );
  assert.deepEqual(aggregated, [
    {
      time: 0,
      open: 1.0,
      high: 1.18,
      low: 0.9,
      close: 1.12,
      volume: 33,
    },
    {
      time: 900,
      open: 1.12,
      high: 1.22,
      low: 1.08,
      close: 1.11,
      volume: 42,
    },
  ]);
});

test("readBrokerBarsFromFile derives 15m from stored 5m when 15m file is missing", () => {
  const dataRoot = makeTempDataRoot();
  writeCsvBars(dataRoot, "TESTPAIR", "5", [
    { time: 0, open: 1.0, high: 1.1, low: 0.9, close: 1.02, volume: 10 },
    { time: 300, open: 1.02, high: 1.15, low: 1.0, close: 1.1, volume: 11 },
    { time: 600, open: 1.1, high: 1.18, low: 1.05, close: 1.12, volume: 12 },
  ]);

  const rows = barsStorage.readBrokerBarsFromFile("TESTPAIR", "15", 100, {
    dataRoot,
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    time: 0,
    open: 1,
    high: 1.18,
    low: 0.9,
    close: 1.12,
    volume: 33,
  });
});

test("readBrokerBarsFromFile honors small limits when anchoring to an end time", () => {
  const dataRoot = makeTempDataRoot();
  writeCsvBars(dataRoot, "TESTPAIR", "1", [
    { time: 60, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { time: 120, open: 1.5, high: 2.5, low: 1, close: 2, volume: 11 },
    { time: 180, open: 2, high: 3, low: 1.5, close: 2.5, volume: 12 },
    { time: 240, open: 2.5, high: 3.5, low: 2, close: 3, volume: 13 },
    { time: 300, open: 3, high: 4, low: 2.5, close: 3.5, volume: 14 },
    { time: 360, open: 3.5, high: 4.5, low: 3, close: 4, volume: 15 },
  ]);

  const rows = barsStorage.readBrokerBarsFromFile("TESTPAIR", "1", 2, {
    dataRoot,
    endTimeSec: 300,
  });

  assert.deepEqual(
    rows.map((row) => row.time),
    [240, 300],
  );
});
