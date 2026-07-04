import test from "node:test";
import assert from "node:assert/strict";

import { formatNonJsonApiResponseError } from "../shared/utils/apiErrors.js";

test("formatNonJsonApiResponseError explains blank dev proxy 500s as backend unavailability", () => {
  assert.equal(
    formatNonJsonApiResponseError({
      path: "/auth/login",
      status: 500,
      text: "",
      isDev: true,
    }),
    "Backend API unavailable. Start src/api on :3001 and try again.",
  );
});

test("formatNonJsonApiResponseError preserves response snippets when a body exists", () => {
  assert.equal(
    formatNonJsonApiResponseError({
      path: "/auth/login",
      status: 500,
      text: "upstream exploded",
      isDev: true,
    }),
    "Server returned non-JSON response (500): upstream exploded...",
  );
});
