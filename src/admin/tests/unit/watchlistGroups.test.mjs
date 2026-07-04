import assert from "node:assert/strict";
import test from "node:test";

import { mergeWatchlistIntoSymbolGroups } from "../../shared/utils/watchlistGroups.js";

test("mergeWatchlistIntoSymbolGroups updates an existing watchlist group", () => {
  const result = mergeWatchlistIntoSymbolGroups(
    { groups: [{ id: "watchlist", name: "Watchlist", symbols: ["EURUSD"] }] },
    ["gbpusd", "eurusd"],
    { groups: [{ id: "watchlist", name: "Watchlist", symbols: ["EURUSD"] }] },
  );

  assert.deepEqual(result.watchlist, ["GBPUSD", "EURUSD"]);
  assert.deepEqual(
    result.data.groups.find((group) => group.id === "watchlist")?.symbols,
    ["GBPUSD", "EURUSD"],
  );
});

test("mergeWatchlistIntoSymbolGroups creates the watchlist group when missing", () => {
  const result = mergeWatchlistIntoSymbolGroups(
    { groups: [{ id: "majors", name: "Majors", symbols: ["EURUSD"] }] },
    ["xauusd"],
    { groups: [{ id: "majors", name: "Majors", symbols: ["EURUSD"] }] },
  );

  assert.deepEqual(result.watchlist, ["XAUUSD"]);
  assert.deepEqual(
    result.data.groups.find((group) => group.id === "watchlist"),
    {
      id: "watchlist",
      name: "Watchlist",
      symbols: ["XAUUSD"],
    },
  );
});
