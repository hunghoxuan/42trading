import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const syncGuards = require("../src/api/shared/utils/syncGuards.js");
const serverSource = readFileSync(
  new URL("../src/api/app/server.js", import.meta.url),
  "utf8",
);
const cTraderSource = readFileSync(
  new URL("../src/mt5-bridge/clients/TVBridge_CTrader.cs", import.meta.url),
  "utf8",
);

test("normalizeTradeMetadata parses JSON string metadata", () => {
  assert.deepEqual(
    syncGuards.normalizeTradeMetadata('{"leased_dispatch_status":"OPEN","lease_retry_count":2}'),
    {
      leased_dispatch_status: "OPEN",
      lease_retry_count: 2,
    },
  );
});

test("normalizeTradeMetadata drops enumerated-string metadata objects", () => {
  assert.deepEqual(
    syncGuards.normalizeTradeMetadata({
      0: "{",
      1: '"',
      2: "a",
      3: '"',
      4: ":",
      5: "1",
      6: "}",
      leased_dispatch_status: "OPEN",
      lease_retry_count: 9,
    }),
    {
      leased_dispatch_status: "OPEN",
      lease_retry_count: 9,
    },
  );
});

test("broker pull includes strategy in broker task payloads", () => {
  assert.match(
    serverSource,
    /strategy:\s*t\.strategy\s*\?\?\s*normalizedMetadata\.strategy\s*\?\?\s*normalizedMetadata\.strategy_name\s*\?\?\s*normalizedMetadata\.trade_plan\?\.strategy\s*\?\?\s*null/,
  );
});

test("broker sync falls back to cTrader label for strategy when label looks semantic", () => {
  assert.match(
    serverSource,
    /mt5LooksLikeBrokerStrategyLabel\(label,\s*signalId,\s*comment\)\s*\?\s*label\s*:\s*""/,
  );
});

test("cTrader client uses strategy text as label instead of forcing magic number", () => {
  assert.match(
    cTraderSource,
    /var strategyLabel = GetJsonValue\(json, "strategy"\);[\s\S]*var label = BuildBrokerLabel\(strategyLabel\);/,
  );
});
