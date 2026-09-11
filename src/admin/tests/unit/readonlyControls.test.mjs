import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const groupButtonsSource = readFileSync(
  new URL("../../shared/components/GroupButtons.jsx", import.meta.url),
  "utf8",
);
const inputComboSelectSource = readFileSync(
  new URL("../../shared/components/InputComboSelect.jsx", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../../modules/42trade/components/TradePlanEditor.jsx", import.meta.url),
  "utf8",
);
const strategyEditorSource = readFileSync(
  new URL("../../modules/42trade/components/StrategyEditorPanel.jsx", import.meta.url),
  "utf8",
);
const tradesPageSource = readFileSync(
  new URL("../../modules/42trade/pages/trades/TradesPage.jsx", import.meta.url),
  "utf8",
);

test("GroupButtons supports readOnly by disabling interaction and nested checks", () => {
  assert.match(groupButtonsSource, /readOnly\s*=\s*false/);
  assert.match(groupButtonsSource, /if\s*\(\s*disabled\s*\|\|\s*readOnly\s*\|\|\s*item\?\.disabled\s*\)\s*return/);
  assert.match(groupButtonsSource, /disabled=\{disabled\s*\|\|\s*readOnly\s*\|\|\s*item\?\.disabled\}/);
});

test("InputComboSelect centralizes the shared combo and hybrid control logic", () => {
  assert.match(inputComboSelectSource, /mode\s*=\s*"combo"/);
  assert.match(inputComboSelectSource, /const effectiveMode =/);
  assert.match(inputComboSelectSource, /if\s*\(\s*disabled\s*\|\|\s*readOnly\s*\)\s*return;/);
  assert.match(inputComboSelectSource, /effectiveMode === "text"/);
  assert.match(inputComboSelectSource, /effectiveMode === "both"/);
  assert.match(inputComboSelectSource, /data-component=\{dataComponent \|\| "InputComboSelect"\}/);
});

test("InputComboSelect displays unknown selected values instead of the first option", () => {
  assert.match(inputComboSelectSource, /if\s*\(!normalized\)\s*return "Select\.\.\."/);
  assert.match(inputComboSelectSource, /options\.find\(\(option\) => option\.value === normalized\)\?\.label \|\|/);
  assert.match(inputComboSelectSource, /normalized \|\|[\s\S]*"Select\.\.\."/);
});

test("Strategy editor uses one shared InputComboSelect for combo and hybrid inputs", () => {
  assert.doesNotMatch(strategyEditorSource, /ValueParamInput/);
  assert.match(strategyEditorSource, /import InputComboSelect from "\.\.\/\.\.\/\.\.\/shared\/components\/InputComboSelect"/);
  assert.match(strategyEditorSource, /<InputComboSelect[\s\S]*text=\{operandText\}/);
  assert.match(strategyEditorSource, /<InputComboSelect[\s\S]*value=\{resolveSelectValue\(indicator\?\.field/);
});

test("Strategy editor parameter catalog includes price-action params and custom keys", () => {
  assert.match(strategyEditorSource, /value:\s*"reward_rr"/);
  assert.match(strategyEditorSource, /value:\s*"stop_buffer_pct"/);
  assert.match(strategyEditorSource, /value:\s*"min_stop_pips"/);
  assert.match(strategyEditorSource, /const paramKeyCatalog = useMemo/);
  assert.match(strategyEditorSource, /Object\.keys\(draft\?\.params \|\| \{\}\)\.forEach/);
});

test("Strategy editor exposes shared cTrader trade and confluence preset combos", () => {
  assert.match(strategyEditorSource, /title="Runtime Preset"/);
  assert.match(strategyEditorSource, /section="trade_config"/);
  assert.match(strategyEditorSource, /section="confluences"/);
  assert.match(strategyEditorSource, /key: "entry", label: "Entry"/);
  assert.match(strategyEditorSource, /key: "minimum_count", label: "Min\. Confluences"/);
  assert.match(strategyEditorSource, /const TRADE_TYPES = \["Wick", "Event", "Swing"\]/);
  assert.match(strategyEditorSource, /const TRADE_TPS = \["", "R03", "R05", "R07", "R1", "R13", "R15"/);
  assert.match(strategyEditorSource, /\[timing, type, entry, tp\]\.filter\(Boolean\)\.join\("_"\)/);
  assert.doesNotMatch(strategyEditorSource, /ScalpWick|ScalpEvent/);
});

test("TradePlanEditor numeric controls render readOnly inputs and disabled nested controls", () => {
  assert.match(editorSource, /const NumericInput = memo\(function NumericInput\(\{/);
  assert.match(editorSource, /readOnly\s*=\s*false/);
  assert.match(editorSource, /const isReadOnly = readOnly;/);
  assert.match(editorSource, /readOnly=\{isReadOnly\}/);
  assert.match(editorSource, /disabled=\{sliderDisabled \|\| isReadOnly\}/);
});

test("TradePlanEditor numeric row switches to compact flex layout on mobile", () => {
  assert.match(
    editorSource,
    /import GroupButtons from "\.\.\/\.\.\/\.\.\/shared\/components\/GroupButtons"/,
  );
  assert.match(
    editorSource,
    /const AdjusterRow = memo\(function AdjusterRow\(\{/,
  );
  assert.match(
    editorSource,
    /function useCompactNumericLayout\(\)/,
  );
  assert.match(
    editorSource,
    /\[\s*\{\s*value:\s*"dec",\s*label:\s*"-"\s*\},\s*\{\s*value:\s*"inc",\s*label:\s*"\+"\s*\},\s*\]/,
  );
  assert.match(
    editorSource,
    /gridTemplateColumns:\s*"minmax\(0,\s*1fr\)\s+64px\s+minmax\(72px,\s*0\.9fr\)"/,
  );
  assert.match(
    editorSource,
    /border_type="multiple"/,
  );
  assert.match(
    editorSource,
    /const isCompactLayout = useCompactNumericLayout\(\);/,
  );
  assert.match(
    editorSource,
    /const numericControlsMobileStyle = \{\s*display:\s*"flex",[\s\S]*flexWrap:\s*"wrap"/,
  );
  assert.match(
    editorSource,
    /itemsLayout=\{compactLayout \? "row" : "column"\}/,
  );
  assert.match(
    editorSource,
    /stacked=\{isCompactLayout\}/,
  );
});

test("TradePlanEditor supports filled trades with side/type-only locking", () => {
  assert.match(
    editorSource,
    /lockMode === "core" \|\|[\s\S]*lockMode === "entry" \|\|[\s\S]*lockMode === "sideType" \|\|[\s\S]*lockMode === "all"/,
  );
  assert.match(
    editorSource,
    /const sideTypeFieldsDisabled =[\s\S]*normalizedLockMode === "sideType"/,
  );
  assert.match(
    editorSource,
    /name="direction"[\s\S]*disabled=\{sideTypeFieldsDisabled \|\| controlsDisabled\}/,
  );
  assert.match(
    editorSource,
    /name="trade_type"[\s\S]*disabled=\{sideTypeFieldsDisabled \|\| controlsDisabled\}/,
  );
  assert.match(
    editorSource,
    /label="Entry"[\s\S]*disabled=\{entryFieldDisabled\}/,
  );
});

test("TradesPage keeps detail selection pinned to route trade id during list reloads", () => {
  assert.match(
    tradesPageSource,
    /const tradeDetailRequestSeqRef = useRef\(0\);/,
  );
  assert.match(
    tradesPageSource,
    /const preferredTradeId = String\(selectedTradeIdRef\.current \|\| ""\)\.trim\(\);/,
  );
  assert.match(
    tradesPageSource,
    /if \(!tradeId && preferredTradeId\) \{/,
  );
  assert.match(
    tradesPageSource,
    /else if \(!tradeId && items\.length > 0\) \{/,
  );
  assert.match(
    tradesPageSource,
    /if \(tradeId\) \{\s*selectedTradeIdRef\.current = String\(tradeId \|\| ""\)\.trim\(\);\s*return;\s*\}/s,
  );
  assert.match(
    tradesPageSource,
    /const requestSeq = \+\+tradeDetailRequestSeqRef\.current;/,
  );
  assert.match(
    tradesPageSource,
    /if \(cancelled \|\| requestSeq !== tradeDetailRequestSeqRef\.current\) return;/,
  );
});
