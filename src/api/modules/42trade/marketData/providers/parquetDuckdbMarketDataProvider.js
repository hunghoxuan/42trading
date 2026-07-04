"use strict";

module.exports = function createParquetDuckdbMarketDataProvider(core) {
  const providerName = "parquet_duckdb";
  const extension = ".parquet";

  return {
    name: providerName,
    kind: "file",
    extension,
    getPathCandidates(symbol, tf, options = {}) {
      return core.getBarsPathCandidatesForProvider(symbol, tf, providerName, options);
    },
    resolvePath(symbol, tf, options = {}) {
      return core.resolveBarsPathForProvider(symbol, tf, providerName, options);
    },
    readBars(symbol, tf, limit = 300, options = {}) {
      const tfKey = core.normalizeCsvTfKey(tf);
      return core.readStoredBarsForProvider(
        providerName,
        symbol,
        tfKey,
        limit,
        options,
      );
    },
    async readBarsAsync(symbol, tf, limit = 300, options = {}) {
      const tfKey = core.normalizeCsvTfKey(tf);
      return core.readStoredBarsForProviderAsync(
        providerName,
        symbol,
        tfKey,
        limit,
        options,
      );
    },
    overwriteBars(symbol, tf, rows = [], options = {}) {
      const tfKey = core.normalizeCsvTfKey(tf);
      const sym = String(symbol || "").trim().toUpperCase();
      if (!sym || !tfKey) return 0;
      const targetPath = this.resolvePath(sym, tfKey, options);
      const tfSeconds = Math.max(60, core.parseTfTokenToSeconds(tfKey));
      const normalizedRows = core.uniqueSortedBars(
        (Array.isArray(rows) ? rows : [])
          .map((bar) => core.toMergeRow(bar, tfSeconds))
          .filter(Boolean),
        "t",
      );
      core.rewriteBarsFile(targetPath, normalizedRows, {
        ...options,
        provider: providerName,
      });
      return normalizedRows.length;
    },
    async overwriteBarsAsync(symbol, tf, rows = [], options = {}) {
      const tfKey = core.normalizeCsvTfKey(tf);
      const sym = String(symbol || "").trim().toUpperCase();
      if (!sym || !tfKey) return 0;
      const targetPath = this.resolvePath(sym, tfKey, options);
      const tfSeconds = Math.max(60, core.parseTfTokenToSeconds(tfKey));
      const normalizedRows = core.uniqueSortedBars(
        (Array.isArray(rows) ? rows : [])
          .map((bar) => core.toMergeRow(bar, tfSeconds))
          .filter(Boolean),
        "t",
      );
      await core.rewriteBarsFileAsync(targetPath, normalizedRows, {
        ...options,
        provider: providerName,
      });
      return normalizedRows.length;
    },
    mergeBars(symbol, tf, newBars, options = {}) {
      if (!symbol || !tf || !Array.isArray(newBars) || !newBars.length) return 0;
      const tfKey = core.normalizeCsvTfKey(tf);
      const tfSeconds = Math.max(60, core.parseTfTokenToSeconds(tfKey));
      const sym = String(symbol || "").trim().toUpperCase();
      if (!sym || !tfKey) return 0;
      const targetPath = this.resolvePath(sym, tfKey, options);
      const existingPath = this.resolvePath(sym, tfKey, options);
      const existingBars =
        existingPath
          ? core.readBarsFile(existingPath, tfKey, 0, {
              ...options,
              fullFile: true,
            })
          : [];
      const merged = core.mergeBarRows(existingBars, newBars, tfSeconds, {
        provider: providerName,
      });
      if (merged.added === 0) return 0;
      core.rewriteBarsFile(targetPath, merged.rows, {
        ...options,
        provider: providerName,
      });
      return merged.added;
    },
    async mergeBarsAsync(symbol, tf, newBars, options = {}) {
      if (!symbol || !tf || !Array.isArray(newBars) || !newBars.length) return 0;
      const tfKey = core.normalizeCsvTfKey(tf);
      const tfSeconds = Math.max(60, core.parseTfTokenToSeconds(tfKey));
      const sym = String(symbol || "").trim().toUpperCase();
      if (!sym || !tfKey) return 0;
      const targetPath = this.resolvePath(sym, tfKey, options);
      const existingPath = this.resolvePath(sym, tfKey, options);
      const existingBars =
        existingPath
          ? await core.readBarsFileAsync(existingPath, tfKey, 0, {
              ...options,
              fullFile: true,
            })
          : [];
      const merged = core.mergeBarRows(existingBars, newBars, tfSeconds, {
        provider: providerName,
      });
      if (merged.added === 0) return 0;
      await core.rewriteBarsFileAsync(targetPath, merged.rows, {
        ...options,
        provider: providerName,
      });
      return merged.added;
    },
  };
};
