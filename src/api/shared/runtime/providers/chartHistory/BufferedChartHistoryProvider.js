const MAX_CHART_HISTORY_BARS = 20_000;
const LARGE_HISTORY_REQUEST_THRESHOLD = 5_000;
const LARGE_HISTORY_BUFFER_BARS = 2_000;

function clampBars(value, fallback = 300) {
  return Math.max(50, Math.min(MAX_CHART_HISTORY_BARS, Number(value) || fallback));
}

function resolveExpandedBars(requestedBars, visibleBars, bufferMultiplier) {
  const requested = clampBars(requestedBars, 300);
  const visible = clampBars(visibleBars, requested);
  if (
    requested >= LARGE_HISTORY_REQUEST_THRESHOLD ||
    visible >= LARGE_HISTORY_REQUEST_THRESHOLD
  ) {
    return clampBars(
      Math.max(requested, visible + LARGE_HISTORY_BUFFER_BARS),
      requested,
    );
  }
  return clampBars(
    Math.max(requested, visible * Math.max(1, Number(bufferMultiplier) || 1)),
    requested,
  );
}

function firstBarSec(snapshot = {}) {
  const bars = Array.isArray(snapshot?.bars) ? snapshot.bars : [];
  return Number(bars[0]?.time || 0) || null;
}

function fireAndForget(promise) {
  Promise.resolve(promise).catch(() => {});
}

function withTimeout(promise, timeoutMs, fallbackValue) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallbackValue);
    }, Math.max(1, Number(timeoutMs) || 1));
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallbackValue);
      },
    );
  });
}

export class BufferedChartHistoryProvider {
  constructor({
    cache,
    loadSnapshot,
    refreshHistory,
    bufferMultiplier = 3,
    defaultBars = 300,
    refreshTimeoutMs = 20000,
  } = {}) {
    this.id = "buffered";
    this.cache = cache;
    this.loadSnapshot = loadSnapshot;
    this.refreshHistory = refreshHistory;
    this.bufferMultiplier = Math.max(1, Number(bufferMultiplier) || 3);
    this.defaultBars = clampBars(defaultBars, 300);
    this.refreshTimeoutMs = Math.max(250, Number(refreshTimeoutMs) || 2500);
  }

