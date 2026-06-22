import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseTimeToUnixSec, formatUnixSecForProvider } = require("../src/api/marketData/marketTime");

test("parseTimeToUnixSec preserves explicit UTC timestamps", () => {
  assert.equal(
    parseTimeToUnixSec("2026-06-17T12:34:56Z"),
    1781699696,
  );
});

test("parseTimeToUnixSec treats naive provider timestamps as UTC", () => {
  assert.equal(
    parseTimeToUnixSec("2026-06-17 12:34:56"),
    1781699696,
  );
  assert.equal(
    parseTimeToUnixSec("2026-06-17T12:34:56"),
    1781699696,
  );
});

test("parseTimeToUnixSec honors explicit numeric offsets", () => {
  assert.equal(
    parseTimeToUnixSec("2026-06-17T14:34:56+02:00"),
    1781699696,
  );
});

test("parseTimeToUnixSec returns null for empty or invalid input", () => {
  assert.equal(parseTimeToUnixSec(""), null);
  assert.equal(parseTimeToUnixSec("not-a-time"), null);
});

test("formatUnixSecForProvider returns UTC provider format", () => {
  assert.equal(
    formatUnixSecForProvider(1781699696),
    "2026-06-17T12:34:56",
  );
  assert.equal(formatUnixSecForProvider(0), "");
});
