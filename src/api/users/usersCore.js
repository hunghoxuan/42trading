"use strict";

const fs = require("fs");
const path = require("path");

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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeIso(value, fallback) {
  const parsed = new Date(value || fallback || Date.now());
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : new Date().toISOString();
}

function normalizeRole(value, fallbackRole) {
  const role = String(value || fallbackRole || "User").trim();
  return role || String(fallbackRole || "User");
}

function normalizeActive(value, fallbackValue = true) {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === "0" || value === "false") return false;
  if (value === 1 || value === "1" || value === "true") return true;
  return Boolean(fallbackValue);
}

function jsonClone(value) {
  if (value === null || value === undefined) return {};
  if (typeof value === "object") {
    return JSON.parse(JSON.stringify(value));
  }
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

function createUserRepository(options = {}) {
  const rootDir = path.resolve(
    options.rootDir || path.join(process.cwd(), "data", "system", "users"),
  );
  const defaultUserId = String(options.defaultUserId || "default").trim();
  const defaultRole = String(options.defaultRole || "System").trim() || "System";
  const fallbackNameFromEmail =
    typeof options.fallbackNameFromEmail === "function"
      ? options.fallbackNameFromEmail
      : (email) => String(email || "").split("@")[0] || defaultUserId;

  function userDir() {
    ensureDir(rootDir);
    return rootDir;
  }

  function userPath(userId) {
    return path.join(userDir(), `${safeUserId(userId)}.json`);
  }

  function toStoredUser(input = {}) {
    const email = normalizeEmail(input.email || "");
    const userId = String(input.user_id || input.userId || defaultUserId).trim();
    const createdAt = normalizeIso(input.created_at, input.updated_at || Date.now());
    const updatedAt = normalizeIso(input.updated_at, Date.now());
    return {
      user_id: userId || defaultUserId,
      name: String(input.name || fallbackNameFromEmail(email)).trim(),
      email,
      role: normalizeRole(input.role, defaultRole),
      is_active: normalizeActive(input.is_active, true),
      password_salt: String(input.password_salt || ""),
      password_hash: String(input.password_hash || ""),
      metadata: jsonClone(input.metadata),
      created_at: createdAt,
      updated_at: updatedAt,
    };
  }

  function readUserByPath(absPath) {
    try {
      const raw = fs.readFileSync(absPath, "utf8");
      return toStoredUser(JSON.parse(raw || "{}"));
    } catch {
      return null;
    }
  }

  function writeUser(user) {
    const next = toStoredUser(user);
    fs.writeFileSync(userPath(next.user_id), JSON.stringify(next, null, 2));
    return next;
  }

  function listUsersSync() {
    const dir = userDir();
    return fs
      .readdirSync(dir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readUserByPath(path.join(dir, entry)))
      .filter(Boolean)
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  }

  return {
    async seedUsers(rows = [], options = {}) {
      const overwrite = options.overwrite === true;
      let written = 0;
      for (const row of Array.isArray(rows) ? rows : []) {
        const next = toStoredUser(row);
        const absPath = userPath(next.user_id);
        if (!overwrite && fs.existsSync(absPath)) continue;
        writeUser(next);
        written += 1;
      }
      return { ok: true, written };
    },

    async ensureUser(user = {}) {
      const next = toStoredUser(user);
      const current = await this.getUserById(next.user_id);
      if (current) return current;
      return writeUser(next);
    },

    async getUserByEmail(email) {
      const target = normalizeEmail(email);
      if (!target) return null;
      return listUsersSync().find((row) => normalizeEmail(row.email) === target) || null;
    },

    async getUserByName(name) {
      const target = String(name || "").trim().toLowerCase();
      if (!target) return null;
      return (
        listUsersSync().find(
          (row) => String(row.name || "").trim().toLowerCase() === target,
        ) || null
      );
    },

    async getUserById(userId) {
      const target = String(userId || "").trim();
      if (!target) return null;
      const absPath = userPath(target);
      if (!fs.existsSync(absPath)) return null;
      return readUserByPath(absPath);
    },

    async listUsers() {
      return listUsersSync();
    },

    async upsertUser(user = {}) {
      const current =
        (user.user_id && (await this.getUserById(user.user_id))) ||
        (user.email && (await this.getUserByEmail(user.email))) ||
        null;
      const next = toStoredUser({
        ...(current || {}),
        ...user,
        created_at: current?.created_at || user.created_at || Date.now(),
      });
      writeUser(next);
      return { ok: true, user: next };
    },

    async deleteUserById(userId) {
      const target = String(userId || "").trim();
      if (!target) return { ok: false, error: "user_id is required" };
      if (target === defaultUserId) {
        return { ok: false, error: "Cannot delete system default user" };
      }
      const absPath = userPath(target);
      if (!fs.existsSync(absPath)) return { ok: false, error: "User not found" };
      fs.unlinkSync(absPath);
      return { ok: true };
    },
  };
}

module.exports = {
  createFileUsersProvider: createUserRepository,
};
