import assert from "node:assert/strict";
import test from "node:test";

import {
  isErrorEntry,
  normalizeServerEntry,
} from "../../src/utils/notificationDisplay.js";

test("normalizeServerEntry marks failed server notifications as error", () => {
  const entry = normalizeServerEntry({
    event: "cron_ai",
    type: "error",
    message: "Local Ollama runner still stops even after reduced image fallback.",
    t: new Date().toISOString(),
  });

  assert.equal(entry.status, "error");
  assert.equal(isErrorEntry(entry), true);
});

test("isErrorEntry detects explicit failed notifications", () => {
  assert.equal(
    isErrorEntry({
      event: "cron_snapshot_failed",
      message: "Snapshot capture failed: no images were created",
    }),
    true,
  );
});
