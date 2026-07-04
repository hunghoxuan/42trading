import test from "node:test";
import assert from "node:assert/strict";

import {
  isExplicitAuthFailure,
  loadStoredAuthUser,
  shouldApplyBootstrapAuthResult,
  storeAuthUserSnapshot,
} from "./authSession.js";

test("bootstrap auth result applies when auth state has not changed", () => {
  assert.equal(
    shouldApplyBootstrapAuthResult({
      cancelled: false,
      startedAuthVersion: 0,
      currentAuthVersion: 0,
    }),
    true,
  );
});

test("bootstrap auth result is ignored after a later auth state change", () => {
  assert.equal(
    shouldApplyBootstrapAuthResult({
      cancelled: false,
      startedAuthVersion: 0,
      currentAuthVersion: 1,
    }),
    false,
  );
});

test("bootstrap auth result is ignored after cancellation", () => {
  assert.equal(
    shouldApplyBootstrapAuthResult({
      cancelled: true,
      startedAuthVersion: 0,
      currentAuthVersion: 0,
    }),
    false,
  );
});

test("explicit auth failure matches redirect-style auth errors", () => {
  assert.equal(
    isExplicitAuthFailure({
      authRedirect: true,
      apiRequest: { status: 401 },
      message: "Session expired. Redirecting to login.",
    }),
    true,
  );
});

test("transient timeout is not treated as explicit auth failure", () => {
  assert.equal(
    isExplicitAuthFailure({
      apiRequest: { status: 0 },
      message: "Request timeout (8s). Check API URL and server status.",
    }),
    false,
  );
});

test("auth user snapshot can be stored and loaded", () => {
  const storage = new Map();
  const adapter = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };
  const user = { user_id: "default", name: "admin", roles: ["admin"] };
  storeAuthUserSnapshot(user, adapter);
  assert.deepEqual(loadStoredAuthUser(adapter), user);
  storeAuthUserSnapshot(null, adapter);
  assert.equal(loadStoredAuthUser(adapter), null);
});
