"use strict";

const backtestService = require("./backtestService");
const ctraderBacktestQueueService = require("./ctraderBacktestQueueService");

module.exports = {
  ...backtestService,
  backtestService,
  ctraderBacktestQueueService,
};
