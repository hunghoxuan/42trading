import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailSource = readFileSync(
  new URL("../../modules/42trade/pages/trades/V2TradeDetailPage.jsx", import.meta.url),
  "utf8",
);
const tradesSource = readFileSync(
  new URL("../../modules/42trade/pages/trades/TradesPage.jsx", import.meta.url),
  "utf8",
);
const signalDetailSource = readFileSync(
  new URL("../../modules/42trade/components/TradeDetailCard.jsx", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../../modules/42trade/components/TradePlanEditor.jsx", import.meta.url),
  "utf8",
);

test("draft trade detail wires Approve through the trade plan editor", () => {
  assert.match(detailSource, /function\s+onApproveDraft\s*\(/);
  assert.match(detailSource, /api\.promoteDraftTrade\(trade\.sid \|\| trade\.id\)/);
  assert.match(detailSource, /navigate\(`\/trades\/pending\/\$\{trade\.sid \|\| trade\.id\}`/);
  assert.match(detailSource, /onPromote:\s*isDraft\s*\?\s*onApproveDraft\s*:\s*undefined/);
  assert.match(detailSource, /promoteLabel:\s*"Approve"/);
  assert.match(detailSource, /onAddTrade:\s*!isDraft\s*\?\s*onReEntryTrade\s*:\s*undefined/);
});

test("draft trades route labels promotion as Approve and navigates to pending detail", () => {
  assert.match(tradesSource, /api\.promoteDraftTrade\(selectedTrade\.sid \|\| selectedTrade\.id\)/);
  assert.match(tradesSource, /confirm\("Approve this draft and move to pending\?"\)/);
  assert.match(tradesSource, /navigate\(`\/trades\/pending\/\$\{selectedTrade\.sid \|\| selectedTrade\.id\}`/);
  assert.match(tradesSource, /onAddTrade:\s*!isDraftSelected\s*\?\s*onReEntryTrade\s*:\s*undefined/);
  assert.match(tradesSource, /promoteLabel:\s*"Approve"/);
});

test("trade plan components render configurable promote label", () => {
  assert.match(signalDetailSource, /onPromote=\{tradePlan\.onPromote\}/);
  assert.match(signalDetailSource, /promoteLabel=\{tradePlan\.promoteLabel\}/);
  assert.match(editorSource, /promoteLabel = "Promote → Pending"/);
  assert.match(editorSource, /\{promoteLabel\}/);
});
