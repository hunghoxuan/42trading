"use strict";

const fs = require("fs");
const path = require("path");

const core = require("./marketDataCore");
const createCsvMarketDataProvider = require("./providers/csvMarketDataProvider");
const createParquetDuckdbMarketDataProvider = require("./providers/parquetDuckdbMarketDataProvider");
const createPostgresMarketDataProvider = require("./providers/postgresMarketDataProvider");

const MARKET_DATA_PROVIDERS = Object.freeze({
  csv: createCsvMarketDataProvider(core),
  parquet_duckdb: createParquetDuckdbMarketDataProvider(core),
  postgres: createPostgresMarketDataProvider(core),
});

function getMarketDataProvider(provider = core.getBarsStorageProvider()) {
  const normalized = core.normalizeBarsStorageProvider(provider);
  const resolved = MARKET_DATA_PROVIDERS[normalized];
  if (!resolved) {
    throw new Error(`Unsupported market data provider: ${provider}`);
  }
  return resolved;
}

function getBrokerBarsPathCandidates(symbol, tf, options = {}) {
  return getMarketDataProvider(core.getBarsStorageProvider(options)).getPathCandidates(
    symbol,
    tf,
    options,
  );
}

function resolveBrokerBarsFilePath(symbol, tf, options = {}) {
  return getMarketDataProvider(core.getBarsStorageProvider(options)).resolvePath(
    symbol,
    tf,
    options,
  );
}

function readBrokerBarsFromFile(symbol, tf, limit = 300, options = {}) {
  return getMarketDataProvider(core.getBarsStorageProvider(options)).readBars(
    symbol,
    tf,
    limit,
    options,
  );
}

async function readBrokerBarsFromFileAsync(symbol, tf, limit = 300, options = {}) {
  const provider = getMarketDataProvider(core.getBarsStorageProvider(options));
  if (typeof provider.readBarsAsync === "function") {
    return provider.readBarsAsync(symbol, tf, limit, options);
  }
  return provider.readBars(symbol, tf, limit, options);
}

function getCanonicalSourceTimeframe(tf) {
  const tfKey = core.normalizeCsvTfKey(tf);
  return core.CANONICAL_SOURCE_TF[tfKey] || "";
}

function rebuildBrokerBarsFromCanonicalSource(symbol, tf, options = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const targetTfKey = core.normalizeCsvTfKey(tf);
  const sourceTfKey = getCanonicalSourceTimeframe(targetTfKey);
  const provider = getMarketDataProvider(core.getBarsStorageProvider(options));
  if (!sym || !targetTfKey || !sourceTfKey) {
    return { rewritten: false, rows: 0, reason: "unsupported_tf" };
  }
  const sourcePath = provider.resolvePath(sym, sourceTfKey, options);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { rewritten: false, rows: 0, reason: "missing_source_file" };
  }
  const sourceBars = core.readBarsFile(sourcePath, sourceTfKey, 0, {
    ...options,
    fullFile: true,
  });
  if (!sourceBars.length) {
    return { rewritten: false, rows: 0, reason: "empty_source_file" };
  }
  const targetPath = provider.resolvePath(sym, targetTfKey, options);
  const storedBars =
    targetPath && fs.existsSync(targetPath)
      ? core.readBarsFile(targetPath, targetTfKey, 0, {
          ...options,
          fullFile: true,
        })
      : [];
  const reconciled = core.reconcileDerivedBarsWithStored(
    storedBars,
    sourceBars,
    targetTfKey,
    sourceTfKey,
  );
  if (!reconciled.length) {
    return { rewritten: false, rows: 0, reason: "empty_reconciled_series" };
  }
  const before = JSON.stringify(storedBars);
  const after = JSON.stringify(reconciled);
  if (before === after) {
    return { rewritten: false, rows: reconciled.length, reason: "unchanged" };
  }
  const rows = provider.overwriteBars(sym, targetTfKey, reconciled, options);
  return { rewritten: true, rows, reason: "reconciled_from_canonical_source" };
}

function rebuildBrokerTimeframeChain(symbol, startTf = "1", options = {}) {
  const startTfKey = core.normalizeCsvTfKey(startTf);
  const chain = ["5", "15", "60", "240", "1440"];
  let startIndex = 0;
  if (startTfKey && startTfKey !== "1") {
    startIndex = Math.max(0, chain.indexOf(startTfKey));
  }
  const out = {};
  for (const tfKey of chain.slice(startIndex)) {
    out[tfKey] = rebuildBrokerBarsFromCanonicalSource(symbol, tfKey, options);
  }
  return out;
}

