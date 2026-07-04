"use strict";

const newsService = require("./newsService");

module.exports = {
  ...newsService,
  newsService,
};
