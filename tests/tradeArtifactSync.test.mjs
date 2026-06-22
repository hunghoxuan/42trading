import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const helpers = require("../src/api/trades/tradeArtifactSync");
const chartArtifactService = require("../src/api/charts/chartArtifactService");
let barsStorage = null;
try {
  barsStorage = require("../src/api/marketData/marketDataRepo");
} catch {
  barsStorage = null;
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trade-artifact-sync-"));
}

test("renameSnapshotForTrade appends timestamp and status", () => {
  const out = helpers.renameSnapshotForTrade("USDCAD_D.png", {
    status: "pending",
    timestamp: new Date("2026-06-08T09:47:06.123Z"),
  });
  assert.equal(out, "USDCAD_D_20260608_094706_123UTC_pending.png");
});

test("provider-neutral bar artifact helpers are exported", () => {
  assert.equal(typeof helpers.copyMarketDataBarsToTradeDir, "function");
  assert.equal(typeof helpers.copyAllMarketDataBarsToTradeDir, "function");
});

test("bars storage service exports provider-neutral read write and migration helpers", () => {
  assert.equal(typeof barsStorage?.createBarsRepository, "function");
  assert.equal(typeof barsStorage?.readBars, "function");
  assert.equal(typeof barsStorage?.mergeBars, "function");
  assert.equal(typeof barsStorage?.overwriteBars, "function");
  assert.equal(typeof barsStorage?.resolveBarsPath, "function");
  assert.equal(typeof barsStorage?.readBrokerBarsFromFile, "function");
  assert.equal(typeof barsStorage?.mergeBrokerBarsIntoFile, "function");
  assert.equal(typeof barsStorage?.migrateAllCsvBarsToParquet, "function");
  assert.equal(typeof barsStorage?.overwriteBrokerBarsFile, "function");
});