function overwriteBrokerBarsFile(symbol, tf, rows = [], options = {}) {
  return getMarketDataProvider(core.getBarsStorageProvider(options)).overwriteBars(
    symbol,
    tf,
    rows,
    options,
  );
}

async function overwriteBrokerBarsFileAsync(symbol, tf, rows = [], options = {}) {
  const provider = getMarketDataProvider(core.getBarsStorageProvider(options));
  if (typeof provider.overwriteBarsAsync === "function") {
    return provider.overwriteBarsAsync(symbol, tf, rows, options);
  }
  return provider.overwriteBars(symbol, tf, rows, options);
}

function mergeBrokerBarsIntoFile(symbol, tf, newBars, options = {}) {
  return getMarketDataProvider(core.getBarsStorageProvider(options)).mergeBars(
    symbol,
    tf,
    newBars,
    options,
  );
}

async function mergeBrokerBarsIntoFileAsync(symbol, tf, newBars, options = {}) {
  const provider = getMarketDataProvider(core.getBarsStorageProvider(options));
  if (typeof provider.mergeBarsAsync === "function") {
    return provider.mergeBarsAsync(symbol, tf, newBars, options);
  }
  return provider.mergeBars(symbol, tf, newBars, options);
}

function resolveBarsPath(symbol, tf, options = {}) {
  return getMarketDataProvider(core.getBarsStorageProvider(options)).resolvePath(
    symbol,
    tf,
    options,
  );
}

function readBars(symbol, tf, limit = 300, options = {}) {
  return getMarketDataProvider(core.getBarsStorageProvider(options)).readBars(
    symbol,
    tf,
    limit,
    options,
  );
}

async function readBarsAsync(symbol, tf, limit = 300, options = {}) {
  const provider = getMarketDataProvider(core.getBarsStorageProvider(options));
  if (typeof provider.readBarsAsync === "function") {
    return provider.readBarsAsync(symbol, tf, limit, options);
  }
  return provider.readBars(symbol, tf, limit, options);
}

function mergeBars(symbol, tf, rows = [], options = {}) {
  return getMarketDataProvider(core.getBarsStorageProvider(options)).mergeBars(
    symbol,
    tf,
    rows,
    options,
  );
}

async function mergeBarsAsync(symbol, tf, rows = [], options = {}) {
  const provider = getMarketDataProvider(core.getBarsStorageProvider(options));
  if (typeof provider.mergeBarsAsync === "function") {
    return provider.mergeBarsAsync(symbol, tf, rows, options);
  }
  return provider.mergeBars(symbol, tf, rows, options);
}

function overwriteBars(symbol, tf, rows = [], options = {}) {
  return getMarketDataProvider(core.getBarsStorageProvider(options)).overwriteBars(
    symbol,
    tf,
    rows,
    options,
  );
}

async function overwriteBarsAsync(symbol, tf, rows = [], options = {}) {
  const provider = getMarketDataProvider(core.getBarsStorageProvider(options));
  if (typeof provider.overwriteBarsAsync === "function") {
    return provider.overwriteBarsAsync(symbol, tf, rows, options);
  }
  return provider.overwriteBars(symbol, tf, rows, options);
}

function createMarketDataRepository(baseOptions = {}) {
  const withOptions = (options = {}) => ({ ...baseOptions, ...options });
  return {
    getProvider() {
      return getMarketDataProvider(core.getBarsStorageProvider(baseOptions));
    },
    getProviderName() {
      return core.getBarsStorageProvider(baseOptions);
    },
    getPrimaryExtension() {
      return core.getPrimaryBarsExtension(core.getBarsStorageProvider(baseOptions));
    },
    resolveBarsPath(symbol, tf, options = {}) {
      return resolveBarsPath(symbol, tf, withOptions(options));
    },
    readBars(symbol, tf, limit = 300, options = {}) {
      return readBars(symbol, tf, limit, withOptions(options));
    },
    readBarsAsync(symbol, tf, limit = 300, options = {}) {
      return readBarsAsync(symbol, tf, limit, withOptions(options));
    },
    mergeBars(symbol, tf, rows = [], options = {}) {
      return mergeBars(symbol, tf, rows, withOptions(options));
    },
    mergeBarsAsync(symbol, tf, rows = [], options = {}) {
      return mergeBarsAsync(symbol, tf, rows, withOptions(options));
    },
    overwriteBars(symbol, tf, rows = [], options = {}) {
      return overwriteBars(symbol, tf, rows, withOptions(options));
    },
    overwriteBarsAsync(symbol, tf, rows = [], options = {}) {
      return overwriteBarsAsync(symbol, tf, rows, withOptions(options));
    },
    rebuildFromCanonicalSource(symbol, tf, options = {}) {
      return rebuildBrokerBarsFromCanonicalSource(symbol, tf, withOptions(options));
    },
    rebuildTimeframeChain(symbol, tf = "1", options = {}) {
      return rebuildBrokerTimeframeChain(symbol, tf, withOptions(options));
    },
    repairBarsFile(filePath, tf, options = {}) {
      return core.repairBarsFile(filePath, tf, withOptions(options));
    },
    repairBarsTree(rootDir, options = {}) {
      return core.repairBarsTree(rootDir, withOptions(options));
    },
  };
}

