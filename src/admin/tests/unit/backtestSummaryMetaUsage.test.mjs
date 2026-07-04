import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backtestsPageSource = readFileSync(
  new URL("../../modules/42trade/pages/BacktestsPage.jsx", import.meta.url),
  "utf8",
);

const strategyEditorPanelSource = readFileSync(
  new URL("../../modules/42trade/components/StrategyEditorPanel.jsx", import.meta.url),
  "utf8",
);

test("strategy list summary shows trades instead of runs", () => {
  assert.match(
    backtestsPageSource,
    /leadLabel=\{`\$\{totalTrades\} trades`\}/,
  );
  assert.doesNotMatch(
    backtestsPageSource,
    /leadLabel=\{`\$\{runsCount\} runs`\}/,
  );
});

test("strategy editor reuses BacktestSummaryMetaRow under the combo", () => {
  assert.match(
    strategyEditorPanelSource,
    /<BacktestSummaryMetaRow[\s\S]*?leadLabel=\{`\$\{Math\.round\(Number\(backtestSummary\?\.total_trades \|\| 0\)\)\} trades`\}/,
  );
  assert.doesNotMatch(
    strategyEditorPanelSource,
    /formatBacktestSummaryNumber\(backtestSummary\?\.run_count \|\| 0, 0\)\}\s*runs/,
  );
});

test("active run panel renders the one-line summary row without pnl under the combo", () => {
  assert.doesNotMatch(
    backtestsPageSource,
    /Select a trade below to inspect the run\./,
  );
  assert.match(
    backtestsPageSource,
    /<BacktestSummaryMetaRow[\s\S]*?leadLabel=\{`\$\{Math\.round\(Number\(summaryTradesCount \|\| 0\)\)\} trades`\}/,
  );
  assert.doesNotMatch(
    backtestsPageSource,
    /<MetricValue[\s\S]*?value=\{summaryPnlValue\}/,
  );
});
