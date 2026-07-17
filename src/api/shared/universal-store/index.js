"use strict";

const { createUniversalStoreAdapter } = require("./adapterFactory");
const { createUniversalStoreFacade, UniversalStoreFacade } = require("./facade");
const { createUniversalStoreService, UniversalStoreService } = require("./service");
const { seedUniversalStoreDemoData } = require("./demoSeed");

module.exports = {
  createUniversalStoreAdapter,
  createUniversalStoreFacade,
  createUniversalStoreService,
  UniversalStoreFacade,
  UniversalStoreService,
  seedUniversalStoreDemoData,
};
