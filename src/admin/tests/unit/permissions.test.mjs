import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccessPage,
  getVisiblePages,
  normalizeUserAccess,
  pagePermissionForPath,
  resolveDefaultModulePath,
  resolveLoginDestination,
  resolveUserPermissions,
} from "../../shared/utils/permissions.js";

test("normalizeUserAccess only trusts roles array", () => {
  assert.deepEqual(
    normalizeUserAccess({
      role: "admin",
      roles: ["buyer"],
      permissions: ["apis.auth.me"],
    }),
    {
      role: "admin",
      roles: ["buyer"],
      permissions: ["apis.auth.me"],
    },
  );
});

test("resolveUserPermissions includes inherited page access", () => {
  const permissions = resolveUserPermissions({ roles: ["seller"] });
  assert.equal(permissions.includes("pages.42pay.dashboard"), true);
  assert.equal(permissions.includes("pages.42pay.offers"), true);
  assert.equal(permissions.includes("pages.system.users"), false);
});

test("page helpers expose only allowed pages", () => {
  assert.equal(
    pagePermissionForPath("/settings/providers/OPENAI_API_KEY"),
    "pages.settings.providers",
  );
  assert.equal(
    pagePermissionForPath("/admin/42pay/offers/scan"),
    "pages.42pay.offers",
  );
  assert.equal(canAccessPage({ roles: ["buyer"] }, "pages.settings.providers"), false);
  assert.equal(
    getVisiblePages({ roles: ["buyer"] }).some((page) => page.to === "/settings/providers"),
    false,
  );
  assert.equal(canAccessPage({ roles: ["seller"] }, "pages.42pay.products"), true);
});

test("trader role is scoped to trades pages", () => {
  assert.equal(canAccessPage({ roles: ["trader"] }, "pages.trades"), true);
  assert.equal(canAccessPage({ roles: ["trader"] }, "pages.dashboard"), true);
  assert.equal(canAccessPage({ roles: ["trader"] }, "pages.ai.analyze"), true);
  assert.equal(canAccessPage({ roles: ["trader"] }, "pages.backtests"), true);
  assert.equal(canAccessPage({ roles: ["trader"] }, "pages.settings.profile"), true);
  assert.equal(canAccessPage({ roles: ["trader"] }, "pages.42pay.dashboard"), false);
  assert.equal(canAccessPage({ roles: ["trader"] }, "pages.system.users"), false);
});

test("default module respects access priority and keeps admin in general trades", () => {
  assert.equal(resolveDefaultModulePath({ roles: ["admin"] }), "/trades/dashboard");
  assert.equal(resolveDefaultModulePath({ roles: ["seller"] }), "/admin/42pay/dashboard");
  assert.equal(resolveDefaultModulePath({ roles: ["trader"] }), "/trades/dashboard");
  assert.equal(resolveDefaultModulePath({ roles: ["pos_cashier"] }), "/admin/pos");
});

test("standalone POS return does not override other users' default module", () => {
  const posShellReturn = "http://127.0.0.1:3002/pos/";
  const options = { returnUrl: posShellReturn, baseUrl: "http://127.0.0.1:3000" };

  assert.equal(
    resolveLoginDestination({ roles: ["admin"] }, options),
    "/trades/dashboard",
  );
  assert.equal(
    resolveLoginDestination({ roles: ["seller"] }, options),
    "/admin/42pay/dashboard",
  );
  assert.equal(
    resolveLoginDestination({ roles: ["pos_cashier"] }, options),
    posShellReturn,
  );
  assert.equal(
    resolveLoginDestination({ roles: ["admin"] }, { ...options, selectedPosUser: true }),
    posShellReturn,
  );
});
