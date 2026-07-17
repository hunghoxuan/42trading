#!/usr/bin/env node
"use strict";

if (!process.env.CTRADER_SERVICE_TAG) {
  process.env.CTRADER_SERVICE_TAG = "ctrader2-executor";
}
if (!process.env.CTRADER_BROKER_PULL_PATH) {
  process.env.CTRADER_BROKER_PULL_PATH = "/api/trades/broker/pull";
}
if (!process.env.CTRADER_BROKER_ACK_PATH) {
  process.env.CTRADER_BROKER_ACK_PATH = "/api/trades/broker/ack";
}
if (!process.env.CTRADER_EXECUTOR_PORT && process.env.CTRADER2_EXECUTOR_PORT) {
  process.env.CTRADER_EXECUTOR_PORT = process.env.CTRADER2_EXECUTOR_PORT;
}
if (
  !process.env.CTRADER_ACCOUNT_API_KEY &&
  process.env.CTRADER2_ACCOUNT_API_KEY
) {
  process.env.CTRADER_ACCOUNT_API_KEY = process.env.CTRADER2_ACCOUNT_API_KEY;
}
if (
  !process.env.CTRADER_BROKER_BASE_URL &&
  process.env.CTRADER2_BROKER_BASE_URL
) {
  process.env.CTRADER_BROKER_BASE_URL = process.env.CTRADER2_BROKER_BASE_URL;
}
if (
  !process.env.CTRADER_BROKER_POLL_MS &&
  process.env.CTRADER2_BROKER_POLL_MS
) {
  process.env.CTRADER_BROKER_POLL_MS = process.env.CTRADER2_BROKER_POLL_MS;
}
if (
  !process.env.CTRADER_BROKER_PULL_MAX_ITEMS &&
  process.env.CTRADER2_BROKER_PULL_MAX_ITEMS
) {
  process.env.CTRADER_BROKER_PULL_MAX_ITEMS =
    process.env.CTRADER2_BROKER_PULL_MAX_ITEMS;
}

const base = require("./ctrader_executor_bridge.js");

if (require.main === module) {
  base.startServer();
}

module.exports = base;
