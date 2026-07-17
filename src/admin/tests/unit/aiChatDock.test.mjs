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

test("AiChatDock exposes attachment controls and preview actions", () => {
  assert.match(aiChatDockSource, /const CHAT_ATTACHMENT_ACCEPT =/);
  assert.match(aiChatDockSource, /Attach/);
  assert.match(aiChatDockSource, /Long text/);
  assert.match(aiChatDockSource, /Preview/);
  assert.match(aiChatDockSource, /Download/);
});
