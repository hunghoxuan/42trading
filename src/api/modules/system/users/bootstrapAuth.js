"use strict";

const DEFAULT_BOOTSTRAP_USERNAME = "admin";
const DEFAULT_BOOTSTRAP_EMAIL = "admin@example.com";
const DEFAULT_BOOTSTRAP_PASSWORD = "123456";

function buildBootstrapAuthUser({
  current = null,
  defaultUserId = "default",
  uiBootstrapEmail = DEFAULT_BOOTSTRAP_EMAIL,
  uiBootstrapPassword = DEFAULT_BOOTSTRAP_PASSWORD,
  nowIso = new Date().toISOString(),
  makeSaltHex,
  hashPassword,
  normalizeEmail,
  normalizeUserRoles,
  normalizeUserActive,
  fallbackNameFromEmail,
  defaultRoles = ["admin"],
} = {}) {
  if (typeof makeSaltHex !== "function" || typeof hashPassword !== "function") {
    throw new Error("buildBootstrapAuthUser requires makeSaltHex and hashPassword");
  }
  const normalizeEmailSafe =
    typeof normalizeEmail === "function"
      ? normalizeEmail
      : (value) => String(value || "").trim().toLowerCase();
  const normalizeRolesSafe =
    typeof normalizeUserRoles === "function"
      ? normalizeUserRoles
      : (value) =>
          Array.isArray(value) && value.length > 0
            ? value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
            : defaultRoles;
  const normalizeActiveSafe =
    typeof normalizeUserActive === "function"
      ? normalizeUserActive
      : (value, fallback = true) => (value == null ? fallback : Boolean(value));
  const fallbackNameSafe =
    typeof fallbackNameFromEmail === "function"
      ? fallbackNameFromEmail
      : (email) => String(email || "").split("@")[0] || DEFAULT_BOOTSTRAP_USERNAME;

  const email = normalizeEmailSafe(uiBootstrapEmail || DEFAULT_BOOTSTRAP_EMAIL);
  const username = fallbackNameSafe(email) || DEFAULT_BOOTSTRAP_USERNAME;
  const salt = makeSaltHex();

  return {
    ...(current || {}),
    user_id: String(current?.user_id || defaultUserId).trim() || defaultUserId,
    name: DEFAULT_BOOTSTRAP_USERNAME || username,
    email,
    roles: normalizeRolesSafe(current?.roles || defaultRoles),
    permissions:
      Array.isArray(current?.permissions) && current.permissions.length > 0
        ? current.permissions
        : [],
    is_active: normalizeActiveSafe(true, true),
    password_salt: salt,
    password_hash: hashPassword(uiBootstrapPassword, salt),
    created_at: String(current?.created_at || nowIso),
    updated_at: String(nowIso),
    metadata:
      current?.metadata && typeof current.metadata === "object"
        ? current.metadata
        : {},
  };
}

module.exports = {
  DEFAULT_BOOTSTRAP_EMAIL,
  DEFAULT_BOOTSTRAP_PASSWORD,
  DEFAULT_BOOTSTRAP_USERNAME,
  buildBootstrapAuthUser,
};
