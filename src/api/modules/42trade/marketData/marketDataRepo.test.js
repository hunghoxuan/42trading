const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const barsStorage = require("./marketDataRepo");
const chartArtifactService = require("../charts/chartArtifactService");
const sharedArtifactDetection = require("../../../../shared/rules-engine/features/detectArtifacts.cjs");

function makeTempDataRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bars-storage-"));
}

function writeCsvBarsForTest(dataRoot, symbol, tf, rows) {
  const tfKey = barsStorage.normalizeCsvTfKey(tf);
  const dir = path.join(dataRoot, "market_data", symbol, "bars");
  fs.mkdirSync(dir, { recursive: true });
  const csv =
    "time,open,high,low,close,volume\n" +
    rows
      .map(
        (row) =>
          `${row.time},${row.open},${row.high},${row.low},${row.close},${row.volume ?? 0}`,
      )
      .join("\n") +
    "\n";
  fs.writeFileSync(path.join(dir, `${tfKey}.csv`), csv);
}

test("rebuildBrokerBarsFromCanonicalSource preserves older prefix and replaces overlapping target bars", () => {
  const previousProvider = process.env.BARS_STORAGE_PROVIDER;
  process.env.BARS_STORAGE_PROVIDER = "csv";
  const dataRoot = makeTempDataRoot();

  writeCsvBarsForTest(dataRoot, "XAGUSD", "1m", [
    { time: 600, open: 10, high: 12, low: 9, close: 11, volume: 2 },
    { time: 660, open: 11, high: 13, low: 10, close: 12, volume: 3 },
    { time: 720, open: 12, high: 14, low: 11, close: 13, volume: 4 },
    { time: 780, open: 13, high: 15, low: 12, close: 14, volume: 5 },
    { time: 840, open: 14, high: 16, low: 13, close: 15, volume: 6 },
  ]);

  writeCsvBarsForTest(dataRoot, "XAGUSD", "5m", [
    { time: 300, open: 7, high: 8, low: 6, close: 7.5, volume: 9 },
    { time: 600, open: 99, high: 99, low: 99, close: 99, volume: 1 },
  ]);

  const result = barsStorage.rebuildBrokerBarsFromCanonicalSource(
    "XAGUSD",
    "5m",
    { dataRoot },
  );

  assert.equal(result.rewritten, true);
  const rebuilt = barsStorage.readBrokerBarsFromFile("XAGUSD", "5m", 0, {
    dataRoot,
    fullFile: true,
  });
  assert.deepEqual(
    rebuilt.map((bar) => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    })),
    [
      { time: 300, open: 7, high: 8, low: 6, close: 7.5, volume: 9 },
      { time: 600, open: 10, high: 16, low: 9, close: 15, volume: 20 },
    ],
  );

  if (previousProvider == null) delete process.env.BARS_STORAGE_PROVIDER;
  else process.env.BARS_STORAGE_PROVIDER = previousProvider;
});

test("createBarsRepository reads and writes through the configured provider facade", () => {
  const previousProvider = process.env.BARS_STORAGE_PROVIDER;
  process.env.BARS_STORAGE_PROVIDER = "csv";
  const dataRoot = makeTempDataRoot();
  const repo = barsStorage.createBarsRepository({ dataRoot });

  const wrote = repo.overwriteBars("EURUSD", "5m", [
    { time: 300, open: 1.1, high: 1.2, low: 1.05, close: 1.15, volume: 10 },
    { time: 600, open: 1.15, high: 1.22, low: 1.1, close: 1.2, volume: 12 },
  ]);
  assert.equal(wrote, 2);
  assert.match(repo.resolveBarsPath("EURUSD", "5"), /5\.csv$/);
  assert.equal(repo.getProviderName(), "csv");

  const rows = repo.readBars("EURUSD", "5", 10);
  assert.deepEqual(
    rows.map((row) => ({ time: row.time, close: row.close })),
    [
      { time: 300, close: 1.15 },
      { time: 600, close: 1.2 },
    ],
  );

  if (previousProvider == null) delete process.env.BARS_STORAGE_PROVIDER;
  else process.env.BARS_STORAGE_PROVIDER = previousProvider;
});

