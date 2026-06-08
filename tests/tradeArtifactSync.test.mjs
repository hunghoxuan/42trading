import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const helpers = require("../webhook/tradeArtifactSync");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trade-artifact-sync-"));
}

test("renameSnapshotForTrade appends timestamp and status", () => {
  const out = helpers.renameSnapshotForTrade("USDCAD_D.png", {
    status: "pending",
    timestamp: new Date("2026-06-08T09:47:06.123Z"),
  });
  assert.equal(out, "USDCAD_D_20260608_094706_123UTC_pending.png");
});

test("copyMarketDataBarCsvToTradeDir normalizes timeframe aliases into canonical trade bars", () => {
  const root = makeTempDir();
  try {
    const marketDataRoot = path.join(root, "market_data");
    const tradeDir = path.join(root, "trade_closed", "TG17ANAJL-USDCAD");
    const srcDir = path.join(marketDataRoot, "USDCAD", "bars");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "60.csv"),
      "time,open,high,low,close,volume\n1,1,2,0.5,1.5,10\n",
    );

    const ok = helpers.copyMarketDataBarCsvToTradeDir({
      marketDataRoot,
      tradeDir,
      symbol: "USDCAD",
      timeframe: "1h",
    });

    assert.equal(ok, true);
    assert.equal(
      fs.readFileSync(path.join(tradeDir, "bars", "60.csv"), "utf8"),
      "time,open,high,low,close,volume\n1,1,2,0.5,1.5,10\n",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("copyMarketDataSnapshotsToTradeDir renames copied snapshots for the trade folder", () => {
  const root = makeTempDir();
  try {
    const snapshotRoot = path.join(root, "market_data");
    const tradeDir = path.join(root, "trade_closed", "TG17ANAJL-USDCAD");
    const srcDir = path.join(snapshotRoot, "USDCAD");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "USDCAD_D.png"), "png-data");

    const copied = helpers.copyMarketDataSnapshotsToTradeDir({
      snapshotRoot,
      tradeDir,
      symbol: "USDCAD",
      files: ["USDCAD_D.png"],
      status: "cancelled",
      rename: true,
    });

    assert.equal(copied.length, 1);
    assert.match(copied[0], /^USDCAD_D_2026.*_cancelled\.png$/);
    assert.equal(
      fs.readFileSync(path.join(tradeDir, "snapshots", copied[0]), "utf8"),
      "png-data",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
