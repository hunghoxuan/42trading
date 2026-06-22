# 42trade Data Layer And Backtest Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a canonical market-data layer and a stronger backtest engine for `42trade` that ingest broker data once, normalize it into shared storage, and run repeatable strategy backtests against that same dataset.

**Architecture:** Keep the existing `src/api` and `src/admin` application shell, but split responsibilities clearly: adapters collect raw data from MT5/cTrader, a normalization layer writes canonical bars/ticks into `data/market_data`, and the backtest engine reads only canonical datasets plus stored strategy definitions. The first implementation should remain file-first (`parquet_duckdb` + `csv` compatibility) and only then add richer analytics and orchestration.

**Tech Stack:** Node.js, existing `src/api` services, Python MT5 bridge, DuckDB/Parquet, CSV compatibility, current object-store strategy configs, existing test suite in `tests/`.

---

## File Map

**Create**
- `src/api/services/marketDataCatalog.js` — canonical symbol/timeframe/provider metadata and dataset manifest helpers.
- `src/api/services/marketDataIngestService.js` — broker adapter orchestration, normalization, dedupe, and write flow.
- `src/api/services/brokerAdapters/mt5HistoricalAdapter.js` — MT5 historical bars/ticks pull wrapper.
- `src/api/services/brokerAdapters/ctraderHistoricalAdapter.js` — cTrader historical bar pull wrapper.
- `src/api/services/backtestEngine.js` — event loop, fills, costs, and portfolio accounting separated from route/storage concerns.
- `src/api/services/backtestMetrics.js` — summary stats, equity curve, drawdown, win/loss, expectancy, trade list transforms.
- `tests/marketDataIngestService.test.mjs` — ingestion, normalization, manifest, dedupe tests.
- `tests/backtestEngine.test.mjs` — fills, costs, no-lookahead, stop/tp, multi-strategy engine tests.
- `tests/backtestMetrics.test.mjs` — summary metric correctness.
- `src/config/schema/market-data-job.json` — input contract for ingestion jobs.

**Modify**
- `src/api/services/barsStorage.js` — promote canonical read/write surface and manifest support.
- `src/api/clients/mt5PythonBridgeClient.js` — add historical bars/ticks endpoints when bridge is ready.
- `src/mt5-bridge/python/bridge_server.py` — expose historical bars/ticks routes.
- `src/api/services/backtestService.js` — reduce to orchestration, persistence, and route-facing DTOs.
- `src/api/services/strategyConfigService.js` — ensure strategy definitions carry market/timeframe compatibility hints.
- `src/api/server.js` — add ingestion/run-status/backtest endpoints behind the existing API.
- `src/api/README.md` — document data-ingest jobs and backtest workflows.
- `tests/test_remote_api.sh` — add smoke coverage for new endpoints once stable.

## Delivery Strategy

1. Land the canonical data model first.
2. Wire MT5 historical ingestion first because it matches the current bridge.
3. Add cTrader as a second provider after the ingest contract is stable.
4. Extract and upgrade the backtest engine without breaking existing `backtestService.js` callers.
5. Expose operator-friendly routes and only then add UI/reporting polish.

### Task 1: Define Canonical Market Data Contracts

**Files:**
- Create: `src/api/services/marketDataCatalog.js`
- Create: `src/config/schema/market-data-job.json`
- Modify: `src/api/services/barsStorage.js`
- Test: `tests/marketDataIngestService.test.mjs`

- [ ] **Step 1: Write the failing contract test**

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDatasetKey,
  buildBarsManifestRow,
} from "../src/api/services/marketDataCatalog.js";

test("normalizeDatasetKey normalizes provider, symbol, and timeframe", () => {
  assert.equal(
    normalizeDatasetKey({
      provider: "MT5",
      accountScope: "demo-eu",
      symbol: "eurusd",
      timeframe: "1h",
    }),
    "mt5/demo-eu/EURUSD/60",
  );
});

