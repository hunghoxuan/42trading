"use strict";

const crypto = require("crypto");

function makeId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function normalizeRole(value = "") {
  const role = String(value || "")
    .trim()
    .toLowerCase();
  if (role === "assistant" || role === "system") return role;
  return "user";
}

function extractTextFromParts(parts = []) {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text") return String(part.text || "").trim();
      if (part.type === "reasoning") return String(part.text || "").trim();
      if (part.type === "file" && part.filename) {
        return `[File attached: ${String(part.filename).trim()}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function extractMessageText(message = {}) {
  if (typeof message?.content === "string") {
    return String(message.content || "").trim();
  }
  if (Array.isArray(message?.content)) {
    return extractTextFromParts(message.content);
  }
  if (Array.isArray(message?.parts)) {
    return extractTextFromParts(message.parts);
  }
  if (typeof message?.text === "string") {
    return String(message.text || "").trim();
  }
  return "";
}

function normalizeIncomingChatMessages(messages = []) {
  const items = Array.isArray(messages) ? messages : [];
  return items
    .map((message) => ({
      role: normalizeRole(message?.role),
      content: extractMessageText(message),
    }))
    .filter((message) => message.content);
}

function chunkText(text = "", maxChars = 80) {
  const raw = String(text || "");
  if (!raw) return [];
  const limit = Math.max(12, Number(maxChars) || 80);
  const chunks = [];
  let cursor = 0;
  while (cursor < raw.length) {
    let end = Math.min(raw.length, cursor + limit);
    if (end < raw.length) {
      const nextBreak =
        raw.lastIndexOf(" ", end) > cursor + 20
          ? raw.lastIndexOf(" ", end)
          : raw.lastIndexOf("\n", end) > cursor
            ? raw.lastIndexOf("\n", end)
            : end;
      end = nextBreak > cursor ? nextBreak : end;
    }
    chunks.push(raw.slice(cursor, end));
    cursor = end;
  }
  return chunks.filter(Boolean);
}

function writeSseEvent(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function initSseResponse(response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

function beginUiMessage(response, messageId, textId) {
  writeSseEvent(response, { type: "start", messageId });
  writeSseEvent(response, { type: "text-start", id: textId });
}

function appendUiTextDelta(response, textId, delta) {
  if (!delta) return;
  writeSseEvent(response, { type: "text-delta", id: textId, delta });
}

function endUiMessage(response, textId) {
  writeSseEvent(response, { type: "text-end", id: textId });
  writeSseEvent(response, { type: "finish" });
  response.end();
}

function sendUiError(response, errorText = "Request failed.") {
  writeSseEvent(response, { type: "error", errorText: String(errorText || "") });
  writeSseEvent(response, { type: "finish" });
  response.end();
}

function buildOpenAiCompletion({
  model = "unknown",
  text = "",
  id = makeId("chatcmpl"),
}) {
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: String(model || "unknown"),
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: String(text || ""),
        },
        finish_reason: "stop",
      },
    ],
  };
}

function initOpenAiStream(response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

function writeOpenAiChunk(response, chunk) {
  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function streamOpenAiText(response, { model = "unknown", text = "", id = "" }) {
  const completionId = String(id || makeId("chatcmpl"));
  const created = Math.floor(Date.now() / 1000);
  writeOpenAiChunk(response, {
    id: completionId,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  });

  for (const delta of chunkText(text, 72)) {
    writeOpenAiChunk(response, {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
    });
  }

  writeOpenAiChunk(response, {
    id: completionId,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  response.write("data: [DONE]\n\n");
  response.end();
}

module.exports = {
  appendUiTextDelta,
  beginUiMessage,
  buildOpenAiCompletion,
  chunkText,
  endUiMessage,
  initOpenAiStream,
  initSseResponse,
  makeId,
  normalizeIncomingChatMessages,
  sendUiError,
  streamOpenAiText,
  writeSseEvent,
};
