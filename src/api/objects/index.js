"use strict";

const objectStore = require("./objectStore");
const objectLogService = require("./objectLogService");
const userObjectStore = require("./userObjectStore");

module.exports = {
  ...objectStore,
  ...objectLogService,
  ...userObjectStore,
  objectStore,
  objectLogService,
  userObjectStore,
};
