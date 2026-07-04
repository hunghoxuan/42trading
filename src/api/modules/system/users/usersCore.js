"use strict";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeIso(value, fallback) {
  const parsed = new Date(value || fallback || Date.now());
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : new Date().toISOString();
}

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeRoleId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "admin") return "admin";
  if (raw === "seller") return "seller";
  if (raw === "buyer") return "buyer";
  if (raw === "user") return "buyer";
  return raw;
}

function normalizeRoles(value, fallbackRoles = ["buyer"]) {
  const source = Array.isArray(value)
    ? value
    : value === null || value === undefined || value === ""
      ? fallbackRoles
      : [value];
  const roles = uniq(source.map(normalizeRoleId));
  return roles.length > 0 ? roles : uniq((fallbackRoles || ["buyer"]).map(normalizeRoleId));
}

function normalizePermissions(value) {
  return uniq(
    Array.isArray(value)
      ? value.map((permission) => String(permission || "").trim())
      : [],
  );
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

function createUserRepository(provider, options = {}) {
  if (!provider || typeof provider !== "object") {
    throw new Error("usersCore requires a provider object");
  }
  if (
    typeof provider.getUserById !== "function" ||
    typeof provider.listUsers !== "function" ||
    typeof provider.writeUser !== "function" ||
    typeof provider.deleteUserById !== "function"
  ) {
    throw new Error(
      "usersCore provider must implement getUserById, listUsers, writeUser, and deleteUserById",
    );
  }

  const defaultUserId = String(options.defaultUserId || "default").trim();
  const defaultRoles = normalizeRoles(options.defaultRoles || ["admin"]);
  const fallbackNameFromEmail =
    typeof options.fallbackNameFromEmail === "function"
      ? options.fallbackNameFromEmail
      : (email) => String(email || "").split("@")[0] || defaultUserId;

  function toStoredUser(input = {}) {
    const email = normalizeEmail(input.email || "");
    const userId = String(input.user_id || input.userId || defaultUserId).trim();
    const createdAt = normalizeIso(input.created_at, input.updated_at || Date.now());
    const updatedAt = normalizeIso(input.updated_at, Date.now());
    return {
      user_id: userId || defaultUserId,
      name: String(input.name || fallbackNameFromEmail(email)).trim(),
      email,
      roles: normalizeRoles(input.roles, defaultRoles),
      permissions: normalizePermissions(input.permissions),
      is_active: normalizeActive(input.is_active, true),
      password_salt: String(input.password_salt || ""),
      password_hash: String(input.password_hash || ""),
      metadata: jsonClone(input.metadata),
      created_at: createdAt,
      updated_at: updatedAt,
    };
  }

  return {
    async seedUsers(rows = [], seedOptions = {}) {
      const overwrite = seedOptions.overwrite === true;
      let written = 0;
      for (const row of Array.isArray(rows) ? rows : []) {
        const next = toStoredUser(row);
        const current = await provider.getUserById(next.user_id);
        if (!overwrite && current) continue;
        await provider.writeUser(next);
        written += 1;
      }
      return { ok: true, written };
    },

    async ensureUser(user = {}) {
      const next = toStoredUser(user);
      const current = await this.getUserById(next.user_id);
      if (current) return current;
      await provider.writeUser(next);
      return next;
    },

    async getUserByEmail(email) {
      const target = normalizeEmail(email);
      if (!target) return null;
      const rows = await provider.listUsers();
      return rows.find((row) => normalizeEmail(row.email) === target) || null;
    },

    async getUserByName(name) {
      const target = String(name || "").trim().toLowerCase();
      if (!target) return null;
      const rows = await provider.listUsers();
      return (
        rows.find(
          (row) => String(row.name || "").trim().toLowerCase() === target,
        ) || null
      );
    },

    async getUserById(userId) {
      const target = String(userId || "").trim();
      if (!target) return null;
      const row = await provider.getUserById(target);
      return row ? toStoredUser(row) : null;
    },

    async listUsers() {
      const rows = await provider.listUsers();
      return rows
        .map((row) => toStoredUser(row))
        .sort((a, b) =>
          String(a.created_at || "").localeCompare(String(b.created_at || "")),
        );
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
      await provider.writeUser(next);
      return { ok: true, user: next };
    },

    async deleteUserById(userId) {
      const target = String(userId || "").trim();
      if (!target) return { ok: false, error: "user_id is required" };
      if (target === defaultUserId) {
        return { ok: false, error: "Cannot delete system default user" };
      }
      return provider.deleteUserById(target);
    },
  };
}

module.exports = {
  createUserRepositoryCore: createUserRepository,
  jsonClone,
  normalizeActive,
  normalizeEmail,
  normalizeIso,
  normalizePermissions,
  normalizeRoleId,
  normalizeRoles,
};
