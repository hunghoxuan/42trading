const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveUiSessionSameSite } = require("../../app/authCookiePolicy");

test("resolveUiSessionSameSite uses Lax for 127.0.0.1 dev requests", () => {
  assert.equal(
    resolveUiSessionSameSite({
      headers: { origin: "http://127.0.0.1:3000" },
    }),
    "Lax",
  );
});

test("resolveUiSessionSameSite uses Lax for localhost dev requests", () => {
  assert.equal(
    resolveUiSessionSameSite({
      headers: { origin: "http://localhost:3000" },
    }),
    "Lax",
  );
});

test("resolveUiSessionSameSite uses Lax when origin is absent", () => {
  assert.equal(resolveUiSessionSameSite({ headers: {} }), "Lax");
});
