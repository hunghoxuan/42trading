"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { safePathPart } = require("../objects/objectStore");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

function nowIso() {
  return new Date().toISOString();
}

function resolveChatRootDir(userId, { projectRoot = PROJECT_ROOT } = {}) {
  return path.join(
    projectRoot,
    "data",
    "users",
    safePathPart(userId || "default"),
    "chat",
  );
}

function conversationDir(userId, conversationId, options = {}) {
  return path.join(
    resolveChatRootDir(userId, options),
    "conversations",
    safePathPart(conversationId, "default"),
  );
}

function conversationDataPath(userId, conversationId, options = {}) {
  return path.join(conversationDir(userId, conversationId, options), "data.json");
}

function conversationMessagesDir(userId, conversationId, options = {}) {
  return path.join(conversationDir(userId, conversationId, options), "messages");
}

function conversationMessagePath(
  userId,
  conversationId,
  messageId,
  options = {},
) {
  return path.join(
    conversationMessagesDir(userId, conversationId, options),
    `${safePathPart(messageId, "message")}.json`,
  );
}

async function ensurePrivateDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true, mode: 0o700 });
}

async function writeJsonAtomic(filePath, value) {
  await ensurePrivateDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await fsp.writeFile(tmpPath, body, { mode: 0o600 });
  await fsp.rename(tmpPath, filePath);
}

async function readJsonSafe(filePath, fallback = null) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

