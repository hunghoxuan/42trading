const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const barsStorage = require("./marketDataRepo");

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
