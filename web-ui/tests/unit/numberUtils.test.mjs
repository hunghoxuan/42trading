import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAdjusterValue,
  toNumLoose,
} from "../../src/components/charts/numberUtils.js";

test("toNumLoose parses dot decimal", () => {
  assert.equal(toNumLoose("79827.83695"), 79827.83695);
});

test("toNumLoose parses comma decimal", () => {
  assert.equal(toNumLoose("79827,83695"), 79827.83695);
});

test("toNumLoose rejects invalid text", () => {
  assert.equal(Number.isNaN(toNumLoose("abc")), true);
});

test("resolveAdjusterValue prefers explicit numeric value", () => {
  assert.equal(resolveAdjusterValue("12", "50000"), 12);
});

test("resolveAdjusterValue falls back to market value when value is invalid", () => {
  assert.equal(resolveAdjusterValue("", "79827,83"), 79827.83);
});

test("resolveAdjusterValue returns zero if both values are invalid", () => {
  assert.equal(resolveAdjusterValue("", ""), 0);
});
