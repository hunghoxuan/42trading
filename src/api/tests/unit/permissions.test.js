const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeUserAccess,
  resolveUserPermissions,
  hasPermission,
} = require("../../shared/permissions");

test("normalizeUserAccess uses roles array and keeps explicit permissions", () => {
  assert.deepEqual(
    normalizeUserAccess({
      role: "admin",
      roles: ["seller"],
      permissions: ["apis.auth.users.read"],
    }),
    {
      role: "admin",
      roles: ["seller"],
      permissions: ["apis.auth.users.read"],
    },
  );
});

test("resolveUserPermissions expands inherited permissions", () => {
  const permissions = resolveUserPermissions({ roles: ["admin"] });
  assert.equal(permissions.includes("pages.42pay.dashboard"), true);
  assert.equal(permissions.includes("pages.42pay.products"), true);
  assert.equal(permissions.includes("apis.*"), true);
  assert.equal(hasPermission({ roles: ["admin"] }, "apis.auth.users.write"), true);
});

test("hasPermission respects inherited and wildcard permissions", () => {
  assert.equal(hasPermission({ roles: ["admin"] }, "pages.system.users"), true);
  assert.equal(hasPermission({ roles: ["buyer"] }, "pages.system.users"), false);
  assert.equal(hasPermission({ roles: ["buyer"] }, "apis.42pay.orders.write"), true);
});
