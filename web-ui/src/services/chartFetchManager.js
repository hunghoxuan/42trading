/**
 * Chart Sync — shared fetch manager (per-TF).
 *
 * Cache key: {SYMBOL}_{TF}  (e.g. "EURUSD_4H")
 * Value: { bars, bar_start, bar_end, last_price, created_at, snapshot }
 * TTL: TF duration (e.g. 4H → 4 hours)
 */

const CONCURRENCY_CAP = 4;
const COOLDOWN_MS = 2500;

function tfToMs(tf) {
  const s = {
    D: 86400000,
    W: 604800000,
    "4H": 14400000,
    "1H": 3600000,
    "15M": 900000,
    "5M": 300000,
    "1M": 60000,
  };
  return s[String(tf).toUpperCase()] || 3600000;
}

// ── internal state ──
let activeCount = 0;
const queue = [];
const inFlight = new Map(); // "EURUSD:4H" → Promise
const lastFetch = new Map(); // "EURUSD:4H" → timestamp ms
const tfCache = new Map(); // "EURUSD_4H" → { bars, created_at, ... }

// ── helpers ──
function norm(s) {
  return String(s || "")
    .trim()
    .toUpperCase();
}
function cacheKey(symbol, tf) {
  return `${norm(symbol)}_${String(tf).toUpperCase()}`;
}
function flightKey(symbol, tf) {
  return `${norm(symbol)}:${String(tf).toLowerCase()}`;
}

// ── queue ──
function processQueue() {
  while (queue.length > 0 && activeCount < CONCURRENCY_CAP) {
    const { fkey, fetcher, resolve, reject } = queue.shift();
    startFetch(fkey, fetcher).then(resolve, reject);
  }
}

function startFetch(fkey, fetcher) {
  activeCount++;
  const promise = (async () => {
    try {
      const result = await fetcher();
      lastFetch.set(fkey, Date.now());
      // Store each TF result separately
      if (result && result.entries) {
        for (const [tf, entry] of Object.entries(result.entries)) {
          const ck = cacheKey(result.symbol, tf);
          tfCache.set(ck, { ...entry, created_at: Date.now() });
        }
      }
      return {
        data: result,
        fromCache: false,
        stale: false,
        updatedAt: Date.now(),
        error: null,
      };
    } catch (err) {
      return {
        data: null,
        fromCache: false,
        stale: false,
        updatedAt: null,
        error: String(err?.message || err || "fetch failed"),
      };
    } finally {
      activeCount--;
      inFlight.delete(fkey);
      processQueue();
    }
  })();
  inFlight.set(fkey, promise);
  return promise;
}

// ── public API ──

function enqueue(symbol, tf, fetcher) {
  const fkey = flightKey(symbol, tf);
  if (inFlight.has(fkey)) return inFlight.get(fkey);
  const now = Date.now();
  const last = lastFetch.get(fkey) || 0;
  if (now - last < COOLDOWN_MS) {
    const cached = get(symbol, tf);
    if (cached)
      return Promise.resolve({
        data: { symbol: norm(symbol), entries: { [tf]: cached } },
        fromCache: true,
        stale: true,
        updatedAt: cached.created_at,
        error: null,
      });
  }
  if (activeCount >= CONCURRENCY_CAP) {
    return new Promise((resolve, reject) => {
      queue.push({ fkey, fetcher, resolve, reject });
    });
  }
  return startFetch(fkey, fetcher);
}

/** Save an entry to cache. */
function set(symbol, tf, entry) {
  const key = cacheKey(symbol, tf);
  tfCache.set(key, { ...entry, created_at: Date.now() });
}

/** Get cached entry for a symbol+TF. Returns null if missing or expired. */
function get(symbol, tf) {
  const key = cacheKey(symbol, tf);
  const entry = tfCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.created_at > tfToMs(tf)) {
    tfCache.delete(key);
    return null;
  }
  return { ...entry, stale: false };
}

/** Check if symbol+TF has fresh data. */
function isFresh(symbol, tf) {
  return get(symbol, tf) !== null;
}

/** Get bars for a specific TF from cache. */
function getBars(symbol, tf) {
  const entry = get(symbol, tf);
  return entry?.bars || [];
}

/** Get snapshot info for a TF. */
function getSnapshot(symbol, tf) {
  const entry = get(symbol, tf);
  return entry?.snapshot || null;
}

function invalidate(symbol = "") {
  const prefix = norm(symbol) + "_";
  for (const key of tfCache.keys()) {
    if (!symbol || key.startsWith(prefix)) tfCache.delete(key);
  }
}

function isInFlight(symbol, tf) {
  return inFlight.has(flightKey(symbol, tf));
}

function reset() {
  activeCount = 0;
  queue.length = 0;
  inFlight.clear();
  lastFetch.clear();
  tfCache.clear();
}

export const chartFetchManager = {
  get,
  set,
  getBars,
  getSnapshot,
  isFresh,
  enqueue,
  invalidate,
  isInFlight,
  reset,
};
