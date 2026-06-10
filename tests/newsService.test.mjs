import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildTrackedNewsEvents,
  collectEffectiveSymbolsForPhase,
  parseForexFactoryTimestamp,
} = require("../webhook/newsService.js");
const { normalizeSymbolGroupsData } = require("../webhook/symbolGroups.js");

const APP_CONFIG = {
  news: {
    source_timezone: "America/New_York",
    default_before_minutes: 30,
    default_during_minutes: 90,
    types: [
      {
        news_type: "CPI",
        aliases: ["CPI", "CORE CPI"],
        score: 95,
        effective_symbols: {
          USD: ["EURUSD", "XAUUSD"],
          ALL: ["EURUSD"],
        },
        effective_duration: {
          before_minutes: 30,
          during_minutes: 90,
        },
      },
      {
        news_type: "FOMC",
        aliases: ["FOMC", "INTEREST RATE DECISION"],
        score: 99,
        effective_symbols: {
          USD: ["EURUSD", "USDJPY", "US30"],
        },
        effective_duration: {
          before_minutes: 60,
          during_minutes: 180,
        },
      },
    ],
  },
};

test("parseForexFactoryTimestamp converts New York wall time to UTC", () => {
  const ts = parseForexFactoryTimestamp("06-08-2026", "8:30am", "America/New_York");
  const iso = new Date(ts).toISOString();
  assert.equal(iso, "2026-06-08T12:30:00.000Z");
});

test("parseForexFactoryTimestamp accepts ISO timestamps from current ForexFactory feed", () => {
  const ts = parseForexFactoryTimestamp(
    "2026-06-10T08:30:00-04:00",
    "",
    "America/New_York",
  );
  const iso = new Date(ts).toISOString();
  assert.equal(iso, "2026-06-10T12:30:00.000Z");
});

test("buildTrackedNewsEvents classifies configured events and computes active phases", () => {
  const now = Date.parse("2026-06-08T12:10:00.000Z");
  const events = buildTrackedNewsEvents(
    [
      {
        title: "CPI m/m",
        currency: "USD",
        impact: "High",
        date: "06-08-2026",
        time: "8:30am",
      },
      {
        title: "Untracked Event",
        currency: "USD",
        impact: "High",
        date: "06-08-2026",
        time: "10:00am",
      },
      {
        title: "FOMC Statement",
        currency: "USD",
        impact: "High",
        date: "06-08-2026",
        time: "2:00pm",
      },
    ],
    APP_CONFIG,
    now,
  );

  assert.equal(events.length, 2);
  assert.equal(events[0].news_type, "CPI");
  assert.equal(events[0].phase, "before");
  assert.deepEqual(events[0].effective_symbols, ["EURUSD", "XAUUSD"]);
  assert.equal(events[1].news_type, "FOMC");
  assert.equal(events[1].phase, "upcoming");
});

test("buildTrackedNewsEvents supports the current feed shape with ISO date and country", () => {
  const now = Date.parse("2026-06-10T12:10:00.000Z");
  const events = buildTrackedNewsEvents(
    [
      {
        title: "Core CPI m/m",
        country: "USD",
        impact: "High",
        date: "2026-06-10T08:30:00-04:00",
      },
      {
        title: "BOC Rate Statement",
        country: "CAD",
        impact: "High",
        date: "2026-06-10T09:45:00-04:00",
      },
    ],
    APP_CONFIG,
    now,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].news_type, "CPI");
  assert.equal(events[0].currency, "USD");
  assert.equal(events[0].phase, "before");
  assert.deepEqual(events[0].effective_symbols, ["EURUSD", "XAUUSD"]);
});

test("collectEffectiveSymbolsForPhase only returns symbols for before/during events", () => {
  const now = Date.parse("2026-06-08T12:35:00.000Z");
  const events = buildTrackedNewsEvents(
    [
      {
        title: "CPI m/m",
        currency: "USD",
        impact: "High",
        date: "06-08-2026",
        time: "8:30am",
      },
      {
        title: "FOMC Statement",
        currency: "USD",
        impact: "High",
        date: "06-08-2026",
        time: "2:00pm",
      },
    ],
    APP_CONFIG,
    now,
  );

  const symbols = collectEffectiveSymbolsForPhase(events, now);
  assert.deepEqual(symbols, ["EURUSD", "XAUUSD"]);
});

test("normalizeSymbolGroupsData preserves Watchlist and migrates legacy Newslist symbols into it", () => {
  const normalized = normalizeSymbolGroupsData({
    groups: [
      { id: "newslist", name: "Newslist", symbols: ["xauusd"] },
      { id: "custom", name: "Custom", symbols: ["eurusd"] },
    ],
  });
  assert.equal(normalized.groups[0].id, "watchlist");
  assert.deepEqual(normalized.groups[0].symbols, ["XAUUSD"]);
  assert.deepEqual(normalized.groups[1].symbols, ["EURUSD"]);
});