test("readBrokerBarsFromFile reads 15m only from the 15m file", () => {
  const previousProvider = process.env.BARS_STORAGE_PROVIDER;
  process.env.BARS_STORAGE_PROVIDER = "csv";
  const dataRoot = makeTempDataRoot();

  writeCsvBarsForTest(dataRoot, "XAGUSD", "5m", [
    { time: 900, open: 10, high: 11, low: 9, close: 10.5, volume: 1 },
    { time: 1200, open: 10.5, high: 12, low: 10, close: 11.5, volume: 1 },
    { time: 1500, open: 11.5, high: 13, low: 11, close: 12.5, volume: 1 },
  ]);

  writeCsvBarsForTest(dataRoot, "XAGUSD", "15m", [
    { time: 900, open: 99, high: 99, low: 99, close: 99, volume: 1 },
  ]);

  const bars = barsStorage.readBrokerBarsFromFile("XAGUSD", "15m", 0, {
    dataRoot,
    fullFile: true,
  });

  assert.deepEqual(
    bars.map((bar) => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    })),
    [
      { time: 900, open: 99, high: 99, low: 99, close: 99, volume: 1 },
    ],
  );

  if (previousProvider == null) delete process.env.BARS_STORAGE_PROVIDER;
  else process.env.BARS_STORAGE_PROVIDER = previousProvider;
});

test("buildDerivedItemsFromBars ignores bullish FVGs when the gap is tiny relative to the displacement candle", () => {
  const bars = [
    { time: 100, open: 96, high: 100, low: 95, close: 99, volume: 10 },
    { time: 200, open: 99, high: 110, low: 98, close: 109, volume: 12 },
    { time: 300, open: 101, high: 104, low: 100.2, close: 103, volume: 9 },
  ];

  const items = chartArtifactService.buildDerivedItemsFromBars(bars, "15m");
  const fvgItems = items.filter((item) => item?.type === "fvg");

  assert.equal(fvgItems.length, 0);
});

test("buildDerivedItemsFromBars keeps bullish FVGs when the gap is meaningfully sized", () => {
  const bars = [
    { time: 100, open: 96, high: 100, low: 95, close: 99, volume: 10 },
    { time: 200, open: 99, high: 110, low: 98, close: 109, volume: 12 },
    { time: 300, open: 103, high: 106, low: 102, close: 105, volume: 9 },
  ];

  const items = chartArtifactService.buildDerivedItemsFromBars(bars, "15m");
  const fvgItems = items.filter((item) => item?.type === "fvg");

  assert.equal(fvgItems.length, 1);
  assert.equal(fvgItems[0].subtype, "bullish");
});

test("buildDerivedItemsFromBars detects sweep, bos, and choch structure artifacts", () => {
  const bars = [
    { time: 60, open: 100, high: 101, low: 99, close: 100, volume: 10 },
    { time: 120, open: 100, high: 102, low: 98, close: 101, volume: 10 },
    { time: 180, open: 101, high: 106, low: 100, close: 105, volume: 10 },
    { time: 240, open: 105, high: 105.5, low: 101, close: 102, volume: 10 },
    { time: 300, open: 102, high: 103, low: 97, close: 98, volume: 10 },
    { time: 360, open: 98, high: 99, low: 94, close: 95, volume: 10 },
    { time: 420, open: 95, high: 100, low: 94.5, close: 99, volume: 10 },
    { time: 480, open: 99, high: 106.5, low: 98, close: 101, volume: 10 },
    { time: 540, open: 101, high: 108, low: 100, close: 107, volume: 10 },
    { time: 600, open: 107, high: 107.5, low: 95.5, close: 96, volume: 10 },
    { time: 660, open: 96, high: 97, low: 92, close: 93, volume: 10 },
  ];

  const items = chartArtifactService.buildDerivedItemsFromBars(bars, "15m");
  const sweepItems = items.filter((item) => String(item?.type || "").startsWith("sweep_"));
  const bosItems = items.filter((item) => item?.type === "bos");
  const chochItems = items.filter((item) => item?.type === "choch");

  assert.equal(sweepItems.length > 0, true);
  assert.equal(bosItems.length > 0, true);
  assert.equal(chochItems.length > 0, true);
  assert.equal(
    sweepItems.some((item) => item?.subtype === "bearish" || item?.payload?.bias === "bearish"),
    true,
  );
  assert.equal(
    bosItems.some((item) => item?.subtype === "bullish" || item?.payload?.bias === "bullish"),
    true,
  );
  assert.equal(
    chochItems.some((item) => item?.subtype === "bearish" || item?.payload?.bias === "bearish"),
    true,
  );
});

