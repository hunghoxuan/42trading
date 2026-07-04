import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const aiChatDockSource = readFileSync(
  new URL("../../modules/42trade/components/AiChatDock.jsx", import.meta.url),
  "utf8",
);

test("AiChatDock defaults the chat mode selector to Codex", () => {
  assert.match(
    aiChatDockSource,
    /const \[selectedMode,\s*setSelectedMode\] = useState\("codex"\);/,
  );
});
