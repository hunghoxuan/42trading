import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mq5Source = readFileSync(
  new URL("../src/mt5-bridge/clients/TVBridgeEA.mq5", import.meta.url),
  "utf8",
);

const cTraderSource = readFileSync(
  new URL("../src/mt5-bridge/clients/TVBridge_CTrader.cs", import.meta.url),
  "utf8",
);

test("MT5 exposes a default Error,Reject log filter input", () => {
  assert.match(
    mq5Source,
    /input string\s+InpLogFilter\s*=\s*"Error,Reject";/,
  );
});

test("MT5 routes reject and fail ack logs through ERROR severity", () => {
  assert.match(
    mq5Source,
    /RemoteLog\("\[Reject\].*?"\s*\+\s*rejectMsg[\s\S]*?,\s*"ERROR"\)/,
  );
  assert.match(
    mq5Source,
    /RemoteLog\("\[Ack\]\s*"\s*\+\s*g_ackQStatus\[i\]\s*\+\s*"\s*sent for "\s*\+\s*signalId,[\s\S]*?IsErrorStatus\(g_ackQStatus\[i\]\)\s*\?\s*"ERROR"\s*:\s*"INFO"/,
  );
});

test("cTrader exposes a default Error,Reject log filter parameter", () => {
  assert.match(
    cTraderSource,
    /\[Parameter\("Log Filter".*?DefaultValue = "Error,Reject"/s,
  );
});

test("cTrader classifies failed ack and reject messages as error logs", () => {
  assert.match(
    cTraderSource,
    /SafeLog\([\s\S]*?IsErrorStatus\(status\)\s*\?\s*"ERROR"\s*:\s*"INFO"[\s\S]*?IsErrorStatus\(status\)\s*\?\s*"\[Error\] \[Ack\] \{0\} sent for \{1\}"\s*:\s*"\[Ack\] \{0\} sent for \{1\}"/,
  );
  assert.match(
    cTraderSource,
    /SafeLog\("ERROR",\s*"\[Reject\] \{0\}"/,
  );
  assert.match(
    cTraderSource,
    /,\\"message\\":\\"\s*"\s*\+\s*\(err \?\? ""\)\.Replace/,
  );
  assert.match(
    cTraderSource,
    /if \(!response\.IsSuccessStatusCode\)[\s\S]*throw new Exception\("HTTP "/,
  );
});