test("buildBarsManifestRow exposes canonical metadata", () => {
  const row = buildBarsManifestRow({
    provider: "mt5",
    symbol: "XAUUSD",
    timeframe: "15",
    rows: 1200,
    firstBarTime: 1710000000,
    lastBarTime: 1710100000,
    storage: "parquet",
  });
  assert.equal(row.symbol, "XAUUSD");
  assert.equal(row.timeframe, "15");
  assert.equal(row.rows, 1200);
  assert.equal(row.storage, "parquet");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/marketDataIngestService.test.mjs`
Expected: FAIL with module or export not found errors.

- [ ] **Step 3: Write the minimal catalog implementation**

```js
const { normalizeCsvTfKey } = require("./barsStorage");

function normalizeProvider(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeSymbol(value = "") {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "");
}

function normalizeDatasetKey({ provider, accountScope, symbol, timeframe }) {
  return [
    normalizeProvider(provider),
    String(accountScope || "default").trim().toLowerCase(),
    normalizeSymbol(symbol),
    normalizeCsvTfKey(timeframe),
  ].join("/");
}

function buildBarsManifestRow(input = {}) {
  return {
    dataset_key: normalizeDatasetKey(input),
    provider: normalizeProvider(input.provider),
    account_scope: String(input.accountScope || "default").trim().toLowerCase(),
    symbol: normalizeSymbol(input.symbol),
    timeframe: normalizeCsvTfKey(input.timeframe),
    rows: Math.max(0, Number(input.rows) || 0),
    first_bar_time: Number(input.firstBarTime) || null,
    last_bar_time: Number(input.lastBarTime) || null,
    storage: String(input.storage || "parquet").trim().toLowerCase(),
  };
}

module.exports = {
  normalizeDatasetKey,
  buildBarsManifestRow,
};
```

- [ ] **Step 4: Add manifest read/write hooks to `barsStorage.js`**

```js
function getBarsManifestPath(options = {}) {
  return path.join(getMarketDataRoot(options), "_manifest.json");
}

function readBarsManifest(options = {}) {
  const filePath = getBarsManifestPath(options);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeBarsManifest(rows = [], options = {}) {
  const filePath = getBarsManifestPath(options);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(rows, null, 2)}\n`);
  return filePath;
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/marketDataIngestService.test.mjs`
Expected: PASS for contract-only tests.

Commit:

```bash
git add src/api/services/marketDataCatalog.js src/api/services/barsStorage.js src/config/schema/market-data-job.json tests/marketDataIngestService.test.mjs
git commit -m "feat: define canonical market data contracts"
```

### Task 2: Add MT5 Historical Ingestion

**Files:**
- Create: `src/api/services/brokerAdapters/mt5HistoricalAdapter.js`
- Create: `src/api/services/marketDataIngestService.js`
- Modify: `src/mt5-bridge/python/bridge_server.py`
- Modify: `src/api/clients/mt5PythonBridgeClient.js`
- Test: `tests/marketDataIngestService.test.mjs`

- [ ] **Step 1: Write the failing MT5 ingestion test**

```js
test("ingestHistoricalBars writes normalized MT5 bars and manifest row", async () => {
  const adapter = {
    async getHistoricalBars() {
      return [
        { time: 1710000000, open: 1.1, high: 1.2, low: 1.0, close: 1.15, volume: 10 },
        { time: 1710003600, open: 1.15, high: 1.25, low: 1.1, close: 1.2, volume: 12 },
      ];
    },
  };

  const result = await ingestHistoricalBars({
    provider: "mt5",
    symbol: "EURUSD",
    timeframe: "60",
    adapter,
    dataRoot: testDataRoot,
  });

  assert.equal(result.rowsWritten, 2);
  assert.equal(result.symbol, "EURUSD");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/marketDataIngestService.test.mjs`
Expected: FAIL with `ingestHistoricalBars` not defined.

- [ ] **Step 3: Add MT5 historical endpoints to bridge/client**

Python bridge handler snippet:

```python
handlers.update({
    "/bridge/market/bars": lambda current, payload: current.get_bars(
        symbol=self._required_string(payload, "symbol"),
        timeframe=self._required_string(payload, "timeframe"),
        count=int(payload.get("count") or 1000),
    ),
    "/bridge/market/ticks": lambda current, payload: current.get_ticks(
        symbol=self._required_string(payload, "symbol"),
        count=int(payload.get("count") or 1000),
    ),
})
```

Node client snippet:

```js
async bars(body) {
  return request("/bridge/market/bars", { method: "POST", body });
},
async ticks(body) {
  return request("/bridge/market/ticks", { method: "POST", body });
},
```

- [ ] **Step 4: Implement adapter and ingestion service**

```js
async function ingestHistoricalBars({ provider, symbol, timeframe, adapter, dataRoot }) {
  const rawRows = await adapter.getHistoricalBars({ symbol, timeframe });
  const normalizedRows = rawRows
    .map((row) => ({
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume || row.tick_volume || 0),
    }))
    .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.close));

  const rowsWritten = barsStorage.mergeBrokerBarsIntoFile(
    symbol,
    timeframe,
    normalizedRows,
    { dataRoot },
  );

  return { provider, symbol, timeframe, rowsWritten };
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/marketDataIngestService.test.mjs`
Expected: PASS including MT5 ingestion case.

Commit:

```bash
git add src/mt5-bridge/python/bridge_server.py src/api/clients/mt5PythonBridgeClient.js src/api/services/brokerAdapters/mt5HistoricalAdapter.js src/api/services/marketDataIngestService.js tests/marketDataIngestService.test.mjs
git commit -m "feat: add mt5 historical market data ingestion"
```

### Task 3: Add cTrader Historical Ingestion

**Files:**
- Create: `src/api/services/brokerAdapters/ctraderHistoricalAdapter.js`
- Modify: `src/api/services/marketDataIngestService.js`
- Modify: `src/api/server.js`
- Test: `tests/marketDataIngestService.test.mjs`

- [ ] **Step 1: Write the failing cTrader normalization test**

```js
test("ctrader adapter converts trendbars into canonical OHLC rows", async () => {
  const rows = normalizeCtraderTrendbars({
    symbol: { digits: 5, pipPosition: 4 },
    trendbars: [
      { utcTimestampInMinutes: 28500000, low: 109500, deltaOpen: 500, deltaHigh: 900, deltaClose: 700, volume: 22 },
    ],
  });
  assert.equal(rows[0].open, 1.1);
  assert.equal(rows[0].high, 1.104);
  assert.equal(rows[0].low, 1.095);
  assert.equal(rows[0].close, 1.102);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/marketDataIngestService.test.mjs`
Expected: FAIL with missing cTrader normalization helper.

- [ ] **Step 3: Implement cTrader adapter normalization**

```js
function normalizeCtraderTrendbars({ symbol, trendbars = [] }) {
  const scale = 10 ** Number(symbol?.digits || 5);
  return trendbars.map((bar) => {
    const low = Number(bar.low) / scale;
    return {
      time: Number(bar.utcTimestampInMinutes) * 60,
      low,
      open: low + Number(bar.deltaOpen) / scale,
      high: low + Number(bar.deltaHigh) / scale,
      close: low + Number(bar.deltaClose) / scale,
      volume: Number(bar.volume || 0),
    };
  });
}
```

- [ ] **Step 4: Register cTrader ingestion route**

```js
if (req.method === "POST" && url.pathname === "/api/market-data/ingest") {
  const body = await readJsonBody(req);
  const result = await marketDataIngestService.runIngestJob(body);
  return sendJson(res, 200, { ok: true, ...result });
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/marketDataIngestService.test.mjs`
Expected: PASS with both MT5 and cTrader cases.

Commit:

```bash
git add src/api/services/brokerAdapters/ctraderHistoricalAdapter.js src/api/services/marketDataIngestService.js src/api/server.js tests/marketDataIngestService.test.mjs
git commit -m "feat: add ctrader historical market data ingestion"
```

### Task 4: Extract A Real Backtest Engine

**Files:**
- Create: `src/api/services/backtestEngine.js`
- Create: `src/api/services/backtestMetrics.js`
- Modify: `src/api/services/backtestService.js`
- Modify: `src/api/services/strategyConfigService.js`
- Test: `tests/backtestEngine.test.mjs`
- Test: `tests/backtestMetrics.test.mjs`

- [ ] **Step 1: Write the failing backtest-engine tests**

```js
test("engine enters on next bar and prevents lookahead bias", async () => {
  const result = runBacktest({
    bars: [
      { time: 1, open: 10, high: 11, low: 9, close: 10 },
      { time: 2, open: 12, high: 13, low: 11, close: 12 },
    ],
    signals: [{ index: 0, action: "BUY" }],
  });
  assert.equal(result.trades[0].opened_at, new Date(2 * 1000).toISOString());
  assert.equal(result.trades[0].entry, 12);
});

test("metrics compute win rate and max drawdown", async () => {
  const metrics = buildBacktestMetrics({
    closedTrades: [{ pnl: 10 }, { pnl: -5 }, { pnl: 20 }],
    equityCurve: [100, 110, 105, 125],
  });
  assert.equal(metrics.winRate, 2 / 3);
  assert.equal(metrics.maxDrawdown, 5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/backtestEngine.test.mjs tests/backtestMetrics.test.mjs`
Expected: FAIL with missing modules.

- [ ] **Step 3: Implement the minimal engine**

```js
function runBacktest({ bars = [], signals = [], costModel = {} }) {
  const trades = [];
  for (const signal of signals) {
    const nextBar = bars[signal.index + 1];
    if (!nextBar) continue;
    trades.push({
      action: signal.action,
      opened_at: new Date(nextBar.time * 1000).toISOString(),
      entry: Number(nextBar.open),
      fees: Number(costModel.flatFee || 0),
    });
  }
  return { trades };
}
```

- [ ] **Step 4: Move orchestration-only logic into `backtestService.js`**

```js
async function runStrategyBacktest({ userId, symbol, tf, strategyKey, limit }) {
  const strategy = await resolveStrategyDefinition(userId, strategyKey);
  const bars = normalizeBars(symbol, tf, limit);
  const engineResult = runBacktest({
    bars,
    signals: buildSignalsFromStrategy(strategy, bars),
    costModel: strategy.risk?.costs || {},
  });
  const metrics = buildBacktestMetrics({
    closedTrades: engineResult.trades,
    equityCurve: engineResult.equityCurve || [],
  });
  return persistBacktestRun({ userId, strategy, symbol, tf, bars, engineResult, metrics });
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/backtestEngine.test.mjs tests/backtestMetrics.test.mjs`
Expected: PASS.

Commit:

```bash
git add src/api/services/backtestEngine.js src/api/services/backtestMetrics.js src/api/services/backtestService.js src/api/services/strategyConfigService.js tests/backtestEngine.test.mjs tests/backtestMetrics.test.mjs
git commit -m "feat: extract reusable backtest engine and metrics"
```

### Task 5: Add Strategy Compatibility And Dataset Selection

**Files:**
- Modify: `src/api/services/strategyConfigService.js`
- Modify: `src/config/schema/strategy.json`
- Modify: `src/api/services/backtestService.js`
- Test: `tests/backtestEngine.test.mjs`

- [ ] **Step 1: Write the failing strategy-market compatibility test**

```js
test("strategy requires matching provider, symbol, and timeframe filters", async () => {
  const strategy = {
    market: {
      providers: ["mt5"],
      symbols: ["EURUSD"],
      timeframes: ["60"],
    },
  };
  assert.equal(strategySupportsDataset(strategy, { provider: "mt5", symbol: "EURUSD", timeframe: "60" }), true);
  assert.equal(strategySupportsDataset(strategy, { provider: "ctrader", symbol: "EURUSD", timeframe: "60" }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/backtestEngine.test.mjs`
Expected: FAIL with missing compatibility helper.

- [ ] **Step 3: Extend strategy schema and compatibility helper**

```js
function strategySupportsDataset(strategy = {}, dataset = {}) {
  const market = strategy.market || {};
  const providers = new Set((market.providers || []).map((item) => String(item).toLowerCase()));
  const symbols = new Set((market.symbols || []).map((item) => String(item).toUpperCase()));
  const timeframes = new Set((market.timeframes || []).map((item) => String(item)));
  if (providers.size && !providers.has(String(dataset.provider || "").toLowerCase())) return false;
  if (symbols.size && !symbols.has(String(dataset.symbol || "").toUpperCase())) return false;
  if (timeframes.size && !timeframes.has(String(dataset.timeframe || ""))) return false;
  return true;
}
```

- [ ] **Step 4: Make backtests resolve datasets from the manifest**

```js
const manifest = barsStorage.readBarsManifest();
const dataset = manifest.find((row) =>
  strategySupportsDataset(strategy, {
    provider: row.provider,
    symbol: row.symbol,
    timeframe: row.timeframe,
  }),
);
if (!dataset) {
  throw new Error("No compatible market dataset found for strategy");
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/backtestEngine.test.mjs`
Expected: PASS.

Commit:

```bash
git add src/api/services/strategyConfigService.js src/config/schema/strategy.json src/api/services/backtestService.js tests/backtestEngine.test.mjs
git commit -m "feat: add strategy and dataset compatibility selection"
```

### Task 6: Expose Operator Routes And Documentation

**Files:**
- Modify: `src/api/server.js`
- Modify: `src/api/README.md`
- Modify: `tests/test_remote_api.sh`

- [ ] **Step 1: Write the failing API smoke test**

```bash
curl -fsS -X POST http://127.0.0.1:3001/api/market-data/ingest \
  -H 'content-type: application/json' \
  -d '{"provider":"mt5","symbol":"EURUSD","timeframe":"60","count":500}' | jq -e '.ok == true'
```

- [ ] **Step 2: Run smoke test to verify it fails**

Run: `bash tests/test_remote_api.sh`
Expected: FAIL with `404` or route missing.

- [ ] **Step 3: Add operator routes**

```js
POST /api/market-data/ingest
GET  /api/market-data/manifest
POST /api/backtests/run
GET  /api/backtests/:runId
GET  /api/backtests/:runId/trades
```

- [ ] **Step 4: Update README with the canonical workflow**

```md
1. Ingest broker history into canonical market-data storage.
2. Verify dataset availability through `/api/market-data/manifest`.
3. Create or activate a compatible strategy.
4. Run `/api/backtests/run`.
5. Inspect trades, metrics, and stored artifacts.
```

- [ ] **Step 5: Run smoke tests and commit**

Run: `bash tests/test_remote_api.sh`
Expected: PASS for route availability and basic happy path.

Commit:

```bash
git add src/api/server.js src/api/README.md tests/test_remote_api.sh
git commit -m "feat: expose market data and backtest operator routes"
```

## Acceptance Criteria

- `42trade` can ingest MT5 historical bars into canonical storage without manual file editing.
- `42trade` can ingest cTrader historical bars into the same canonical schema.
- All backtests run only from canonical datasets, never directly from broker-specific payloads.
- Strategy configs can declare dataset compatibility.
- Backtest output includes persisted trades plus summary metrics.
- Operator routes exist for ingestion, manifest inspection, run execution, and run retrieval.

## Recommended Execution Order

1. Task 1
2. Task 2
3. Task 4
4. Task 5
5. Task 6
6. Task 3

Reason: MT5-first gets value fastest because the current repo already has the bridge. cTrader should land only after the core ingest contract is stable.

## Risks To Watch

- MT5 macOS limitations mean historical collection may still need a Windows-hosted terminal even if `42trade` stays on macOS.
- cTrader trendbar normalization must be verified carefully to avoid price-scale errors.
- Existing `backtestService.js` may already be used by UI/API routes, so extraction should preserve response shapes until callers are migrated.
- Canonical manifest drift is possible if files are edited outside the service; all writes must go through the ingest/storage layer.

## Self-Review

- Spec coverage: covered data layer, source syncing, custom strategy compatibility, backtest engine extraction, and operator routes.
- Placeholder scan: no `TODO` or `TBD` markers remain.
- Type consistency: provider/symbol/timeframe normalization is consistent across catalog, ingest, and strategy compatibility tasks.

## Recommended First Slice

If you want the smallest high-value milestone, execute **Task 1 + Task 2 + Task 4** first. That gives `42trade` a real MT5-backed canonical dataset plus a reusable engine without waiting for cTrader.

Plan complete and saved to `docs/superpowers/plans/2026-06-15-42trade-data-layer-and-backtest-engine.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
