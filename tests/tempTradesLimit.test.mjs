import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(
  new URL("../src/api/server.js", import.meta.url),
  "utf8",
);

test("temp trades API returns only the 10 newest response folders", () => {
  assert.match(serverSource, /entries\.sort\(\(a, b\) => \(b\.mtime_ms \|\| 0\) - \(a\.mtime_ms \|\| 0\)\);[\s\S]*entries\.slice\(0, 10\)/);
});
