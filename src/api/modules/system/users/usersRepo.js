"use strict";

const { createUserRepositoryCore } = require("./usersCore");
const { createFileUsersProvider } = require("./providers/fileUsersProvider");

function createUserRepository(options = {}) {
  const backend = String(
    options.storageBackend || options.backend || "file",
  ).trim().toLowerCase();
  if (backend !== "file") {
    throw new Error(`Unsupported users storage backend: ${backend}`);
  }
  const provider = createFileUsersProvider(options);
  return createUserRepositoryCore(provider, options);
}

module.exports = {
  createUserRepository,
};
