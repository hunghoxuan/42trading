import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessionClockBarSource = readFileSync(
  new URL("../../components/SessionClockBar.jsx", import.meta.url),
  "utf8",
);

test("session clock bar cycles Local, New York, and UTC without a fixed VN line", () => {
  assert.match(sessionClockBarSource, /Asia\/Ho_Chi_Minh/);
  assert.match(
    sessionClockBarSource,
    /DISPLAY_TIMEZONE_CYCLE = \[\s*"Local",\s*"America\/New_York",\s*"UTC",\s*"Asia\/Ho_Chi_Minh",?\s*\];/,
  );
  assert.match(sessionClockBarSource, /const timezoneLabel = useMemo\(/);
  assert.match(sessionClockBarSource, /displayTimezone \|\| tz/);
  assert.doesNotMatch(sessionClockBarSource, /currentTz\.split\("\/"\)/);
  assert.match(sessionClockBarSource, /normalizedTz === "Asia\/Ho_Chi_Minh"/);
});
