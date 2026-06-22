import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const barsStorage = require("../../src/api/services/barsStorage");
const marketDataAuditService = require("../../src/api/services/marketDataAuditService");

const DEFAULT_TFS = ["1", "5", "15", "60", "240", "1440"];

function parseArgs(argv = []) {
  const args = { symbols: [], tfs: [], json: false, limit: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token) continue;
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--symbol" || token === "-s") {
      args.symbols.push(String(argv[i + 1] || "").trim().toUpperCase());
      i += 1;
      continue;
    }
    if (token === "--tf" || token === "-t") {
      args.tfs.push(barsStorage.normalizeCsvTfKey(argv[i + 1] || ""));
      i += 1;
      continue;
    }
    if (token === "--limit") {
      args.limit = Math.max(0, Number(argv[i + 1] || 0) || 0);
      i += 1;
      continue;
    }
  }
  return args;
}

function listSymbols(dataRoot) {
  const marketRoot = path.join(dataRoot, "market_data");
  if (!fs.existsSync(marketRoot)) return [];
  return fs
    .readdirSync(marketRoot)
    .filter((name) => fs.statSync(path.join(marketRoot, name)).isDirectory())
    .sort();
}

function formatRow(row) {
  return [
    row.symbol.padEnd(10),
    row.tf.padEnd(5),
    String(row.bar_count).padStart(7),
    String(row.gap_count).padStart(7),
    String(row.mismatch_count).padStart(9),
    (row.first_bar_at || "-").slice(0, 10),
    (row.last_bar_at || "-").slice(0, 10),
  ].join("  ");
}

const args = parseArgs(process.argv.slice(2));
const dataRoot = path.join(process.cwd(), "data");
const symbols = (args.symbols.length ? args.symbols : listSymbols(dataRoot)).filter(Boolean);
const tfs = (args.tfs.length ? args.tfs : DEFAULT_TFS).filter(Boolean);
const rows = [];

for (const symbol of symbols) {
  for (const tf of tfs) {
    try {
      const filePath = barsStorage.resolveBrokerBarsFilePath(symbol, tf, { dataRoot });
      if (!filePath || !fs.existsSync(filePath)) continue;
      const audit = marketDataAuditService.auditMarketData(symbol, tf, { dataRoot });
      rows.push({
        symbol,
        tf,
        file_path: audit.file_path,
        bar_count: audit.summary.bar_count,
        gap_count: audit.diagnostics.gap_count,
        duplicate_timestamps: audit.diagnostics.duplicate_timestamps,
        non_monotonic_input: audit.diagnostics.non_monotonic_input,
        corrected_ohlc_rows: audit.diagnostics.corrected_ohlc_rows,
        first_bar_at: audit.summary.first_bar_at,
        last_bar_at: audit.summary.last_bar_at,
        mismatch_count: audit.derivation?.comparison?.mismatch_count || 0,
        source_tf: audit.derivation?.source_tf || null,
      });
    } catch (error) {
      rows.push({
        symbol,
        tf,
        error: String(error.message || error),
      });
    }
  }
}

const sorted = rows.sort((a, b) => {
  const aScore =
    Number(a.error ? 1 : 0) * 1_000_000 +
    Number(a.mismatch_count || 0) * 10_000 +
    Number(a.gap_count || 0);
  const bScore =
    Number(b.error ? 1 : 0) * 1_000_000 +
    Number(b.mismatch_count || 0) * 10_000 +
    Number(b.gap_count || 0);
  return bScore - aScore || `${a.symbol}:${a.tf}`.localeCompare(`${b.symbol}:${b.tf}`);
});

const limited = args.limit > 0 ? sorted.slice(0, args.limit) : sorted;

if (args.json) {
  console.log(JSON.stringify({ count: rows.length, rows: limited }, null, 2));
  process.exit(0);
}

console.log("SYMBOL      TF      BARS     GAPS  MISMATCHS  FIRST       LAST");
for (const row of limited) {
  if (row.error) {
    console.log(`${row.symbol.padEnd(10)}  ${row.tf.padEnd(5)}  ERROR  ${row.error}`);
    continue;
  }
  console.log(formatRow(row));
}
