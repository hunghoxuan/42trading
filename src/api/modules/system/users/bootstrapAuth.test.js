const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_BOOTSTRAP_EMAIL,
  DEFAULT_BOOTSTRAP_PASSWORD,
  DEFAULT_BOOTSTRAP_USERNAME,
  buildBootstrapAuthUser,
} = require("./bootstrapAuth");

test("buildBootstrapAuthUser rewrites the default system user to admin credentials", () => {
  const out = buildBootstrapAuthUser({
    current: {
      user_id: "default",
      name: "System",
      email: "system",
      roles: ["admin"],
      permissions: [],
      is_active: false,
      password_salt: "old-salt",
      password_hash: "old-hash",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-02T00:00:00.000Z",
      metadata: { keep: true },
    },
    defaultUserId: "default",
    uiBootstrapEmail: DEFAULT_BOOTSTRAP_EMAIL,
    uiBootstrapPassword: DEFAULT_BOOTSTRAP_PASSWORD,
    nowIso: "2026-07-01T00:00:00.000Z",
    makeSaltHex: () => "fresh-salt",
    hashPassword: (password, salt) => `hash(${password}|${salt})`,
    normalizeEmail: (value) => String(value || "").trim().toLowerCase(),
    normalizeUserRoles: (value) =>
      Array.isArray(value) && value.length > 0 ? value : ["admin"],
    normalizeUserActive: (value, fallback) => (value == null ? fallback : Boolean(value)),
    fallbackNameFromEmail: (email) => String(email || "").split("@")[0] || "admin",
    defaultRoles: ["admin"],
  });

  assert.deepEqual(
    {
      user_id: out.user_id,
      name: out.name,
      email: out.email,
      roles: out.roles,
      permissions: out.permissions,
      is_active: out.is_active,
      password_salt: out.password_salt,
      password_hash: out.password_hash,
      created_at: out.created_at,
      updated_at: out.updated_at,
      metadata: out.metadata,
    },
    {
      user_id: "default",
      name: DEFAULT_BOOTSTRAP_USERNAME,
      email: DEFAULT_BOOTSTRAP_EMAIL,
      roles: ["admin"],
      permissions: [],
      is_active: true,
      password_salt: "fresh-salt",
      password_hash: "hash(123456|fresh-salt)",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
      metadata: { keep: true },
    },
  );
});
