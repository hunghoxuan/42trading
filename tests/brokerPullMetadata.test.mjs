import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const syncGuards = require("../src/api/utils/syncGuards.js");

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
