import test from "node:test";
import assert from "node:assert/strict";

import {
  mergePlanPreservingEdits,
  normalizePlanLinePrice,
} from "../../src/utils/tradePlanDrafts.js";

test("mergePlanPreservingEdits keeps valid edited trade levels over refreshed source values", () => {
  const basePlan = {
    direction: "BUY",
    entry: "100",
    tp: "110",
    tp1: "110",
    tp2: "120",
    tp3: "130",
    sl: "90",
    rr: "1.0",
    strategy: "fresh-strategy",
  };
  const previousDraft = {
    entry: "101",
    tp: "111",
    tp1: "111",
    tp2: "121",
    tp3: "131",
    sl: "91",
    rr: "1.2",
  };

  assert.deepEqual(mergePlanPreservingEdits(basePlan, previousDraft), {
    direction: "BUY",
    entry: "101",
    tp: "111",
    tp1: "111",
    tp2: "121",
    tp3: "131",
    sl: "91",
    rr: "1.2",
    strategy: "fresh-strategy",
  });
});

test("normalizePlanLinePrice treats numeric strings as valid chart line prices", () => {
  assert.equal(normalizePlanLinePrice("121.5"), 121.5);
  assert.equal(normalizePlanLinePrice(122.25), 122.25);
  assert.equal(normalizePlanLinePrice(""), null);
  assert.equal(normalizePlanLinePrice("not-a-number"), null);
});
