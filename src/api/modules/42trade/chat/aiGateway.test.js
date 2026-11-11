const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chunkText,
  normalizeIncomingChatMessages,
  runVisionFallbackChain,
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

test("vision fallback uses the configured order and accepts the first valid structured answer", async () => {
  const calls = [];
  const result = await runVisionFallbackChain({ image: "capture" }, [
    { name: "Codex", run: async () => { calls.push("Codex"); throw new Error("offline"); } },
    { name: "Gemini", run: async () => { calls.push("Gemini"); return { rawText: "bad" }; } },
    { name: "OpenAI-compatible", run: async () => { calls.push("OpenAI-compatible"); throw new Error("API key missing"); } },
    { name: "Local Ollama", run: async () => { calls.push("Local Ollama"); return { rawText: '{"ok":true}' }; } },
  ], result => { if (result.rawText !== '{"ok":true}') throw new Error("invalid JSON"); });
  assert.deepEqual(calls, ["Codex", "Gemini", "OpenAI-compatible", "Local Ollama"]);
  assert.equal(result.provider, "Local Ollama");
});

test("vision fallback reports attempts when every provider is unavailable or invalid", async () => {
  await assert.rejects(runVisionFallbackChain({}, [
    { name: "Codex", run: async () => { throw new Error("CLI missing"); } },
    { name: "Gemini", run: async () => ({ rawText: "" }) },
    { name: "Local Ollama", run: async () => { throw new Error("model missing"); } },
  ]), /Codex: CLI missing.*Gemini: empty response.*Local Ollama: model missing/);
});
