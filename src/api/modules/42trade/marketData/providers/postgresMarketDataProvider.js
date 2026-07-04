"use strict";

module.exports = function createPostgresMarketDataProvider() {
  return {
    name: "postgres",
    kind: "database",
    extension: "",
    getPathCandidates() {
      return [];
    },
    resolvePath() {
      return "";
    },
    readBars() {
      throw new Error("Market data provider `postgres` is not implemented yet");
    },
    overwriteBars() {
      throw new Error("Market data provider `postgres` is not implemented yet");
    },
    mergeBars() {
      throw new Error("Market data provider `postgres` is not implemented yet");
    },
  };
};
