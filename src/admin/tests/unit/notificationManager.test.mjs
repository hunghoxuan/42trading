import assert from "node:assert/strict";
import test from "node:test";

import {
  getNotificationBadgeCount,
  mergeNotificationEntries,
  normalizeHubEntry,
} from "../../src/services/NotificationManager.js";

test("normalizeHubEntry preserves core fields and seen state", () => {
  const entry = normalizeHubEntry({
    requestId: "req-1",
    type: "system_event",
    status: "error",
    extra: "POST /api/example",
    _seen: true,
  });

  assert.equal(entry.requestId, "req-1");
  assert.equal(entry.type, "system_event");
  assert.equal(entry.status, "error");
  assert.equal(entry.extra, "POST /api/example");
  assert.equal(entry._seen, true);
});

test("mergeNotificationEntries merges local seen state onto server entries", () => {
  const merged = mergeNotificationEntries(
    [
      {
        requestId: "srv:1",
        createdAt: Date.now(),
        _seen: true,
        status: "ok",
      },
    ],
    [
      {
        requestId: "srv:1",
        createdAt: Date.now(),
        status: "ok",
        extra: "From server",
      },
    ],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]._seen, true);
  assert.equal(merged[0].extra, "From server");
});

test("getNotificationBadgeCount prefers unread count and falls back to running count", () => {
  assert.equal(
    getNotificationBadgeCount([
      { requestId: "a", _seen: false, status: "ok" },
      { requestId: "b", _seen: true, status: "running" },
    ]),
    1,
  );

  assert.equal(
    getNotificationBadgeCount([
      { requestId: "a", _seen: true, status: "running" },
      { requestId: "b", _seen: true, status: "ok" },
    ]),
    1,
  );
});
