"use strict";

const PRODUCT_OBSERVATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["product_count", "identity_clear", "object_name", "product_name", "brand", "variant", "size", "barcode", "texts", "colors", "visible_price"],
  properties: {
    product_count: { type: "integer", minimum: 0 },
    identity_clear: { type: "boolean" },
    object_name: { type: "string", maxLength: 250 },
    product_name: { type: "string", maxLength: 250 },
    brand: { type: "string", maxLength: 250 },
    variant: { type: "string", maxLength: 250 },
    size: { type: "string", maxLength: 250 },
    barcode: { type: "string", maxLength: 250 },
    texts: { type: "array", maxItems: 100, items: { type: "string", maxLength: 500 } },
    colors: { type: "array", maxItems: 12, items: { type: "string", maxLength: 30 } },
    visible_price: { anyOf: [
      { type: "null" },
      { type: "object", additionalProperties: false, required: ["text", "amount", "currency"], properties: {
        text: { type: "string", maxLength: 150 }, amount: { type: ["number", "null"], minimum: 0 },
        currency: { type: ["string", "null"], pattern: "^[A-Z]{3}$" },
      } },
    ] },
  },
};

function ollamaGenerateInput(messages = []) {
  const prompt = [];
  const images = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const text = [];
    for (const part of Array.isArray(message?.content) ? message.content : []) {
      if (part?.type === "text" && String(part.text || "").trim()) text.push(String(part.text).trim());
      if (part?.type === "image" && part?.source?.type === "base64" && part.source.data) {
        images.push(String(part.source.data));
      }
    }
    if (text.length) prompt.push(`${message?.role === "assistant" ? "Assistant" : "User"}: ${text.join("\n\n")}`);
  }
  return { prompt: prompt.join("\n\n"), images };
}

async function runOllamaVision(request, options = {}) {
  const baseUrl = String(options.baseUrl || process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/api/generate`);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Ollama vision endpoint must use HTTP or HTTPS");
  const model = String(options.model || process.env.POS_OLLAMA_VISION_MODEL || "qwen2.5vl:3b").trim();
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || Math.max(90000, Number(request?.timeoutMs || 0))));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const input = ollamaGenerateInput(request?.messages);
    const response = await (options.fetchImpl || fetch)(url, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        ...input,
        stream: false,
        format: PRODUCT_OBSERVATION_SCHEMA,
        options: { temperature: 0, num_predict: Number(request?.maxTokens || 2000) },
      }),
    });
    if (!response.ok) throw new Error(`Ollama vision failed (${response.status}): ${(await response.text()).slice(0, 400)}`);
    const json = await response.json();
    const rawText = String(json?.response || "").trim();
    if (!rawText) throw new Error("Ollama vision returned an empty response");
    return { rawText, modelUsed: json?.model || model, provider: "ollama" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { PRODUCT_OBSERVATION_SCHEMA, ollamaGenerateInput, runOllamaVision };
