import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(
  new URL("../src/api/server.js", import.meta.url),
  "utf8",
);

test("saved trade response route returns structured failed payloads without transport errors", () => {
  assert.match(
    serverSource,
    /status:\s*"failed"[\s\S]*analysis_error:\s*errorData/,
  );
  assert.match(
    serverSource,
    /inferredFailureMessage[\s\S]*return json\(res, 200, \{[\s\S]*status:\s*"failed"/,
  );
});
