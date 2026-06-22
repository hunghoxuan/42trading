import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serverSource = readFileSync(
  new URL("../src/api/server.js", import.meta.url),
  "utf8",
);

test("snapshots cron surfaces zero-created capture runs as failed notifications", () => {
  assert.match(
    serverSource,
    /created\.length === 0[\s\S]*notificationManager\.handle\("CRON_SNAPSHOT", "failed"/,
  );
  assert.match(
    serverSource,
    /Snapshot capture failed:[\s\S]*failedSymbols/,
  );
});
