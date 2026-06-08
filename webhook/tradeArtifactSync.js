const fs = require("fs");
const path = require("path");

function normalizeCsvTfKey(tf) {
  const raw = String(tf || "").trim().toLowerCase();
  if (!raw) return "";
  if (
    raw === "d" ||
    raw === "1d" ||
    raw === "day" ||
    raw === "1440" ||
    raw === "1day"
  )
    return "1440";
  if (raw === "w" || raw === "1w" || raw === "week") return "1w";
  if (raw === "4h" || raw === "240") return "240";
  if (raw === "1h" || raw === "60" || raw === "60m" || raw === "60min")
    return "60";
  if (raw === "15m" || raw === "15" || raw === "15min") return "15";
  if (raw === "5m" || raw === "5" || raw === "5min") return "5";
  if (raw === "1m" || raw === "1" || raw === "1min") return "1";
  return raw;
}

function csvTfAliases(tf) {
  const key = normalizeCsvTfKey(tf);
  if (!key) return [];
  const out = new Set([key]);
  if (key === "1440") out.add("1d");
  if (key === "1w") out.add("w");
  if (key === "240") out.add("4h");
  if (key === "60") out.add("1h");
  if (key === "15") out.add("15m");
  if (key === "5") out.add("5m");
  if (key === "1") out.add("1m");
  return [...out];
}

function snapshotTimestampToken(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "_")
    .replace("Z", "UTC")
    .replace(".", "_");
}

function renameSnapshotForTrade(fileName, { status = "pending", timestamp } = {}) {
  const safe = String(fileName || "").trim();
  if (!safe) return "";
  const ext = path.extname(safe);
  const base = path.basename(safe, ext);
  return `${base}_${snapshotTimestampToken(timestamp)}_${String(status || "pending")
    .trim()
    .toLowerCase()}${ext || ".png"}`;
}

function ensureDir(dir) {
  if (!dir) return "";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function copyFileIfExists(src, dst) {
  if (!src || !dst || !fs.existsSync(src)) return false;
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  return true;
}

function copyMarketDataBarCsvToTradeDir({
  marketDataRoot,
  tradeDir,
  symbol,
  timeframe,
}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const tf = normalizeCsvTfKey(timeframe);
  if (!marketDataRoot || !tradeDir || !sym || !tf) return false;
  const srcDir = path.join(marketDataRoot, sym, "bars");
  const dst = path.join(tradeDir, "bars", `${tf}.csv`);
  const src = csvTfAliases(tf)
    .map((alias) => path.join(srcDir, `${alias}.csv`))
    .find((candidate) => fs.existsSync(candidate));
  return copyFileIfExists(src, dst);
}

function copyAllMarketDataBarsToTradeDir({
  marketDataRoot,
  tradeDir,
  symbol,
}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!marketDataRoot || !tradeDir || !sym) return [];
  const srcDir = path.join(marketDataRoot, sym, "bars");
  if (!fs.existsSync(srcDir)) return [];
  const dstDir = ensureDir(path.join(tradeDir, "bars"));
  const copied = [];
  for (const entry of fs.readdirSync(srcDir)) {
    if (!/\.csv$/i.test(entry)) continue;
    const src = path.join(srcDir, entry);
    const dst = path.join(dstDir, entry);
    if (copyFileIfExists(src, dst)) copied.push(entry);
  }
  return copied;
}

function copyMarketDataSnapshotsToTradeDir({
  snapshotRoot,
  tradeDir,
  symbol,
  files = [],
  status = "pending",
  rename = true,
}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!snapshotRoot || !tradeDir || !sym) return [];
  const srcDir = path.join(snapshotRoot, sym);
  if (!fs.existsSync(srcDir)) return [];
  const dstDir = ensureDir(path.join(tradeDir, "snapshots"));
  const requested = (Array.isArray(files) ? files : [])
    .map((f) => String(f || "").trim())
    .filter(Boolean);
  const sourceFiles = requested.length
    ? requested
    : fs
        .readdirSync(srcDir)
        .filter((entry) => /\.(png|jpe?g)$/i.test(entry));
  const copied = [];
  for (const fileName of sourceFiles) {
    const src = path.join(srcDir, fileName);
    if (!fs.existsSync(src)) continue;
    const dstName = rename
      ? renameSnapshotForTrade(fileName, { status })
      : fileName;
    if (!dstName) continue;
    const dst = path.join(dstDir, dstName);
    if (copyFileIfExists(src, dst)) copied.push(dstName);
  }
  return copied;
}

module.exports = {
  snapshotTimestampToken,
  renameSnapshotForTrade,
  copyMarketDataBarCsvToTradeDir,
  copyAllMarketDataBarsToTradeDir,
  copyMarketDataSnapshotsToTradeDir,
};
