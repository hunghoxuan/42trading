import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const signalDetailUtilsSource = readFileSync(
  new URL("../../utils/signalDetailUtils.jsx", import.meta.url),
  "utf8",
);
const chartSnapshotsSource = readFileSync(
  new URL("../../pages/ai/ChartSnapshotsPage.jsx", import.meta.url),
  "utf8",
);

test("extractTradePlanFromTrade prefers saved row note and entry model over stale raw plan values", () => {
  assert.match(
    signalDetailUtilsSource,
    /const rawEntryModel = String\(\s*trade\.entry_model \|\|[\s\S]*meta\.entry_model \|\|[\s\S]*plan\.entry_model \|\|[\s\S]*raw\.entry_model \|\|/,
  );
  assert.match(
    signalDetailUtilsSource,
    /note: String\(\s*trade\.note \|\|[\s\S]*meta\.note \|\|[\s\S]*plan\?\.execution_plan\?\.tp3\?\.note \|\|[\s\S]*plan\?\.note \|\|[\s\S]*raw\.note \|\|/,
  );
});

test("validateTradePlan enforces ordered TP levels for buy and sell trades", () => {
  assert.match(
    signalDetailUtilsSource,
    /if \(tp2 != null && !\(tp2 < tp\)\)\s*return "For SELL, TP2 must be lower than TP1\."/,
  );
  assert.match(
    signalDetailUtilsSource,
    /if \(tp3 != null && !\(tp3 < \(tp2 \?\? tp\)\)\)\s*return "For SELL, TP3 must be lower than TP2\."/,
  );
  assert.match(
    signalDetailUtilsSource,
    /if \(tp2 != null && !\(tp2 > tp\)\)\s*return "For BUY, TP2 must be greater than TP1\."/,
  );
});

test("trade detail load resets TP slots from extracted plan instead of preserving stale previous targets", () => {
  assert.match(
    chartSnapshotsSource,
    /const extractedPlan = extractTradePlanFromTrade\(exact\);/,
  );
  assert.match(
    chartSnapshotsSource,
    /tp3: extractedPlan\.tp3 != null \? String\(extractedPlan\.tp3\) : ""/,
  );
  assert.doesNotMatch(
    chartSnapshotsSource,
    /exact\.tp3 != null \? formatNum3\(exact\.tp3\) : String\(prev\?\.tp3 \|\| ""\)/,
  );
});
