"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PRODUCT_OBSERVATION_SCHEMA, ollamaGenerateInput, runOllamaVision } = require("./ollamaVision");

test("local Ollama vision receives native base64 image messages and JSON mode", async () => {
  let captured;
  const result = await runOllamaVision({ messages: [{ role: "user", content: [
    { type: "text", text: "read the label" },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "YWJj" } },
  ] }] }, {
    baseUrl: "http://127.0.0.1:11434/", model: "qwen2.5vl:3b",
    fetchImpl: async (url, init) => {
      captured = { url: String(url), body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ model: "qwen2.5vl:3b", response: "{\"identity_clear\":false}" }) };
    },
  });
  assert.equal(captured.url, "http://127.0.0.1:11434/api/generate");
  assert.deepEqual(captured.body.images, ["YWJj"]);
  assert.equal(captured.body.prompt, "User: read the label");
  assert.deepEqual(captured.body.format, PRODUCT_OBSERVATION_SCHEMA);
  assert.equal(result.provider, "ollama");
});

test("Ollama generation input maps multimodal prompt and image", () => {
  assert.deepEqual(ollamaGenerateInput([{ role: "user", content: [
    { type: "text", text: "identify it" },
    { type: "image", source: { type: "base64", data: "eA==" } },
  ] }]), { prompt: "User: identify it", images: ["eA=="] });
});