test("chart artifact service stores indicators, zones, levels, and patterns in one market artifact file", () => {
  const root = makeTempDir();
  try {
    const dataRoot = path.join(root, "data");
    const bars = [
      { time: 60, open: 100, high: 102, low: 99, close: 101, volume: 10 },
      { time: 120, open: 101, high: 103, low: 100, close: 102, volume: 11 },
      { time: 180, open: 102, high: 104, low: 101, close: 103, volume: 12 },
      { time: 240, open: 103, high: 103.2, low: 100.5, close: 101, volume: 13 },
      { time: 300, open: 100.8, high: 101.2, low: 98.8, close: 99.2, volume: 14 },
      { time: 360, open: 99.1, high: 100.9, low: 98.9, close: 100.8, volume: 15 },
      { time: 420, open: 101.5, high: 105.5, low: 101.2, close: 105.1, volume: 16 },
      { time: 480, open: 105.3, high: 106.0, low: 105.2, close: 105.8, volume: 17 },
      { time: 540, open: 106.2, high: 106.5, low: 105.9, close: 106.1, volume: 18 },
    ];
    const envelope = chartArtifactService.mergeMarketArtifacts({
      symbol: "BTCUSD",
      timeframe: "15",
      bars,
      indicators: {
        ema20: [{ time: 540, value: 104.5 }],
      },
      metadata: {
        provider: "test",
        pd_arrays: [
          {
            id: "pd-1",
            type: "FVG",
            direction: "Bullish",
            timeframe: "15",
            low: 104.0,
            high: 105.0,
          },
        ],
        key_levels: [
          { name: "PDH", price: 106.2, kind: "session" },
        ],
      },
      provider: "test",
      userId: "default",
    });
    chartArtifactService.writeMarketArtifacts("BTCUSD", "15", envelope, {
      dataRoot,
    });

    const stored = chartArtifactService.readMarketArtifacts("BTCUSD", "15", {
      dataRoot,
    });
    assert.equal(stored.scope.symbol, "BTCUSD");
    assert.equal(stored.scope.timeframe, "15");
    assert.deepEqual(stored.series.indicators.ema20, [{ time: 540, value: 104.5 }]);
    assert.ok(Array.isArray(stored.items));
    assert.ok(stored.items.some((item) => item.family === "zone" && item.source === "ai"));
    assert.ok(stored.items.some((item) => item.family === "level" && item.label === "PDH"));
    assert.ok(stored.items.some((item) => item.family === "pattern"));
    assert.ok(stored.items.some((item) => item.family === "zone" && item.type === "fvg"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("chart artifact service stores market artifacts by symbol timeframe and time window", () => {
  const root = makeTempDir();
  try {
    const dataRoot = path.join(root, "data");
    const bars = [
      { time: 900, open: 100, high: 104, low: 99, close: 103, volume: 10 },
      { time: 1800, open: 103, high: 107, low: 102, close: 106, volume: 12 },
    ];
    const envelope = chartArtifactService.mergeMarketArtifacts({
      symbol: "XAUUSD",
      timeframe: "15",
      bars,
      indicators: { ema20: [{ time: 1800, value: 104 }] },
      metadata: {},
      provider: "test",
      startTime: 900,
      endTime: 1800,
    });
    chartArtifactService.writeMarketArtifacts("XAUUSD", "15", envelope, {
      dataRoot,
      startTime: 900,
      endTime: 1800,
    });

    const rangedPath = chartArtifactService.resolveMarketArtifactPath(
      "XAUUSD",
      "15",
      {
        dataRoot,
        startTime: 900,
        endTime: 1800,
      },
    );
    assert.equal(fs.existsSync(rangedPath), true);
    assert.match(rangedPath, /chart\/15\/900_1800\.json$/);

    const latestPath = chartArtifactService.resolveMarketArtifactPath(
      "XAUUSD",
      "15",
      {
        dataRoot,
      },
    );
    assert.equal(fs.existsSync(latestPath), true);
    assert.match(latestPath, /chart\/15\/latest\.json$/);

    const stored = chartArtifactService.readMarketArtifacts("XAUUSD", "15", {
      dataRoot,
      startTime: 900,
      endTime: 1800,
    });
    assert.equal(stored.bars_ref.requested_start_time, 900);
    assert.equal(stored.bars_ref.requested_end_time, 1800);
    assert.equal(stored.bars_ref.first_bar_time, 900);
    assert.equal(stored.bars_ref.last_bar_time, 1800);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("chart artifact service derives strong FVG, order blocks, and liquidity from bars", () => {
  const displacementBars = [
    { time: 60, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
    { time: 120, open: 100.5, high: 103, low: 100, close: 102.5, volume: 11 },
    { time: 180, open: 102.5, high: 103, low: 100.5, close: 101, volume: 12 },
    { time: 240, open: 101, high: 103, low: 100.8, close: 102.8, volume: 13 },
    { time: 300, open: 102.8, high: 104.9, low: 102.7, close: 104.7, volume: 14 },
    { time: 360, open: 104.6, high: 105.0, low: 104.2, close: 104.8, volume: 15 },
    { time: 420, open: 104.8, high: 105.1, low: 104.5, close: 104.9, volume: 16 },
    { time: 480, open: 104.9, high: 105.0, low: 104.6, close: 104.7, volume: 17 },
    { time: 540, open: 104.7, high: 104.8, low: 102.0, close: 102.2, volume: 18 },
    { time: 600, open: 102.0, high: 102.1, low: 101.8, close: 101.9, volume: 19 },
    { time: 660, open: 101.9, high: 104.95, low: 101.7, close: 104.7, volume: 20 },
    { time: 720, open: 105.6, high: 108.8, low: 105.5, close: 108.5, volume: 21 },
    { time: 780, open: 108.7, high: 109.2, low: 108.6, close: 109.0, volume: 22 },
    { time: 840, open: 109.0, high: 109.1, low: 108.8, close: 108.9, volume: 23 },
    { time: 900, open: 108.9, high: 109.0, low: 108.7, close: 108.8, volume: 24 },
  ];
  const displacementEnvelope = chartArtifactService.mergeMarketArtifacts({
    symbol: "BTCUSD",
    timeframe: "15",
    bars: displacementBars,
    indicators: {},
    metadata: {},
    provider: "test",
  });

  assert.ok(displacementEnvelope.items.some((item) => item.type === "ob"));
  assert.ok(
    displacementEnvelope.items.some(
      (item) =>
        item.type === "fvg" &&
        item.subtype === "bullish" &&
        item.payload?.strength === "strong",
    ),
  );

  const liquidityBars = [
    { time: 60, open: 100, high: 101, low: 99.5, close: 100.8, volume: 10 },
    { time: 120, open: 100.8, high: 103, low: 100.6, close: 102.8, volume: 11 },
    { time: 180, open: 102.8, high: 105.0, low: 102.4, close: 104.2, volume: 12 },
    { time: 240, open: 104.2, high: 103.9, low: 102.0, close: 102.4, volume: 13 },
    { time: 300, open: 102.4, high: 102.7, low: 101.6, close: 101.9, volume: 14 },
    { time: 360, open: 101.9, high: 104.0, low: 101.8, close: 103.7, volume: 15 },
    { time: 420, open: 103.7, high: 105.03, low: 103.5, close: 104.6, volume: 16 },
    { time: 480, open: 104.6, high: 104.0, low: 102.2, close: 102.5, volume: 17 },
    { time: 540, open: 102.5, high: 102.7, low: 101.7, close: 102.1, volume: 18 },
    { time: 600, open: 102.1, high: 102.4, low: 101.5, close: 101.8, volume: 19 },
  ];
  const liquidityEnvelope = chartArtifactService.mergeMarketArtifacts({
    symbol: "BTCUSD",
    timeframe: "15",
    bars: liquidityBars,
    indicators: {},
    metadata: {},
    provider: "test",
  });
  assert.ok(liquidityEnvelope.items.some((item) => item.type === "liquidity_high"));
});

test("chart artifact service derives PDH, PDL, support, and demand levels", () => {
  const sessionBars = [
    { time: 1718841600, open: 100, high: 106, low: 99, close: 105, volume: 10 },
    { time: 1718845200, open: 105, high: 107, low: 103, close: 104, volume: 11 },
    { time: 1718928000, open: 104, high: 105, low: 101, close: 102, volume: 12 },
    { time: 1718931600, open: 102, high: 103, low: 100, close: 101, volume: 13 },
    { time: 1718935200, open: 101, high: 104, low: 100.5, close: 103.8, volume: 14 },
    { time: 1718938800, open: 103.8, high: 107.2, low: 103.6, close: 106.9, volume: 15 },
    { time: 1718942400, open: 107.4, high: 109.8, low: 107.3, close: 109.5, volume: 16 },
    { time: 1718946000, open: 109.6, high: 110.0, low: 109.4, close: 109.8, volume: 17 },
  ];
  const sessionEnvelope = chartArtifactService.mergeMarketArtifacts({
    symbol: "BTCUSD",
    timeframe: "60",
    bars: sessionBars,
    indicators: {},
    metadata: {},
    provider: "test",
  });

  assert.ok(sessionEnvelope.items.some((item) => item.type === "pdh"));
  assert.ok(sessionEnvelope.items.some((item) => item.type === "pdl"));
  assert.ok(sessionEnvelope.items.some((item) => item.type === "support"));

  const demandBars = [
    { time: 60, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
    { time: 120, open: 100.5, high: 103, low: 100, close: 102.5, volume: 11 },
    { time: 180, open: 102.5, high: 103, low: 100.5, close: 101, volume: 12 },
    { time: 240, open: 101, high: 103, low: 100.8, close: 102.8, volume: 13 },
    { time: 300, open: 102.8, high: 104.9, low: 102.7, close: 104.7, volume: 14 },
    { time: 360, open: 104.6, high: 105.0, low: 104.2, close: 104.8, volume: 15 },
    { time: 420, open: 104.8, high: 105.1, low: 104.5, close: 104.9, volume: 16 },
    { time: 480, open: 104.9, high: 105.0, low: 104.6, close: 104.7, volume: 17 },
    { time: 540, open: 104.7, high: 104.8, low: 102.0, close: 102.2, volume: 18 },
    { time: 600, open: 102.0, high: 102.1, low: 101.8, close: 101.9, volume: 19 },
    { time: 660, open: 101.9, high: 104.95, low: 101.7, close: 104.7, volume: 20 },
    { time: 720, open: 105.6, high: 108.8, low: 105.5, close: 108.5, volume: 21 },
  ];
  const demandEnvelope = chartArtifactService.mergeMarketArtifacts({
    symbol: "BTCUSD",
    timeframe: "15",
    bars: demandBars,
    indicators: {},
    metadata: {},
    provider: "test",
  });
  assert.ok(demandEnvelope.items.some((item) => item.type === "demand"));
});

test("chart artifact service migrates legacy trade chart_objects and preserves compatibility extraction", () => {
  const root = makeTempDir();
  try {
    const tradeDir = path.join(root, "trade_draft", "TG123-BTCUSD");
    fs.mkdirSync(tradeDir, { recursive: true });
    const legacyObjects = [
      {
        id: "entry-1",
        type: "ENTRY",
        label: "Entry",
        price: 100,
        color: "#00ff00",
      },
      {
        id: "box-1",
        kind: "box",
        label: "Zone",
        time1: 60,
        time2: 120,
        y1: 99,
        y2: 101,
      },
    ];
    fs.writeFileSync(
      chartArtifactService.resolveLegacyTradeObjectsPath(tradeDir),
      JSON.stringify(legacyObjects, null, 2),
    );

    const migrated = chartArtifactService.readTradeArtifacts({
      tradeDir,
      tradeSid: "TG123",
      symbol: "BTCUSD",
      timeframe: "15",
    });
    assert.equal(migrated.scope.scope_type, "trade");
    assert.equal(migrated.items.length, 2);

    const extracted = chartArtifactService.extractLegacyChartObjects(migrated);
    assert.equal(extracted.length, 2);
    assert.equal(extracted[0].id, "entry-1");

    const saved = chartArtifactService.writeTradeArtifacts({
      tradeDir,
      tradeSid: "TG123",
      symbol: "BTCUSD",
      timeframe: "15",
      items: legacyObjects,
      existing: migrated,
    });
    assert.equal(saved.items.filter((item) => item.family === "object").length, 2);
    assert.equal(
      fs.existsSync(chartArtifactService.resolveTradeArtifactPath(tradeDir)),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("copyMarketDataBarCsvToTradeDir normalizes timeframe aliases into canonical trade bars", () => {
  const root = makeTempDir();
  try {
    const marketDataRoot = path.join(root, "market_data");
    const tradeDir = path.join(root, "trade_closed", "TG17ANAJL-USDCAD");
    const srcDir = path.join(marketDataRoot, "USDCAD", "bars");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "60.csv"),
      "time,open,high,low,close,volume\n1,1,2,0.5,1.5,10\n",
    );

    const ok = helpers.copyMarketDataBarCsvToTradeDir({
      marketDataRoot,
      tradeDir,
      symbol: "USDCAD",
      timeframe: "1h",
    });

    assert.equal(ok, true);
    assert.equal(
      fs.readFileSync(path.join(tradeDir, "bars", "60.csv"), "utf8"),
      "time,open,high,low,close,volume\n1,1,2,0.5,1.5,10\n",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("copyMarketDataBarsToTradeDir supports parquet market bar artifacts", () => {
  const root = makeTempDir();
  const prevProvider = process.env.BARS_STORAGE_PROVIDER;
  try {
    const marketDataRoot = path.join(root, "market_data");
    const tradeDir = path.join(root, "trade_closed", "TG17ANAJL-USDCAD");
    const srcDir = path.join(marketDataRoot, "USDCAD", "bars");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "60.parquet"), "parquet-data");
    fs.mkdirSync(path.join(tradeDir, "bars"), { recursive: true });
    fs.writeFileSync(path.join(tradeDir, "bars", "60.csv"), "stale-csv");
    process.env.BARS_STORAGE_PROVIDER = "parquet_duckdb";

    const ok = helpers.copyMarketDataBarsToTradeDir({
      marketDataRoot,
      tradeDir,
      symbol: "USDCAD",
      timeframe: "1h",
    });

    assert.equal(ok, true);
    assert.equal(fs.existsSync(path.join(tradeDir, "bars", "60.csv")), false);
    assert.equal(
      fs.readFileSync(path.join(tradeDir, "bars", "60.parquet"), "utf8"),
      "parquet-data",
    );
  } finally {
    if (prevProvider === undefined) delete process.env.BARS_STORAGE_PROVIDER;
    else process.env.BARS_STORAGE_PROVIDER = prevProvider;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("copyMarketDataSnapshotsToTradeDir renames copied snapshots for the trade folder", () => {
  const root = makeTempDir();
  try {
    const snapshotRoot = path.join(root, "market_data");
    const tradeDir = path.join(root, "trade_closed", "TG17ANAJL-USDCAD");
    const srcDir = path.join(snapshotRoot, "USDCAD");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "USDCAD_D.png"), "png-data");

    const copied = helpers.copyMarketDataSnapshotsToTradeDir({
      snapshotRoot,
      tradeDir,
      symbol: "USDCAD",
      files: ["USDCAD_D.png"],
      status: "cancelled",
      rename: true,
    });

    assert.equal(copied.length, 1);
    assert.match(copied[0], /^USDCAD_D_2026.*_cancelled\.png$/);
    assert.equal(
      fs.readFileSync(path.join(tradeDir, "snapshots", copied[0]), "utf8"),
      "png-data",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("migrateAllCsvBarsToParquet converts existing bars and parquet provider reads them", async () => {
  const root = makeTempDir();
  const prevProvider = process.env.BARS_STORAGE_PROVIDER;
  const prevDataRoot = process.env.DATA_ROOT;
  const prevDuck = process.env.BARS_DUCKDB_PATH;
  try {
    const dataRoot = path.join(root, "data");
    const barsDir = path.join(dataRoot, "market_data", "USDCAD", "bars");
    fs.mkdirSync(barsDir, { recursive: true });
    fs.writeFileSync(
      path.join(barsDir, "60.csv"),
      [
        "time,open,high,low,close,volume",
        "1718006400,1.36,1.37,1.35,1.365,10",
        "1718010000,1.365,1.372,1.36,1.37,12",
        "",
      ].join("\n"),
    );
    process.env.DATA_ROOT = dataRoot;
    process.env.BARS_DUCKDB_PATH = path.join(root, "bars.duckdb");

    const migrated = await barsStorage?.migrateAllCsvBarsToParquet?.();
    assert.equal(migrated?.converted_files, 1);
    assert.equal(fs.existsSync(path.join(barsDir, "60.parquet")), true);

    process.env.BARS_STORAGE_PROVIDER = "parquet_duckdb";
    const rows = barsStorage?.readBrokerBarsFromFile("USDCAD", "1h", 100) || [];
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      time: 1718006400,
      open: 1.36,
      high: 1.37,
      low: 1.35,
      close: 1.365,
      volume: 10,
    });
  } finally {
    if (prevProvider === undefined) delete process.env.BARS_STORAGE_PROVIDER;
    else process.env.BARS_STORAGE_PROVIDER = prevProvider;
    if (prevDataRoot === undefined) delete process.env.DATA_ROOT;
    else process.env.DATA_ROOT = prevDataRoot;
    if (prevDuck === undefined) delete process.env.BARS_DUCKDB_PATH;
    else process.env.BARS_DUCKDB_PATH = prevDuck;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mergeBrokerBarsIntoFile repairs suspicious frozen-open streaks for higher timeframes", () => {
  const root = makeTempDir();
  const prevProvider = process.env.BARS_STORAGE_PROVIDER;
  const prevDataRoot = process.env.DATA_ROOT;
  const prevDuck = process.env.BARS_DUCKDB_PATH;
  try {
    const dataRoot = path.join(root, "data");
    const barsDir = path.join(dataRoot, "market_data", "XAUUSD", "bars");
    fs.mkdirSync(barsDir, { recursive: true });
    fs.writeFileSync(
      path.join(barsDir, "5.csv"),
      [
        "time,open,high,low,close,volume",
        "1000,100.00,100.40,99.90,100.20,0",
        "",
      ].join("\n"),
    );
    process.env.BARS_STORAGE_PROVIDER = "csv";
    process.env.DATA_ROOT = dataRoot;
    process.env.BARS_DUCKDB_PATH = path.join(root, "bars.duckdb");

    const inserted = barsStorage.mergeBrokerBarsIntoFile(
      "XAUUSD",
      "5",
      [
        { time: 1300, open: 100.10, high: 100.50, low: 99.95, close: 100.35, volume: 0 },
        { time: 1600, open: 100.10, high: 100.45, low: 99.90, close: 100.05, volume: 0 },
        { time: 1900, open: 100.10, high: 100.48, low: 99.92, close: 100.40, volume: 0 },
        { time: 2200, open: 100.10, high: 100.42, low: 99.91, close: 100.00, volume: 0 },
        { time: 2500, open: 100.10, high: 100.55, low: 99.94, close: 100.45, volume: 0 },
        { time: 2800, open: 100.10, high: 100.41, low: 99.89, close: 100.08, volume: 0 },
        { time: 3100, open: 100.10, high: 100.53, low: 99.93, close: 100.50, volume: 0 },
        { time: 3400, open: 100.10, high: 100.39, low: 99.88, close: 100.02, volume: 0 },
      ],
    );

    assert.equal(inserted, 8);
    const rows = barsStorage.readBrokerBarsFromFile("XAUUSD", "5", 20);
    const tail = rows.slice(-8);
    assert.deepEqual(
      tail.map((row) => Number(row.open.toFixed(2))),
      [100.2, 100.35, 100.05, 100.4, 100.0, 100.45, 100.08, 100.5],
    );
  } finally {
    if (prevProvider === undefined) delete process.env.BARS_STORAGE_PROVIDER;
    else process.env.BARS_STORAGE_PROVIDER = prevProvider;
    if (prevDataRoot === undefined) delete process.env.DATA_ROOT;
    else process.env.DATA_ROOT = prevDataRoot;
    if (prevDuck === undefined) delete process.env.BARS_DUCKDB_PATH;
    else process.env.BARS_DUCKDB_PATH = prevDuck;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("repairSuspiciousFrozenOpenSequences also repairs shorter frozen-open runs on 15m bars", () => {
  const tfSeconds = barsStorage.parseTfTokenToSeconds("15");
  const rows = [
    { t: 1000, o: 214.81123, h: 214.82694, l: 214.8081, c: 214.82005, v: 0 },
    { t: 1900, o: 214.81791, h: 214.82752, l: 214.81471, c: 214.82096, v: 0 },
    { t: 2800, o: 214.81791, h: 214.82752, l: 214.81479, c: 214.81674, v: 0 },
    { t: 3700, o: 214.81791, h: 214.82757, l: 214.81471, c: 214.81771, v: 0 },
    { t: 4600, o: 214.81791, h: 214.82727, l: 214.81469, c: 214.82206, v: 0 },
    { t: 5500, o: 214.81791, h: 214.82757, l: 214.81492, c: 214.82222, v: 0 },
  ];

  const repaired = barsStorage.repairSuspiciousFrozenOpenSequences(
    rows,
    tfSeconds,
  );

  assert.deepEqual(
    repaired.slice(1).map((row) => Number(row.o.toFixed(5))),
    [214.82005, 214.82096, 214.81674, 214.81771, 214.82206],
  );
});

test("readBrokerBarsFromFile prefers stored 15m bars before deriving from sibling 5m data", () => {
  const root = makeTempDir();
  const prevProvider = process.env.BARS_STORAGE_PROVIDER;
  const prevDataRoot = process.env.DATA_ROOT;
  const prevDuck = process.env.BARS_DUCKDB_PATH;
  try {
    const dataRoot = path.join(root, "data");
    const barsDir = path.join(dataRoot, "market_data", "XAUUSD", "bars");
    fs.mkdirSync(barsDir, { recursive: true });
    fs.writeFileSync(
      path.join(barsDir, "5.csv"),
      [
        "time,open,high,low,close,volume",
        "1000,100,102,99,101,0",
        "1300,101,103,100,102,0",
        "1600,102,104,101,103,0",
        "1900,103,105,102,104,0",
        "2200,104,106,103,105,0",
        "2500,105,107,104,106,0",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(barsDir, "15.csv"),
      [
        "time,open,high,low,close,volume",
        "900,999,999,999,999,0",
        "1800,999,999,999,999,0",
        "",
      ].join("\n"),
    );
    process.env.BARS_STORAGE_PROVIDER = "csv";
    process.env.DATA_ROOT = dataRoot;
    process.env.BARS_DUCKDB_PATH = path.join(root, "bars.duckdb");

    const rows = barsStorage.readBrokerBarsFromFile("XAUUSD", "15", 20);
    assert.deepEqual(rows, [
      { time: 900, open: 999, high: 999, low: 999, close: 999, volume: 0 },
      { time: 1800, open: 999, high: 999, low: 999, close: 999, volume: 0 },
    ]);
  } finally {
    if (prevProvider === undefined) delete process.env.BARS_STORAGE_PROVIDER;
    else process.env.BARS_STORAGE_PROVIDER = prevProvider;
    if (prevDataRoot === undefined) delete process.env.DATA_ROOT;
    else process.env.DATA_ROOT = prevDataRoot;
    if (prevDuck === undefined) delete process.env.BARS_DUCKDB_PATH;
    else process.env.BARS_DUCKDB_PATH = prevDuck;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readBrokerBarsFromFile derives 15m bars from sibling 5m data when stored 15m is missing", () => {
  const root = makeTempDir();
  const prevProvider = process.env.BARS_STORAGE_PROVIDER;
  const prevDataRoot = process.env.DATA_ROOT;
  const prevDuck = process.env.BARS_DUCKDB_PATH;
  try {
    const dataRoot = path.join(root, "data");
    const barsDir = path.join(dataRoot, "market_data", "XAUUSD", "bars");
    fs.mkdirSync(barsDir, { recursive: true });
    fs.writeFileSync(
      path.join(barsDir, "5.csv"),
      [
        "time,open,high,low,close,volume",
        "1000,100,102,99,101,0",
        "1300,101,103,100,102,0",
        "1600,102,104,101,103,0",
        "1900,103,105,102,104,0",
        "2200,104,106,103,105,0",
        "2500,105,107,104,106,0",
        "",
      ].join("\n"),
    );
    process.env.BARS_STORAGE_PROVIDER = "csv";
    process.env.DATA_ROOT = dataRoot;
    process.env.BARS_DUCKDB_PATH = path.join(root, "bars.duckdb");

    const rows = barsStorage.readBrokerBarsFromFile("XAUUSD", "15", 20);
    assert.deepEqual(rows, [
      { time: 900, open: 100, high: 104, low: 99, close: 103, volume: 0 },
      { time: 1800, open: 103, high: 107, low: 102, close: 106, volume: 0 },
    ]);
  } finally {
    if (prevProvider === undefined) delete process.env.BARS_STORAGE_PROVIDER;
    else process.env.BARS_STORAGE_PROVIDER = prevProvider;
    if (prevDataRoot === undefined) delete process.env.DATA_ROOT;
    else process.env.DATA_ROOT = prevDataRoot;
    if (prevDuck === undefined) delete process.env.BARS_DUCKDB_PATH;
    else process.env.BARS_DUCKDB_PATH = prevDuck;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mergeBrokerBarsIntoFile keeps full parquet history beyond csv trim limit", () => {
  const root = makeTempDir();
  const prevProvider = process.env.BARS_STORAGE_PROVIDER;
  const prevDataRoot = process.env.DATA_ROOT;
  const prevDuck = process.env.BARS_DUCKDB_PATH;
  try {
    const dataRoot = path.join(root, "data");
    const barsDir = path.join(dataRoot, "market_data", "XAUUSD", "bars");
    fs.mkdirSync(barsDir, { recursive: true });
    process.env.BARS_STORAGE_PROVIDER = "parquet_duckdb";
    process.env.DATA_ROOT = dataRoot;
    process.env.BARS_DUCKDB_PATH = path.join(root, "bars.duckdb");

    const seedBars = Array.from({ length: 3100 }, (_, index) => ({
      time: 1_700_000_000 + index * 300,
      open: 2000 + index * 0.1,
      high: 2000.2 + index * 0.1,
      low: 1999.8 + index * 0.1,
      close: 2000.1 + index * 0.1,
      volume: 100 + index,
    }));
    const inserted = barsStorage.mergeBrokerBarsIntoFile("XAUUSD", "5", seedBars);
    assert.equal(inserted, 3100);

    const rows = barsStorage.readBarsFile(
      path.join(barsDir, "5.parquet"),
      "5",
      0,
      { fullFile: true },
    );
    assert.equal(rows.length, 3100);
    assert.equal(rows[0].time, 1_699_999_800);
    assert.equal(rows.at(-1)?.time, 1_699_999_800 + 3099 * 300);
  } finally {
    if (prevProvider === undefined) delete process.env.BARS_STORAGE_PROVIDER;
    else process.env.BARS_STORAGE_PROVIDER = prevProvider;
    if (prevDataRoot === undefined) delete process.env.DATA_ROOT;
    else process.env.DATA_ROOT = prevDataRoot;
    if (prevDuck === undefined) delete process.env.BARS_DUCKDB_PATH;
    else process.env.BARS_DUCKDB_PATH = prevDuck;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("overwriteBrokerBarsFile replaces higher timeframe data from canonical source", () => {
  const root = makeTempDir();
  const prevProvider = process.env.BARS_STORAGE_PROVIDER;
  const prevDataRoot = process.env.DATA_ROOT;
  const prevDuck = process.env.BARS_DUCKDB_PATH;
  try {
    const dataRoot = path.join(root, "data");
    process.env.BARS_STORAGE_PROVIDER = "parquet_duckdb";
    process.env.DATA_ROOT = dataRoot;
    process.env.BARS_DUCKDB_PATH = path.join(root, "bars.duckdb");

    barsStorage.overwriteBrokerBarsFile(
      "XAUUSD",
      "5",
      [
        { time: 900, open: 100, high: 104, low: 99, close: 103, volume: 10 },
        { time: 1200, open: 103, high: 106, low: 102, close: 105, volume: 12 },
      ],
      {
        dataRoot,
        duckdbPath: process.env.BARS_DUCKDB_PATH,
      },
    );

    const rows = barsStorage.readBrokerBarsFromFile("XAUUSD", "5", 20, {
      dataRoot,
      duckdbPath: process.env.BARS_DUCKDB_PATH,
    });
    assert.deepEqual(rows, [
      { time: 900, open: 100, high: 104, low: 99, close: 103, volume: 10 },
      { time: 1200, open: 103, high: 106, low: 102, close: 105, volume: 12 },
    ]);
  } finally {
    if (prevProvider === undefined) delete process.env.BARS_STORAGE_PROVIDER;
    else process.env.BARS_STORAGE_PROVIDER = prevProvider;
    if (prevDataRoot === undefined) delete process.env.DATA_ROOT;
    else process.env.DATA_ROOT = prevDataRoot;
    if (prevDuck === undefined) delete process.env.BARS_DUCKDB_PATH;
    else process.env.BARS_DUCKDB_PATH = prevDuck;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("overwriteBrokerBarsFile writes unique sorted rows by timestamp", () => {
  const root = makeTempDir();
  const prevProvider = process.env.BARS_STORAGE_PROVIDER;
  const prevDataRoot = process.env.DATA_ROOT;
  const prevDuck = process.env.BARS_DUCKDB_PATH;
  try {
    const dataRoot = path.join(root, "data");
    process.env.BARS_STORAGE_PROVIDER = "parquet_duckdb";
    process.env.DATA_ROOT = dataRoot;
    process.env.BARS_DUCKDB_PATH = path.join(root, "bars.duckdb");

    barsStorage.overwriteBrokerBarsFile(
      "XAUUSD",
      "5",
      [
        { time: 1200, open: 103, high: 106, low: 102, close: 105, volume: 12 },
        { time: 900, open: 100, high: 104, low: 99, close: 103, volume: 10 },
        { time: 1200, open: 103.5, high: 106.5, low: 102.5, close: 105.5, volume: 14 },
      ],
      {
        dataRoot,
        duckdbPath: process.env.BARS_DUCKDB_PATH,
      },
    );

    const rows = barsStorage.readBrokerBarsFromFile("XAUUSD", "5", 20, {
      dataRoot,
      duckdbPath: process.env.BARS_DUCKDB_PATH,
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.time),
      [900, 1200],
    );
    assert.equal(rows[1].close, 105.5);
  } finally {
    if (prevProvider === undefined) delete process.env.BARS_STORAGE_PROVIDER;
    else process.env.BARS_STORAGE_PROVIDER = prevProvider;
    if (prevDataRoot === undefined) delete process.env.DATA_ROOT;
    else process.env.DATA_ROOT = prevDataRoot;
    if (prevDuck === undefined) delete process.env.BARS_DUCKDB_PATH;
    else process.env.BARS_DUCKDB_PATH = prevDuck;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readBarsFile normalizes unsorted duplicate parquet rows into unique sorted output", () => {
  const root = makeTempDir();
  const prevProvider = process.env.BARS_STORAGE_PROVIDER;
  const prevDataRoot = process.env.DATA_ROOT;
  const prevDuck = process.env.BARS_DUCKDB_PATH;
  try {
    const dataRoot = path.join(root, "data");
    const barsDir = path.join(dataRoot, "market_data", "XAUUSD", "bars");
    fs.mkdirSync(barsDir, { recursive: true });
    process.env.BARS_STORAGE_PROVIDER = "parquet_duckdb";
    process.env.DATA_ROOT = dataRoot;
    process.env.BARS_DUCKDB_PATH = path.join(root, "bars.duckdb");

    const filePath = path.join(barsDir, "5.parquet");
    barsStorage.overwriteBrokerBarsFile(
      "XAUUSD",
      "5",
      [
        { time: 1200, open: 103, high: 106, low: 102, close: 105, volume: 12 },
        { time: 900, open: 100, high: 104, low: 99, close: 103, volume: 10 },
      ],
      {
        dataRoot,
        duckdbPath: process.env.BARS_DUCKDB_PATH,
      },
    );

    const rows = barsStorage.readBarsFile(filePath, "5", 0, {
      dataRoot,
      duckdbPath: process.env.BARS_DUCKDB_PATH,
      fullFile: true,
    });
    assert.deepEqual(
      rows.map((row) => row.time),
      [900, 1200],
    );
  } finally {
    if (prevProvider === undefined) delete process.env.BARS_STORAGE_PROVIDER;
    else process.env.BARS_STORAGE_PROVIDER = prevProvider;
    if (prevDataRoot === undefined) delete process.env.DATA_ROOT;
    else process.env.DATA_ROOT = prevDataRoot;
    if (prevDuck === undefined) delete process.env.BARS_DUCKDB_PATH;
    else process.env.BARS_DUCKDB_PATH = prevDuck;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dropDisconnectedSyntheticPrefix removes stale zero-volume prefix before a large refreshed jump", () => {
  const tfSeconds = barsStorage.parseTfTokenToSeconds("5");
  const rows = [];
  for (let index = 0; index < 15; index += 1) {
    rows.push({
      t: 1_781_380_000 + index * tfSeconds,
      o: 4215.28 + index * 0.001,
      h: 4215.48,
      l: 4215.23,
      c: 4215.33 + index * 0.001,
      v: 0,
    });
  }
  const jumpStart = rows.at(-1).t + 46_500;
  for (let index = 0; index < 80; index += 1) {
    rows.push({
      t: jumpStart + index * tfSeconds,
      o: 4268 + index * 0.4,
      h: 4268.5 + index * 0.4,
      l: 4267.7 + index * 0.4,
      c: 4268.2 + index * 0.4,
      v: 50 + index,
    });
  }

  const repaired = barsStorage.dropDisconnectedSyntheticPrefix(rows, tfSeconds);
  assert.equal(repaired.length, 80);
  assert.equal(repaired[0].t, jumpStart);
  assert.ok(repaired.every((row) => row.v > 0));
});

test("dropDisconnectedSyntheticPrefix removes stale zero-volume prefix even with a short fresh tail", () => {
  const tfSeconds = barsStorage.parseTfTokenToSeconds("5");
  const rows = [];
  for (let index = 0; index < 40; index += 1) {
    rows.push({
      t: 1_781_416_800 + index * tfSeconds,
      o: 4215.25 + index * 0.002,
      h: 4215.48,
      l: 4215.22,
      c: 4215.31 + index * 0.002,
      v: 0,
    });
  }
  const jumpStart = rows.at(-1).t + 125_700;
  rows.push(
    { t: jumpStart, o: 4320.7, h: 4322.12, l: 4320.7, c: 4320.96, v: 292 },
    { t: jumpStart + tfSeconds, o: 4319.6, h: 4319.75, l: 4319.07, c: 4319.64, v: 107 },
    { t: jumpStart + tfSeconds * 2, o: 4319.29, h: 4319.29, l: 4317.74, c: 4318.2, v: 88 },
  );

  const repaired = barsStorage.dropDisconnectedSyntheticPrefix(rows, tfSeconds);
  assert.equal(repaired.length, 3);
  assert.deepEqual(
    repaired.map((row) => row.t),
    [jumpStart, jumpStart + tfSeconds, jumpStart + tfSeconds * 2],
  );
  assert.ok(repaired.every((row) => row.v > 0));
});

test("dropIsolatedZeroVolumeBridgeSpikes removes isolated zero-volume bridge bars", () => {
  const tfSeconds = barsStorage.parseTfTokenToSeconds("5");
  const repaired = barsStorage.dropIsolatedZeroVolumeBridgeSpikes(
    [
      { t: 1000, o: 4208.5, h: 4210.1, l: 4208.2, c: 4209.1, v: 150 },
      { t: 1300, o: 4173.9, h: 4179.8, l: 4173.7, c: 4174.7, v: 0 },
      { t: 1600, o: 4207.4, h: 4207.8, l: 4206.0, c: 4207.6, v: 250 },
    ],
    tfSeconds,
  );

  assert.equal(repaired.length, 2);
  assert.deepEqual(
    repaired.map((row) => row.t),
    [1000, 1600],
  );
});
