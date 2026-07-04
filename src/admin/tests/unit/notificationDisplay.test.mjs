import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNotificationChannels,
  buildNotificationHubMeta,
  buildNotificationRecord,
  isErrorEntry,
  normalizeServerEntry,
} from "../../shared/utils/notificationDisplay.js";

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

test("buildNotificationChannels derives trade and chart channels", () => {
  const channels = buildNotificationChannels({
    event: "trade_sync_update",
    symbol: "eurusd",
    sid: "TRD_123",
    data: {
      trade: { sid: "TRD_123" },
    },
  });

  assert.deepEqual(channels, ["TRADE_TRD_123", "CHART_EURUSD"]);
});

test("buildNotificationChannels uses source metadata and result symbols", () => {
  const channels = buildNotificationChannels({
    event: "chart_artifact_refresh",
    source_type: "trade",
    source_id: "TRD_456",
    data: {
      results: [{ symbol: "xauusd" }],
    },
  });

  assert.deepEqual(channels, ["TRADE_TRD_456", "CHART_XAUUSD"]);
});

test("buildNotificationRecord restores contextual trade update detail", () => {
  const record = buildNotificationRecord({
    type: "create_trade",
    event: "trade_sync_update",
    source_type: "trade",
    source_id: "TRD_789",
    message: "TRADE_SYNC_UPDATE",
    data: [
      {
        sid: "TRD_789",
        execution_status: "FILLED",
        broker_pnl: 42.5,
      },
    ],
  });

  assert.equal(record?.sourceLabel, "TRADE_SYNC_UPDATE");
  assert.equal(record?.message, "TRD_789 · Filled · PnL +42.50");
});

test("buildNotificationHubMeta exposes source type, id, status, and message", () => {
  const meta = buildNotificationHubMeta({
    type: "system_event",
    event: "chart_artifact_refresh",
    source_type: "trade",
    source_id: "TRD_999",
    status: "ok",
    message: "POST /api/chart/artifacts/refresh ok",
  });

  assert.deepEqual(meta, {
    sourceType: "Trade",
    sourceId: "TRD_999",
    status: "OK",
    message: "POST /api/chart/artifacts/refresh ok",
    tone: "trade",
  });
});

test("buildNotificationHubMeta maps chart notification sources to symbol tone", () => {
  const meta = buildNotificationHubMeta({
    type: "system_event",
    event: "chart_refresh_partial",
    source_type: "chart_refresh",
    source_id: "XAUUSD,EURUSD",
    status: "warning",
    message: "Chart refresh completed with partial errors: 2 symbols",
  });

  assert.deepEqual(meta, {
    sourceType: "Chart Refresh",
    sourceId: "XAUUSD,EURUSD",
    status: "WARNING",
    message: "Chart refresh completed with partial errors: 2 symbols",
    tone: "symbol",
  });
});
