import assert from "node:assert/strict";
import test from "node:test";

import { resolveDisplayedVersion } from "../../src/utils/appVersion.js";

test("resolveDisplayedVersion prefers server version when present", () => {
  assert.equal(resolveDisplayedVersion("1.2.3", "0.1.6"), "1.2.3");
});

test("resolveDisplayedVersion falls back to build version when server version is missing", () => {
  assert.equal(resolveDisplayedVersion("", "0.1.6"), "0.1.6");
  assert.equal(resolveDisplayedVersion(null, "0.1.6"), "0.1.6");
});

test("resolveDisplayedVersion returns empty string when neither version exists", () => {
  assert.equal(resolveDisplayedVersion("", ""), "");
});
