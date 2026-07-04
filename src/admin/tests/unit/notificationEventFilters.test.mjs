import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSortedEvents,
  matchesEventFilter,
  matchesEventSearch,
} from "../../shared/utils/notificationEventFilters.js";

test("buildSortedEvents sorts by label/event text", () => {
  const sorted = buildSortedEvents([
    { event: "trade_closed", label: "Trade Closed" },
    { event: "cron_ai", label: "AI Analysis" },
  ]);

  assert.deepEqual(
    sorted.map((item) => item.event),
    ["cron_ai", "trade_closed"],
  );
});

test("matchesEventSearch includes channel keywords", () => {
  assert.equal(
    matchesEventSearch(
      { event: "trade_filled", label: "Trade Filled", ticker: true },
      "ticker",
    ),
    true,
  );
  assert.equal(
    matchesEventSearch(
      { event: "trade_filled", label: "Trade Filled", ticker: false },
      "ticker",
    ),
    false,
  );
});

test("matchesEventFilter applies muted and enabled-channel filters", () => {
  const base = {
    toast: true,
    console_log: false,
    ticker: true,
    db_log: true,
    hub: true,
    sound: "",
  };
  assert.equal(matchesEventFilter(base, "ticker_on"), true);
  assert.equal(matchesEventFilter(base, "sound_on"), false);
  assert.equal(matchesEventFilter(base, "muted"), true);
});