  async resolveRange(request = {}) {
    if (typeof this.loadSnapshot !== "function") {
      throw new Error("loadSnapshot is required");
    }
    const symbol = String(request.symbol || "").trim().toUpperCase();
    const timeframe = String(request.timeframe || request.tf || "").trim().toLowerCase();
    if (!symbol || !timeframe) {
      throw new Error("symbol and timeframe are required");
    }

    const requestedBars = clampBars(request.bars, this.defaultBars);
    const visibleBars = clampBars(
      request.visibleBars,
      Number.isFinite(Number(request.bars)) ? requestedBars : this.defaultBars,
    );
    const expandedBars = resolveExpandedBars(
      requestedBars,
      visibleBars,
      this.bufferMultiplier,
    );
    const direction =
      String(request.direction || "").trim().toLowerCase() === "history"
        ? "history"
        : "latest";
    const endTimeSec =
      Number.isFinite(Number(request.endTimeSec)) && Number(request.endTimeSec) > 0
        ? Number(request.endTimeSec)
        : null;
    const cacheKey = [
      "chart-history",
      symbol,
      timeframe,
      direction,
      expandedBars,
      endTimeSec || "latest",
    ].join(":");

    const cached = await this.cache?.get?.(cacheKey);
    if (cached?.bars?.length) {
      return this.#decorateSnapshot(cached, {
        request,
        requestedBars,
        visibleBars,
        expandedBars,
        resolutionPath: "cache",
        remoteRefreshed: false,
      });
    }

    let snapshot = await this.#loadSnapshot({
      symbol,
      timeframe,
      bars: expandedBars,
      endTimeSec,
    });
    const initialSnapshot = snapshot;
    let remoteRefreshed = false;
    let remoteAttempted = false;
    let remoteReturnedBars = 0;
    let remoteReason = "";
    let resolutionPath = "storage";

    if (Array.isArray(snapshot?.bars) && snapshot.bars.length < expandedBars) {
      remoteAttempted = typeof this.refreshHistory === "function";
      const hasStoredBars = snapshot.bars.length > 0;
      const canBackgroundRefresh =
        remoteAttempted && direction === "latest" && hasStoredBars;

      if (canBackgroundRefresh) {
        resolutionPath = "storage+background-remote";
        remoteReason = "background_refresh";
        fireAndForget(
          this.refreshHistory?.({
            symbol,
            timeframe,
            requestedBars: expandedBars,
            direction,
            endTimeSec,
          }),
        );
      } else {
        const refreshed = await withTimeout(
          this.refreshHistory?.({
            symbol,
            timeframe,
            requestedBars: expandedBars,
            direction,
            endTimeSec,
          }),
          this.refreshTimeoutMs,
          {
            ok: false,
            reason: "refresh_timeout",
            last_error: "refresh_timeout",
            fetched_source_bars: 0,
          },
        );
        remoteReturnedBars = Math.max(
          0,
          Number(refreshed?.fetched_source_bars) || 0,
        );
        remoteReason = String(
          refreshed?.reason || refreshed?.last_error || "",
        ).trim();
        if (refreshed?.ok) {
          remoteRefreshed = true;
          resolutionPath = "storage+remote";
          snapshot = await this.#loadSnapshot({
            symbol,
            timeframe,
            bars: expandedBars,
            endTimeSec,
          });
        }
      }
    }

    const decorated = this.#decorateSnapshot(snapshot, {
      request,
      requestedBars,
      visibleBars,
      expandedBars,
      resolutionPath,
      remoteRefreshed,
      remoteAttempted,
      remoteReturnedBars,
      remoteReason,
      initialSnapshot,
    });
    await this.cache?.set?.(cacheKey, decorated, { ttlMs: 15_000 });
    return decorated;
  }

  async #loadSnapshot(request = {}) {
    return this.loadSnapshot(request);
  }

  #decorateSnapshot(snapshot = {}, meta = {}) {
    const bars = Array.isArray(snapshot?.bars) ? snapshot.bars : [];
    const lastBar = bars.length ? bars[bars.length - 1] : null;
    const earliestBeforeSec = firstBarSec(meta.initialSnapshot);
    const earliestAfterSec = firstBarSec(snapshot);
    const requestedDirection =
      String(meta.request?.direction || "").trim().toLowerCase() === "history"
        ? "history"
        : "latest";
    const storageHadEarlier = Number.isFinite(earliestBeforeSec) && earliestBeforeSec > 0;
    const firstLoadedMovedEarlier =
      Number.isFinite(earliestBeforeSec) &&
      Number.isFinite(earliestAfterSec) &&
      earliestAfterSec < earliestBeforeSec;
    const remoteAttempted = meta.remoteAttempted === true;
    const remoteReturnedBars = Math.max(0, Number(meta.remoteReturnedBars) || 0);
    const exhausted =
      requestedDirection === "history" &&
      !bars.length &&
      remoteAttempted &&
      remoteReturnedBars === 0 &&
      !firstLoadedMovedEarlier;
    const outcome = bars.length
      ? "merged"
      : exhausted
        ? "exhausted"
        : "empty";
    return {
      ...snapshot,
      bars,
      lastPrice: Number(snapshot?.lastPrice) || Number(lastBar?.close) || null,
      metadata: {
        ...(snapshot?.metadata && typeof snapshot.metadata === "object"
          ? snapshot.metadata
          : {}),
        requested_bars: meta.requestedBars,
        visible_bars: meta.visibleBars,
        served_bars: bars.length,
        buffer_multiplier: this.bufferMultiplier,
        resolution_path: meta.resolutionPath,
        remote_refreshed: meta.remoteRefreshed,
        requested_direction: requestedDirection,
        request_end_time_sec:
          Number.isFinite(Number(meta.request?.endTimeSec)) && Number(meta.request.endTimeSec) > 0
            ? Number(meta.request.endTimeSec)
            : null,
        history_status: outcome,
        history_exhausted: exhausted,
        storage_had_earlier: storageHadEarlier,
        remote_attempted: remoteAttempted,
        remote_returned_bars: remoteReturnedBars,
        remote_reason: meta.remoteReason || null,
        earliest_before_sec: earliestBeforeSec,
        earliest_after_sec: earliestAfterSec,
        first_loaded_moved_earlier: firstLoadedMovedEarlier,
      },
    };
  }

  getStatus() {
    return {
      id: this.id,
      ready: typeof this.loadSnapshot === "function",
    };
  }
}
