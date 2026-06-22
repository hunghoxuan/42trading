"use strict";

const tradesRepo = require("./tradesRepo");
const tradeArtifactSync = require("./tradeArtifactSync");

module.exports = {
  ...tradesRepo,
  tradesRepo,
  tradeArtifactSync,
};
