import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(
  new URL("../src/api/server.js", import.meta.url),
  "utf8",
);

test("broker ack uses payload.error as rejection telemetry and reason", () => {
  assert.match(
    serverSource,
    /ack_message:\s*payload\.message \?\? payload\.msg \?\? payload\.error \?\? null/,
  );
  assert.match(
    serverSource,
    /payload\.message\s*\|\|\s*payload\.msg\s*\|\|\s*payload\.error\s*\|\|\s*payload\.note\s*\|\|\s*"Broker failed"/,
  );
});

test("broker ack applies a leased-row fallback for terminal broker failures", () => {
  assert.match(
    serverSource,
    /const canApplyTerminalFailFallback =[\s\S]*isBrokerFail[\s\S]*rowDispatchStatus === "LEASED"[\s\S]*!String\(row\.brokerTradeId \|\| ""\)\.trim\(\)/,
  );
  assert.match(
    serverSource,
    /event:\s*"TRADE_ACK_FALLBACK_APPLIED"/,
  );
  assert.match(
    serverSource,
    /archiveTradeTerminalArtifacts\(fallbackRow,\s*\{[\s\S]*statusOverride:\s*"REJECTED"/,
  );
});
