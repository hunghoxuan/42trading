"use strict";

const objectStore = require("./objectStore");
const objectStoreRepo = require("./objectStoreRepo");
const objectLogService = require("./objectLogService");
const userObjectStore = require("./userObjectStore");

module.exports = {
  ...objectStore,
  ...objectStoreRepo,
  ...objectLogService,
  ...userObjectStore,
  objectStore,
  objectStoreRepo,
  objectLogService,
  userObjectStore,
};
