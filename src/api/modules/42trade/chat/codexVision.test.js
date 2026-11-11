"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCodexVisionArgs, imageFromMessages, runCodexOpenAiVision } = require("./codexVision");

test("Codex POS vision runs read-only and attaches the capture image", () => {
  const args = buildCodexVisionArgs({
    cwd: "/tmp/pos-task", imagePath: "/tmp/pos-task/capture.jpg",
    schemaPath: "/tmp/pos-task/schema.json", outputPath: "/tmp/pos-task/output.json",
    model: "vision-model",
  });

  assert.ok(args.includes("read-only"));
  assert.ok(args.includes("never"));
  assert.ok(args.includes("--output-schema"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("/tmp/pos-task/capture.jpg"));
  assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox"));
});

test("Codex POS vision accepts the server AI gateway image format", () => {
  const image = imageFromMessages([{ role: "user", content: [
    { type: "text", text: "recognize" },
    { type: "image", source: { type: "base64", media_type: "image/webp", data: "YWJj" } },
  ] }]);
  assert.deepEqual(image, { mediaType: "image/webp", extension: ".webp", data: "YWJj" });
});

test("Codex wrapper receives an OpenAI-compatible multimodal request", async () => {
  let captured;
  const result = await runCodexOpenAiVision({ messages: [{ role: "user", content: [
    { type: "text", text: "recognize" },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "YWJj" } },
  ] }] }, {
    baseUrl: "http://codex-wrapper/v1",
    fetchImpl: async (url, init) => {
      captured = { url: String(url), body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ model: "codex-vision", choices: [{ message: { content: '{"identity_clear":false}' } }] }) };
    },
  });
  assert.equal(captured.url, "http://codex-wrapper/v1/chat/completions");
  assert.equal(captured.body.messages[0].content[1].image_url.url, "data:image/jpeg;base64,YWJj");
  assert.equal(result.modelUsed, "codex-vision");
});
