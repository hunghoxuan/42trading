#!/usr/bin/env node
"use strict";

if (!process.env.CTRADER_SERVICE_TAG) {
  process.env.CTRADER_SERVICE_TAG = "ctrader2-downstream";
}
if (!process.env.CTRADER_DOWNSTREAM_PORT && process.env.CTRADER2_DOWNSTREAM_PORT) {
  process.env.CTRADER_DOWNSTREAM_PORT = process.env.CTRADER2_DOWNSTREAM_PORT;
}
if (
  !process.env.CTRADER_DOWNSTREAM_API_KEY &&
  process.env.CTRADER2_DOWNSTREAM_API_KEY
) {
  process.env.CTRADER_DOWNSTREAM_API_KEY =
    process.env.CTRADER2_DOWNSTREAM_API_KEY;
}
if (!process.env.WEBHOOK_SYNC_PATH) {
  process.env.WEBHOOK_SYNC_PATH = "/api/broker/prices-sync";
}

const base = require("./ctrader_downstream_server.js");

if (require.main === module) {
  base.startServer();
}

module.exports = base;
