const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chunkText,
  normalizeIncomingChatMessages,
} = require("./aiGateway");

test("normalizeIncomingChatMessages accepts AI SDK style UI messages", () => {
  const messages = normalizeIncomingChatMessages([
    {
      role: "assistant",
      parts: [{ type: "text", text: "Ready." }],
    },
    {
      role: "user",
      parts: [
        { type: "text", text: "Fix the chat route." },
        { type: "file", filename: "error.log" },
      ],
    },
  ]);

  assert.deepEqual(messages, [
    { role: "assistant", content: "Ready." },
    { role: "user", content: "Fix the chat route.\n\n[File attached: error.log]" },
  ]);
});

test("chunkText keeps the full text content when rejoined", () => {
  const text =
    "This is a longer assistant response that should be split into several chunks for streaming.";
  const chunks = chunkText(text, 20);

  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(""), text);
});
