import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTH_REQUIRED_EVENT,
  isAuthRedirectError,
  shouldHandleAuthFailureWithGlobalRedirect,
  shouldRedirectToLoginOnAuthFailure,
  shouldRequireLoginScreen,
} from "./authPolicy.js";

test("shouldRequireLoginScreen requires login whenever there is no authenticated user", () => {
  assert.equal(shouldRequireLoginScreen({ authUser: null }), true);
  assert.equal(shouldRequireLoginScreen({ authUser: undefined }), true);
  assert.equal(
    shouldRequireLoginScreen({ authUser: { user_id: "alice" } }),
    false,
  );
});

test("shouldRedirectToLoginOnAuthFailure does not bypass auth in local dev", () => {
  assert.equal(
    shouldRedirectToLoginOnAuthFailure({
      isDev: true,
      envApiBase: "http://127.0.0.1:3001",
      envApiProxyTarget: "http://127.0.0.1:3001",
    }),
    true,
  );
  assert.equal(
    shouldRedirectToLoginOnAuthFailure({
      isDev: false,
      envApiBase: "",
      envApiProxyTarget: "",
    }),
    true,
  );
});

test("isAuthRedirectError detects the shared auth-expired redirect error", () => {
  assert.equal(
    isAuthRedirectError(new Error("Session expired. Redirecting to login.")),
    true,
  );
  assert.equal(
    isAuthRedirectError({ message: "AUTH_REQUIRED", authRedirect: true }),
    true,
  );
  assert.equal(isAuthRedirectError(new Error("Random failure")), false);
});

test("AUTH_REQUIRED_EVENT stays stable for app-wide auth expiry handling", () => {
  assert.equal(AUTH_REQUIRED_EVENT, "tvbridge:auth-required");
});

test("bootstrap and page auth failures trigger global auth redirect handling", () => {
  assert.equal(
    shouldHandleAuthFailureWithGlobalRedirect("/auth/me?hydrate=0"),
    true,
  );
  assert.equal(
    shouldHandleAuthFailureWithGlobalRedirect("/auth/me?hydrate=1"),
    true,
  );
  assert.equal(
    shouldHandleAuthFailureWithGlobalRedirect("/auth/profile"),
    true,
  );
});
