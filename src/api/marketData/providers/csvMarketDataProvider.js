"use strict";

module.exports = function createCsvMarketDataProvider(core) {
  const providerName = "csv";
  const extension = ".csv";

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
      const stored = core.readStoredBarsForProvider(
        providerName,
        symbol,
        tfKey,
        limit,
        options,
      );
      if (stored.length) return stored;
      if (tfKey === "15") {
        const sourceRows = core.readStoredBarsForProvider(
          providerName,
          symbol,
          "5",
          Math.max(5000, (Number(limit) || 300) * 3),
          options,
        );
        const derived = core.aggregateBarsFromLowerTimeframe(
          sourceRows,
          15 * 60,
          5 * 60,
          limit,
        );
        if (derived.length) return derived;
      }
      return [];
    },
    async readBarsAsync(symbol, tf, limit = 300, options = {}) {
      const tfKey = core.normalizeCsvTfKey(tf);
      const stored = await core.readStoredBarsForProviderAsync(
        providerName,
        symbol,
        tfKey,
        limit,
        options,
      );
      if (stored.length) return stored;
      if (tfKey === "15") {
        const sourceRows = await core.readStoredBarsForProviderAsync(
          providerName,
          symbol,
          "5",
          Math.max(5000, (Number(limit) || 300) * 3),
          options,
        );
        const derived = core.aggregateBarsFromLowerTimeframe(
          sourceRows,
          15 * 60,
          5 * 60,
          limit,
        );
        if (derived.length) return derived;
      }
      return [];
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
          ? core.readBarsFile(existingPath, tfKey, core.MAX_BARS_PER_FILE, options)
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
          ? await core.readBarsFileAsync(
              existingPath,
              tfKey,
              core.MAX_BARS_PER_FILE,
              options,
            )
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
