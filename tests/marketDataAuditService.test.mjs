import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const barsStorage = require("../src/api/marketData/marketDataRepo");
const marketDataAuditService = require("../src/api/marketData/marketDataAuditService");

function makeTempDataRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "market-audit-"));
}

function writeCsvBars(dataRoot, symbol, tf, rows) {
  const filePath = path.join(
    dataRoot,
    "market_data",
    symbol,
    "bars",
    `${tf}.csv`,
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = ["time,open,high,low,close,volume"];
  for (const row of rows) {
    lines.push(
      [
        row.time,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume ?? 0,
      ].join(","),
    );
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

test("auditMarketData reports normalization diagnostics from stored bars", () => {
  const dataRoot = makeTempDataRoot();
  writeCsvBars(dataRoot, "TESTPAIR", "15", [
    { time: 1800, open: 2, high: 1.8, low: 2.1, close: 1.9, volume: 10 },
    { time: 900, open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 5 },
    { time: 900, open: 1, high: 1.2, low: 0.8, close: 1.1, volume: 6 },
    { time: 3600, open: 2.2, high: 2.4, low: 2.1, close: 2.3, volume: 11 },
  ]);

  const result = marketDataAuditService.auditMarketData("TESTPAIR", "15", {
    dataRoot,
  });

  assert.equal(result.ok, true);
  assert.equal(result.symbol, "TESTPAIR");
  assert.equal(result.tf, "15");
  assert.equal(result.summary.bar_count, 3);
  assert.equal(result.diagnostics.duplicate_timestamps, 1);
  assert.equal(result.diagnostics.non_monotonic_input, 1);
  assert.equal(result.diagnostics.corrected_ohlc_rows, 1);
  assert.equal(result.diagnostics.gap_count, 1);
});

test("auditMarketData compares stored higher timeframe bars against derived lower timeframe bars", () => {
  const dataRoot = makeTempDataRoot();
  const fiveMinuteBars = [
    { time: 0, open: 1.0, high: 1.1, low: 0.95, close: 1.02, volume: 10 },
    { time: 300, open: 1.02, high: 1.12, low: 1.0, close: 1.08, volume: 12 },
    { time: 600, open: 1.08, high: 1.15, low: 1.04, close: 1.1, volume: 14 },
    { time: 900, open: 1.1, high: 1.2, low: 1.05, close: 1.18, volume: 15 },
    { time: 1200, open: 1.18, high: 1.22, low: 1.12, close: 1.16, volume: 16 },
    { time: 1500, open: 1.16, high: 1.19, low: 1.1, close: 1.12, volume: 17 },
  ];
  const derived15 = barsStorage.aggregateBarsFromLowerTimeframe(
    fiveMinuteBars,
    15 * 60,
    5 * 60,
    0,
  );
  writeCsvBars(dataRoot, "TESTPAIR", "5", fiveMinuteBars);
  writeCsvBars(dataRoot, "TESTPAIR", "15", derived15);

  const clean = marketDataAuditService.auditMarketData("TESTPAIR", "15", {
    dataRoot,
  });

  assert.equal(clean.derivation.source_tf, "5");
  assert.equal(clean.derivation.comparison.mismatch_count, 0);

  const tampered15 = [...derived15];
  tampered15[1] = { ...tampered15[1], close: tampered15[1].close + 0.01 };
  writeCsvBars(dataRoot, "TESTPAIR", "15", tampered15);

  const mismatched = marketDataAuditService.auditMarketData("TESTPAIR", "15", {
    dataRoot,
  });

  assert.equal(mismatched.derivation.comparison.mismatch_count, 1);
  assert.equal(
    mismatched.derivation.comparison.mismatches[0].diff.close.actual,
    tampered15[1].close,
  );
});
