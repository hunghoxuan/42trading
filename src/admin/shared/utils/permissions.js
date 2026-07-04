import acl from "../../../config/acl.json" with { type: "json" };

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeRoleId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "admin") return "admin";
  if (raw === "seller") return "seller";
  if (raw === "buyer") return "buyer";
  if (raw === "user") return "buyer";
  return raw;
}

export function normalizeRoles(values) {
  if (Array.isArray(values) && values.length > 0) {
    return uniq(values.map(normalizeRoleId));
  }
  const single = normalizeRoleId(values);
  return single ? [single] : [];
}

export function normalizeUserAccess(user = null) {
  const normalizedRoles = normalizeRoles(user?.roles);
  return {
    ...user,
    roles: normalizedRoles,
    permissions: uniq(
      Array.isArray(user?.permissions)
        ? user.permissions.map((permission) => String(permission || "").trim())
        : [],
    ),
  };
}

function collectRolePermissions(roleId, seen = new Set()) {
  const normalizedRoleId = normalizeRoleId(roleId);
  if (!normalizedRoleId || seen.has(normalizedRoleId)) return [];
  seen.add(normalizedRoleId);
  const roleDef = acl.roles?.[normalizedRoleId] || null;
  if (!roleDef) return [];
  const inherited = (roleDef.inherits || []).flatMap((childRole) =>
    collectRolePermissions(childRole, seen),
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

export function resolveUserPermissions(user = null) {
  const normalized = normalizeUserAccess(user);
  const inherited = normalized.roles.flatMap((roleId) =>
    collectRolePermissions(roleId),
  );
  return uniq([...inherited, ...normalized.permissions]);
}

export function hasPermission(user, requestedPermission) {
  const permissions = resolveUserPermissions(user);
  return permissions.some((granted) => matchesPermission(granted, requestedPermission));
}

export function canAccessPage(user, requestedPermission) {
  return hasPermission(user, requestedPermission);
}

export function pagePermissionForPath(pathname = "") {
  const path = String(pathname || "").trim();
  const exact = (acl.pages || []).find((page) => page.to === path);
  if (exact) return exact.permission;
  const prefixes = [
    ["/admin/42pay/dashboard/", "pages.42pay.dashboard"],
    ["/admin/42pay/products/", "pages.42pay.products"],
    ["/admin/42pay/offers/", "pages.42pay.offers"],
    ["/admin/42pay/scan/", "pages.42pay.scan"],
    ["/admin/42pay/orders/", "pages.42pay.orders"],
    ["/admin/42pay/admin/", "pages.42pay.admin.users"],
    ["/admin/pay42/dashboard/", "pages.42pay.dashboard"],
    ["/admin/pay42/products/", "pages.42pay.products"],
    ["/admin/pay42/offers/", "pages.42pay.offers"],
    ["/admin/pay42/scan/", "pages.42pay.scan"],
    ["/admin/pay42/orders/", "pages.42pay.orders"],
    ["/admin/pay42/admin/", "pages.42pay.admin.users"],
    ["/42pay/dashboard/", "pages.42pay.dashboard"],
    ["/42pay/products/", "pages.42pay.products"],
    ["/42pay/offers/", "pages.42pay.offers"],
    ["/42pay/scan/", "pages.42pay.scan"],
    ["/42pay/orders/", "pages.42pay.orders"],
    ["/42pay/admin/", "pages.42pay.admin.users"],
    ["/settings/providers/", "pages.settings.providers"],
    ["/settings/crons/", "pages.settings.crons"],
    ["/system/files/", "pages.system.files"],
    ["/system/storage/", "pages.system.files"],
    ["/system/snapshots/", "pages.system.files"],
    ["/system/cache/", "pages.system.cache"],
    ["/system/logs/", "pages.system.logs"],
    ["/system/db/", "pages.system.db_manager"],
    ["/system/health/", "pages.system.health"],
    ["/system/users/", "pages.system.users"],
    ["/system/accounts/", "pages.system.accounts"],
    ["/backtests/", "pages.backtests"],
    ["/studio/", "pages.studio"],
    ["/trades/", "pages.trades"],
    ["/ai/analyze/", "pages.ai.analyze"],
    ["/ai/result/", "pages.ai.analyze"],
    ["/ai/trade/", "pages.ai.analyze"],
    ["/ai/manual/", "pages.ai.analyze"],
    ["/ai/response/", "pages.ai.response"],
  ];
  const matched = prefixes.find(([prefix]) => path.startsWith(prefix));
  return matched ? matched[1] : null;
}

export function getVisiblePages(user, pages = acl.pages || []) {
  return pages.filter((page) => canAccessPage(user, page.permission));
}

export const ACL_PAGES = acl.pages || [];
export const ACL_APIS = acl.apis || [];
