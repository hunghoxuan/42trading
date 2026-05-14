#!/usr/bin/env node
"use strict";

/**
 * V2 Broker Executor Daemon (paper executor)
 *
 * Pulls trades from /v2/broker/pull using account API key, then acks them via /v2/broker/ack.
 * Default behavior:
 * - market order -> OPEN
 * - limit/stop order -> PENDING
 *
 * This daemon intentionally keeps logic simple and deterministic so it can be replaced
 * by a real broker adapter later without changing the VPS queue contract.
 */

const BASE_URL = String(
  process.env.V2_BROKER_BASE_URL || "https://127.0.0.1",
).replace(/\/+$/, "");
const API_KEY = String(process.env.V2_BROKER_ACCOUNT_API_KEY || "");
const POLL_MS = Math.max(500, Number(process.env.V2_BROKER_POLL_MS || 2000));
const MAX_ITEMS = Math.max(
  1,
  Math.min(20, Number(process.env.V2_BROKER_PULL_MAX_ITEMS || 1)),
);
const TAG = "v2-broker-executor";

if (!API_KEY) {
  console.error(`[${TAG}] missing V2_BROKER_ACCOUNT_API_KEY`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normOrderType(v) {
  const t = String(v || "")
    .trim()
    .toLowerCase();
  if (!t) return "market";
  if (t === "buy_limit" || t === "sell_limit") return "limit";
  if (t === "buy_stop" || t === "sell_stop") return "stop";
  return t;
}

function statusForOrderType(orderType) {
  const t = normOrderType(orderType);
  if (t === "market") return "OPEN";
  return "PENDING";
}

function makeTicket() {
  return `vx_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function postJson(path, payload) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify(payload || {}),
  });
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function processTrade(item) {
  const tradeId = String(item?.trade_id || "");
  const leaseToken = String(item?.lease_token || "");
  if (!tradeId || !leaseToken) return false;

  // Only handle OPEN (new trade) tasks. CANCEL/MODIFY/CLOSE must go to real broker (EA/cTrader).
  const taskType = String(item?.type || "").toUpperCase();
  if (taskType && taskType !== "OPEN") {
    // Release lease immediately so real broker can pick it up
    console.log(
      `[${TAG}] release type=${taskType} trade=${tradeId} — deferring to real broker`,
    );
    await postJson("/v2/broker/ack", {
      trade_id: tradeId,
      lease_token: leaseToken,
      execution_status: item?.execution_status || "PENDING",
      release_only: true,
    });
    return false;
  }

  const orderType = normOrderType(item?.order_type);
  const executionStatus = statusForOrderType(orderType);
  const ticket = makeTicket();
  const ackPayload = {
    trade_id: tradeId,
    lease_token: leaseToken,
    execution_status: executionStatus,
    broker_trade_id: ticket,
    entry_exec: Number.isFinite(Number(item?.entry))
      ? Number(item.entry)
      : null,
    event_type: "EXECUTOR_ACK",
    idempotency_key: `${tradeId}:${leaseToken}`,
    payload_json: {
      via: TAG,
      mode: "paper",
      order_type: orderType,
      symbol: String(item?.symbol || ""),
      action: String(item?.action || ""),
    },
  };

  const out = await postJson("/v2/broker/ack", ackPayload);
  console.log(
    `[${TAG}] ack ok trade=${tradeId} status=${executionStatus} ticket=${ticket} resp=${JSON.stringify(
      {
        dispatch_status: out?.dispatch_status,
        execution_status: out?.execution_status,
      },
    )}`,
  );
  return true;
}

async function once() {
  const out = await postJson("/v2/broker/pull", {
    max_items: MAX_ITEMS,
    task_type: "OPEN",
  });
  const items = Array.isArray(out?.items) ? out.items : [];
  if (items.length === 0) return 0;
  let processed = 0;
  for (const item of items) {
    try {
      const ok = await processTrade(item);
      if (ok) processed += 1;
    } catch (error) {
      console.error(
        `[${TAG}] trade failed id=${item?.trade_id || "-"} err=${error?.message || error}`,
      );
    }
  }
  return processed;
}

async function main() {
  console.log(
    `[${TAG}] starting base=${BASE_URL} poll_ms=${POLL_MS} max_items=${MAX_ITEMS}`,
  );
  while (true) {
    try {
      await once();
    } catch (error) {
      console.error(`[${TAG}] loop error: ${error?.message || error}`);
    }
    await sleep(POLL_MS);
  }
}

main().catch((error) => {
  console.error(`[${TAG}] fatal: ${error?.message || error}`);
  process.exit(1);
});
