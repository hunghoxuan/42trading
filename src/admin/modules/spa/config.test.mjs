import test from "node:test";
import assert from "node:assert/strict";
import { localInput, newDraft, reportRange } from "./config.js";

test("week and month ranges cover year/month transitions and leap day", () => {
  assert.deepEqual(reportRange("2027-01-01", "week"), { from: "2026-12-28", to: "2027-01-03" });
  assert.deepEqual(reportRange("2028-02-20", "month"), { from: "2028-02-01", to: "2028-02-29" });
});
test("schedule inputs use Vietnam time independently of browser timezone", () => {
  assert.equal(localInput("2026-10-29T18:30:00Z"), "2026-10-30T01:30");
  assert.equal(localInput(""), "");
  assert.equal(newDraft("work_logs").actual_starts_at, "");
  assert.equal(newDraft("services").duration_minutes, 60);
});