test("shared artifact detector matches server detector output", () => {
  const bars = [
    { time: 60, open: 100, high: 101, low: 99, close: 100, volume: 10 },
    { time: 120, open: 100, high: 102, low: 98, close: 101, volume: 10 },
    { time: 180, open: 101, high: 106, low: 100, close: 105, volume: 10 },
    { time: 240, open: 105, high: 105.5, low: 101, close: 102, volume: 10 },
    { time: 300, open: 102, high: 103, low: 97, close: 98, volume: 10 },
    { time: 360, open: 98, high: 99, low: 94, close: 95, volume: 10 },
    { time: 420, open: 95, high: 100, low: 94.5, close: 99, volume: 10 },
    { time: 480, open: 99, high: 106.5, low: 98, close: 101, volume: 10 },
    { time: 540, open: 101, high: 108, low: 100, close: 107, volume: 10 },
    { time: 600, open: 107, high: 107.5, low: 95.5, close: 96, volume: 10 },
    { time: 660, open: 96, high: 97, low: 92, close: 93, volume: 10 },
  ];

  const sharedItems = sharedArtifactDetection.buildDerivedItemsFromBars(bars, "15m");
  const serverItems = chartArtifactService.buildDerivedItemsFromBars(bars, "15m");

  assert.deepEqual(serverItems, sharedItems);
});

test("shared artifact delta replaces a forming marker without duplicating it", () => {
  const dataRoot = makeTempDataRoot();
  const symbol = `TEST_${path.basename(dataRoot).replace(/[^a-z0-9]/gi, "")}`;
  chartArtifactService.clearMarketArtifactStore();

  const first = chartArtifactService.mergeMarketArtifactDelta({
    symbol,
    timeframe: "5m",
    items: [
      {
        id: "fvg-100",
        family: "zone",
        type: "fvg",
        subtype: "bullish",
        timeframe: "5",
        price_low: 100,
        price_high: 102,
        anchor_time: 100,
        status: "active",
      },
    ],
  });
  chartArtifactService.writeMarketArtifacts(symbol, "5", first, { dataRoot });
  chartArtifactService.flushMarketArtifactStore();

  chartArtifactService.clearMarketArtifactStore();
  const existing = chartArtifactService.readMarketArtifacts(symbol, "5", { dataRoot });
  const second = chartArtifactService.mergeMarketArtifactDelta({
    symbol,
    timeframe: "5m",
    existing,
    items: [
      {
        id: "fvg-100",
        family: "zone",
        type: "fvg",
        subtype: "bullish",
        timeframe: "5",
        price_low: 101,
        price_high: 103,
        anchor_time: 100,
        status: "mitigated",
      },
    ],
  });

  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].price_low, 101);
  assert.equal(second.items[0].status, "mitigated");
});

test("shared artifact deltas keep identical IDs separate by timeframe", () => {
  const symbol = "TEST_SHARED_TF";
  const item = {
    id: "key-100",
    family: "level",
    type: "key_level",
    label: "Key",
    price: 100,
    anchor_time: 100,
  };
  const fiveMinute = chartArtifactService.mergeMarketArtifactDelta({
    symbol,
    timeframe: "5",
    items: [{ ...item, timeframe: "5" }],
  });
  const hourly = chartArtifactService.mergeMarketArtifactDelta({
    symbol,
    timeframe: "60",
    items: [{ ...item, timeframe: "60" }],
  });

  assert.equal(fiveMinute.items.length, 1);
  assert.equal(hourly.items.length, 1);
  assert.equal(fiveMinute.items[0].timeframe, "5");
  assert.equal(hourly.items[0].timeframe, "60");
});