async function migrateAllCsvBarsToParquet(options = {}) {
  const marketDataRoot = core.getMarketDataRoot(options);
  if (!fs.existsSync(marketDataRoot)) {
    return { scanned_files: 0, converted_files: 0 };
  }
  let scannedFiles = 0;
  let convertedFiles = 0;
  for (const symbol of fs.readdirSync(marketDataRoot)) {
    const barsDir = path.join(marketDataRoot, symbol, "bars");
    if (!fs.existsSync(barsDir)) continue;
    for (const entry of fs.readdirSync(barsDir)) {
      if (!/\.csv$/i.test(entry)) continue;
      scannedFiles++;
      const tfKey = core.normalizeCsvTfKey(path.basename(entry, ".csv"));
      const csvPath = path.join(barsDir, entry);
      const parquetPath = path.join(barsDir, `${tfKey}.parquet`);
      const bars = core.readBarsFile(csvPath, tfKey, 0, {
        ...options,
        fullFile: true,
      });
      if (!bars.length) continue;
      const rows = bars.map((bar) =>
        core.toMergeRow(bar, Math.max(60, core.parseTfTokenToSeconds(tfKey))),
      );
      core.writeParquetBars(
        parquetPath,
        rows.filter(Boolean),
        options,
      );
      convertedFiles++;
    }
  }
  return { scanned_files: scannedFiles, converted_files: convertedFiles };
}

module.exports = {
  aggregateBarsFromLowerTimeframe: core.aggregateBarsFromLowerTimeframe,
  createMarketDataRepository,
  createBarsRepository: createMarketDataRepository,
  rebuildBrokerBarsFromCanonicalSource,
  rebuildBrokerTimeframeChain,
  reconcileDerivedBarsWithStored: core.reconcileDerivedBarsWithStored,
  csvTfAliases: core.csvTfAliases,
  getMarketDataProvider,
  getBarsProvider: getMarketDataProvider,
  getBarsStorageProvider: core.getBarsStorageProvider,
  getCanonicalSourceTimeframe,
  getPrimaryBarsExtension: core.getPrimaryBarsExtension,
  migrateAllCsvBarsToParquet,
  mergeBars,
  mergeBarsAsync,
  mergeBrokerBarsIntoFile,
  mergeBrokerBarsIntoFileAsync,
  normalizeBarTimeToUTC: core.normalizeBarTimeToUTC,
  normalizeBarsStorageProvider: core.normalizeBarsStorageProvider,
  normalizeCsvTfKey: core.normalizeCsvTfKey,
  overwriteBars,
  overwriteBarsAsync,
  overwriteBrokerBarsFile,
  overwriteBrokerBarsFileAsync,
  parseTfTokenToSeconds: core.parseTfTokenToSeconds,
  repairBarsFile: core.repairBarsFile,
  repairBarsTree: core.repairBarsTree,
  readBars,
  readBarsAsync,
  repairSuspiciousFrozenOpenSequences: core.repairSuspiciousFrozenOpenSequences,
  dropDisconnectedSyntheticPrefix: core.dropDisconnectedSyntheticPrefix,
  dropIsolatedZeroVolumeBridgeSpikes: core.dropIsolatedZeroVolumeBridgeSpikes,
  readBarsFile: core.readBarsFile,
  readBarsFileAsync: core.readBarsFileAsync,
  readBrokerBarsFromFile,
  readBrokerBarsFromFileAsync,
  resolveBarsPath,
  resolveBrokerBarsFilePath,
  sanitizeShiftedZeroVolumeDuplicates: core.sanitizeShiftedZeroVolumeDuplicates,
};
