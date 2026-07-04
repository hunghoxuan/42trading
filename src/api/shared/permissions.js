"use strict";

const acl = require("../../config/acl.json");

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

function normalizeRoles(values) {
  if (Array.isArray(values) && values.length > 0) {
    return uniq(values.map(normalizeRoleId));
  }
  const single = normalizeRoleId(values);
  return single ? [single] : [];
}

function normalizePermissions(values) {
  return uniq(
    Array.isArray(values)
      ? values.map((value) => String(value || "").trim())
      : [],
  );
}

function normalizeUserAccess(user = {}) {
  return {
    ...user,
    roles: normalizeRoles(user?.roles),
    permissions: normalizePermissions(user?.permissions),
  };
}

function collectRolePermissions(roleId, seen = new Set()) {
  const normalizedRoleId = normalizeRoleId(roleId);
  if (!normalizedRoleId || seen.has(normalizedRoleId)) return [];
  seen.add(normalizedRoleId);
  const roleDef = acl.roles?.[normalizedRoleId] || null;
  if (!roleDef) return [];
  const inherited = (roleDef.inherits || []).flatMap((inheritedRoleId) =>
    collectRolePermissions(inheritedRoleId, seen),
  );
  return uniq([...(roleDef.permissions || []), ...inherited]);
}

function matchesPermission(granted, requested) {
  if (!granted || !requested) return false;
  if (granted === "*" || granted === requested) return true;
  if (granted.endsWith(".*")) {
    const prefix = granted.slice(0, -1);
    return requested.startsWith(prefix);
  }
  return false;
}

function resolveUserPermissions(user = {}) {
  const normalized = normalizeUserAccess(user);
  const inherited = normalized.roles.flatMap((roleId) =>
    collectRolePermissions(roleId),
  );
  return uniq([...inherited, ...normalized.permissions]);
}

function hasPermission(user, permission) {
  return resolveUserPermissions(user).some((granted) =>
    matchesPermission(granted, permission),
  );
}

module.exports = {
  ACL: acl,
  normalizeRoleId,
  normalizeRoles,
  normalizePermissions,
  normalizeUserAccess,
  resolveUserPermissions,
  hasPermission,
};
