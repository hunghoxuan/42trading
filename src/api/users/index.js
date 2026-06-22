"use strict";

const usersRepo = require("./usersRepo");

module.exports = {
  ...usersRepo,
  usersRepo,
};
