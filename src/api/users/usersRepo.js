"use strict";

const { createFileUsersProvider } = require("./usersCore");

function createUserRepository(options = {}) {
  const backend = String(
    options.storageBackend || options.backend || "file",
  ).trim().toLowerCase();
  if (backend !== "file") {
    throw new Error(`Unsupported users storage backend: ${backend}`);
  }
  return createFileUsersProvider(options);
}

module.exports = {
  createUserRepository,
};
