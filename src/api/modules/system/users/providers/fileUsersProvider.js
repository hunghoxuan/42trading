"use strict";

const fs = require("fs");
const path = require("path");
const { createObjectStoreRepo } = require("../../../../shared/objects/objectStoreRepo");
const {
  normalizePermissions,
  normalizeRoles,
} = require("../../../../shared/permissions");

const SYSTEM_USERS_SCOPE = "__system__";
const SYSTEM_USERS_OBJECT_TYPE = "system_users";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
}

function safeUserId(userId) {
  return (
    String(userId || "default")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_") || "default"
  );
}

function migrateLegacyRoleId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "system") return "admin";
  if (raw === "guest") return "buyer";
  if (raw === "merchant") return "seller";
  if (raw === "user") return "buyer";
  return raw;
}

function migrateLegacyRoles(value) {
  if (Array.isArray(value)) {
    return value.map(migrateLegacyRoleId).filter(Boolean);
  }
  const migrated = migrateLegacyRoleId(value);
  return migrated ? [migrated] : [];
}

function normalizeUserRecord(user = {}) {
  if (!user || typeof user !== "object") return null;
  return {
    ...user,
    roles: normalizeRoles(migrateLegacyRoles(user.roles ?? user.role)),
    permissions: normalizePermissions(user.permissions),
  };
}

function createFileUsersProvider(options = {}) {
  const rootDir = path.resolve(
    options.rootDir || path.join(process.cwd(), "data", "system", "users"),
  );
  const repo =
    options.repo ||
    createObjectStoreRepo(options.objectStore || {});
  let migratePromise = null;

  function userDir() {
    ensureDir(rootDir);
    return rootDir;
  }

  function userPath(userId) {
    return path.join(userDir(), `${safeUserId(userId)}.json`);
  }

  function readUserByPath(absPath) {
    try {
      return JSON.parse(fs.readFileSync(absPath, "utf8") || "{}");
    } catch {
      return null;
    }
  }

  async function migrateLegacyUsers() {
    const dir = userDir();
    const entries = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((entry) => entry.endsWith(".json"))
      : [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const user = normalizeUserRecord(readUserByPath(fullPath));
      if (!user || !user.user_id) continue;
      await repo.upsertObject(
        SYSTEM_USERS_SCOPE,
        SYSTEM_USERS_OBJECT_TYPE,
        user.user_id,
        user,
        "ACTIVE",
      );
      fs.unlinkSync(fullPath);
    }
  }

  async function ensureMigrated() {
    if (!migratePromise) {
      migratePromise = migrateLegacyUsers();
    }
    await migratePromise;
  }

  return {
    async getUserById(userId) {
      await ensureMigrated();
      const target = String(userId || "").trim();
      if (!target) return null;
      const row = await repo.getObject(
        SYSTEM_USERS_SCOPE,
        SYSTEM_USERS_OBJECT_TYPE,
        target,
      );
      const user = normalizeUserRecord(row?.data || null);
      if (user && JSON.stringify(user) !== JSON.stringify(row?.data || null)) {
        await repo.upsertObject(
          SYSTEM_USERS_SCOPE,
          SYSTEM_USERS_OBJECT_TYPE,
          target,
          user,
          "ACTIVE",
        );
      }
      return user;
    },

    async listUsers() {
      await ensureMigrated();
      const rows = await repo.listObjectsByType(
        SYSTEM_USERS_SCOPE,
        SYSTEM_USERS_OBJECT_TYPE,
      );
      return rows.map((row) => normalizeUserRecord(row.data || null)).filter(Boolean);
    },

    async writeUser(user) {
      await ensureMigrated();
      const normalizedUser = normalizeUserRecord(user);
      await repo.upsertObject(
        SYSTEM_USERS_SCOPE,
        SYSTEM_USERS_OBJECT_TYPE,
        normalizedUser.user_id,
        normalizedUser,
        "ACTIVE",
      );
      return normalizedUser;
    },

    async deleteUserById(userId) {
      await ensureMigrated();
      const target = String(userId || "").trim();
      if (!target) return { ok: false, error: "user_id is required" };
      const existing = await repo.getObject(
        SYSTEM_USERS_SCOPE,
        SYSTEM_USERS_OBJECT_TYPE,
        target,
      );
      if (!existing) return { ok: false, error: "User not found" };
      await repo.deleteObject(SYSTEM_USERS_SCOPE, SYSTEM_USERS_OBJECT_TYPE, target);
      return { ok: true };
    },
  };
}

module.exports = {
  createFileUsersProvider,
  SYSTEM_USERS_SCOPE,
  SYSTEM_USERS_OBJECT_TYPE,
};
