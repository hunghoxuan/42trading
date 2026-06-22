const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFallbackTradeContextFromMessage,
  extractRawChatMessageText,
  inferRequestedSymbolFromText,
} = require("./aiChatContext");

test("extractRawChatMessageText reads text parts", () => {
  const text = extractRawChatMessageText({
    parts: [
      { type: "text", text: "Analysis and setup trade" },
      { type: "file", filename: "ignore.png" },
      { type: "text", text: "for Btcusd" },
    ],
  });

  assert.equal(text, "Analysis and setup trade\nfor Btcusd");
});

test("inferRequestedSymbolFromText normalizes mixed-case symbol mentions", () => {
  assert.equal(
    inferRequestedSymbolFromText("Analysis and setup trade for Btcusd"),
    "BTCUSD",
  );
});

test("buildFallbackTradeContextFromMessage returns inferred symbol context", () => {
  const context = buildFallbackTradeContextFromMessage({
    role: "user",
    content: "Analysis and setup trade for Btcusd",
  });

  assert.deepEqual(context, {
    symbol: "BTCUSD",
    inferred_from_user_message: true,
  });
});