function makeId(prefix = "chat") {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function extractMessageText(message = {}) {
  if (typeof message?.content === "string") {
    return String(message.content || "").trim();
  }
  const parts = Array.isArray(message?.parts)
    ? message.parts
    : Array.isArray(message?.content)
      ? message.content
      : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text") return String(part.text || "");
      if (part.type === "file" && part.filename) {
        return `[File attached: ${String(part.filename).trim()}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function normalizeConversation(input = {}, fallback = {}) {
  const createdAt = String(input.created_at || fallback.created_at || nowIso());
  const updatedAt = String(input.updated_at || fallback.updated_at || createdAt);
  const titleRaw =
    String(input.title || fallback.title || "").trim() ||
    String(input.preview || fallback.preview || "").trim() ||
    "New chat";
  return {
    conversation_id: String(
      input.conversation_id || fallback.conversation_id || makeId("conv"),
    ).trim(),
    user_id: String(input.user_id || fallback.user_id || "default").trim() || "default",
    mode: String(input.mode || fallback.mode || "ask").trim().toLowerCase() || "ask",
    route: String(input.route || fallback.route || "/").trim() || "/",
    title: titleRaw.slice(0, 120),
    preview: String(input.preview || fallback.preview || "").trim().slice(0, 280),
    created_at: createdAt,
    updated_at: updatedAt,
    last_message_at: String(
      input.last_message_at || fallback.last_message_at || updatedAt,
    ),
    codex_thread_id: String(
      input.codex_thread_id || fallback.codex_thread_id || "",
    ).trim(),
    message_count: Math.max(
      0,
      Number(input.message_count ?? fallback.message_count ?? 0) || 0,
    ),
  };
}

function normalizeMessage(input = {}, fallback = {}) {
  const createdAt = String(input.created_at || fallback.created_at || nowIso());
  const text = extractMessageText(input);
  const parts = Array.isArray(input.parts)
    ? input.parts
    : typeof input.content === "string"
      ? [{ type: "text", text: input.content }]
      : Array.isArray(input.content)
        ? input.content
        : text
          ? [{ type: "text", text }]
          : [];
  return {
    message_id: String(input.message_id || fallback.message_id || makeId("msg")).trim(),
    role:
      String(input.role || fallback.role || "user").trim().toLowerCase() ===
      "assistant"
        ? "assistant"
        : "user",
    parts,
    content: text,
    created_at: createdAt,
  };
}

async function listJsonFiles(dirPath) {
  let entries = [];
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));
}

function createChatStore(options = {}) {
  const sharedOptions = { projectRoot: options.projectRoot || PROJECT_ROOT };

  async function saveConversation(userId, input = {}) {
    const safeUserId = String(userId || "default").trim() || "default";
    const conversationId =
      String(input.conversation_id || "").trim() || makeId("conv");
    const prev = await readJsonSafe(
      conversationDataPath(safeUserId, conversationId, sharedOptions),
      null,
    );
    const row = normalizeConversation(
      {
        ...prev,
        ...input,
        user_id: safeUserId,
        conversation_id: conversationId,
      },
      prev || {},
    );
    await ensurePrivateDir(conversationMessagesDir(safeUserId, conversationId, sharedOptions));
    await writeJsonAtomic(
      conversationDataPath(safeUserId, conversationId, sharedOptions),
      row,
    );
    return row;
  }

  async function listMessages(userId, conversationId) {
    const files = await listJsonFiles(
      conversationMessagesDir(userId, conversationId, sharedOptions),
    );
    const rows = [];
    for (const filePath of files.sort()) {
      const item = await readJsonSafe(filePath, null);
      if (item) rows.push(normalizeMessage(item, item));
    }
    return rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  async function saveMessage(userId, conversationId, input = {}) {
    const safeUserId = String(userId || "default").trim() || "default";
    const safeConversationId =
      String(conversationId || "").trim() || makeId("conv");
    const previousConversation = await readJsonSafe(
      conversationDataPath(safeUserId, safeConversationId, sharedOptions),
      null,
    );
    const previousMessages = await listMessages(safeUserId, safeConversationId);
    const row = normalizeMessage(input, input);
    await ensurePrivateDir(
      conversationMessagesDir(safeUserId, safeConversationId, sharedOptions),
    );
    await writeJsonAtomic(
      conversationMessagePath(
        safeUserId,
        safeConversationId,
        row.message_id,
        sharedOptions,
      ),
      row,
    );

    const fullMessages = [
      ...previousMessages.filter((message) => message.message_id !== row.message_id),
      row,
    ].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const preview = extractMessageText(row);
    const firstUserText =
      fullMessages.find((message) => message.role === "user")?.content || preview;
    const previousTitle = String(previousConversation?.title || "").trim();
    const title =
      previousTitle && previousTitle !== "New chat"
        ? previousTitle
        : String(firstUserText || "New chat").trim().slice(0, 120);

    await saveConversation(safeUserId, {
      ...(previousConversation || {}),
      conversation_id: safeConversationId,
      mode:
        previousConversation?.mode &&
        previousConversation.mode !== input.mode &&
        input.mode &&
        previousConversation.mode !== "mixed"
          ? "mixed"
          : input.mode || previousConversation?.mode || "ask",
      route: input.route || previousConversation?.route || "/",
      title,
      preview,
      message_count: fullMessages.length,
      last_message_at: row.created_at,
      updated_at: row.created_at,
    });

    return row;
  }

  async function listConversations(userId, limit = 50) {
    const baseDir = path.join(resolveChatRootDir(userId, sharedOptions), "conversations");
    let entries = [];
    try {
      entries = await fsp.readdir(baseDir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
    const rows = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const item = await readJsonSafe(path.join(baseDir, entry.name, "data.json"), null);
      if (item) rows.push(normalizeConversation(item, item));
    }
    return rows
      .sort(
        (a, b) =>
          String(b.last_message_at || b.updated_at).localeCompare(
            String(a.last_message_at || a.updated_at),
          ),
      )
      .slice(0, Math.max(1, Number(limit) || 50));
  }

  async function getConversationWithMessages(userId, conversationId) {
    const conversation = await readJsonSafe(
      conversationDataPath(userId, conversationId, sharedOptions),
      null,
    );
    if (!conversation) return null;
    return {
      conversation: normalizeConversation(conversation, conversation),
      messages: await listMessages(userId, conversationId),
    };
  }

  async function getConversation(userId, conversationId) {
    const conversation = await readJsonSafe(
      conversationDataPath(userId, conversationId, sharedOptions),
      null,
    );
    return conversation ? normalizeConversation(conversation, conversation) : null;
  }

  return {
    getConversation,
    getConversationWithMessages,
    listConversations,
    listMessages,
    saveConversation,
    saveMessage,
  };
}

module.exports = {
  createChatStore,
  extractMessageText,
  resolveChatRootDir,
};
