"use strict";

const tradesRepoModule = require("./tradesRepo");
const tradeArtifactSync = require("./tradeArtifactSync");
const tradesRepo =
  tradesRepoModule.tradesRepo ||
  tradesRepoModule.createTradeRepository ||
  tradesRepoModule;

module.exports = {
  ...tradesRepoModule,
  tradesRepo,
  tradeArtifactSync,
};
