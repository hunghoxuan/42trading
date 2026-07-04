"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { createObjectStoreRepo } = require("../../../shared/objects/objectStoreRepo");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const CHAT_OBJECT_TYPE = "chat_conversations";

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = "chat") {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function buildChatRepo(options = {}) {
  return createObjectStoreRepo({
    provider: options.provider,
    projectRoot: options.projectRoot || PROJECT_ROOT,
    dataRoot: options.dataRoot,
    sqlitePath: options.sqlitePath,
    postgresUrl: options.postgresUrl,
    pool: options.pool,
  });
}

function resolveChatRootDir(userId, { projectRoot = PROJECT_ROOT, dataRoot } = {}) {
  const repo = buildChatRepo({ projectRoot, dataRoot });
  return path.join(repo.userRootDir(userId), "chat");
}

function legacyConversationDir(userId, conversationId, options = {}) {
  const repo = buildChatRepo(options);
  return path.join(
    repo.userRootDir(userId),
    "chat",
    "conversations",
    repo.safePathPart(conversationId, "default"),
  );
}

function legacyConversationDataPath(userId, conversationId, options = {}) {
  return path.join(
    legacyConversationDir(userId, conversationId, options),
    "data.json",
  );
}

function legacyConversationMessagesDir(userId, conversationId, options = {}) {
  return path.join(
    legacyConversationDir(userId, conversationId, options),
    "messages",
  );
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
    user_id:
      String(input.user_id || fallback.user_id || "default").trim() || "default",
    mode:
      String(input.mode || fallback.mode || "ask").trim().toLowerCase() || "ask",
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

function normalizeConversationRecord(input = {}, fallback = {}) {
  const conversation = normalizeConversation(input, fallback);
  const messages = Array.isArray(input.messages)
    ? input.messages.map((item) => normalizeMessage(item, item))
    : [];
  messages.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return {
    ...conversation,
    messages,
    message_count: Math.max(conversation.message_count, messages.length),
    last_message_at:
      messages[messages.length - 1]?.created_at || conversation.last_message_at,
  };
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

async function listLegacyJsonFiles(dirPath) {
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

async function loadLegacyConversationRecord(userId, conversationId, options = {}) {
  const conversation = await readJsonSafe(
    legacyConversationDataPath(userId, conversationId, options),
    null,
  );
  if (!conversation) return null;
  const files = await listLegacyJsonFiles(
    legacyConversationMessagesDir(userId, conversationId, options),
  );
  const messages = [];
  for (const filePath of files.sort()) {
    const item = await readJsonSafe(filePath, null);
    if (item) messages.push(normalizeMessage(item, item));
  }
  return normalizeConversationRecord(
    { ...conversation, messages },
    { conversation_id: conversationId, user_id: userId },
  );
}

async function listLegacyConversationIds(userId, options = {}) {
  let entries = [];
  try {
    entries = await fsp.readdir(
      path.join(buildChatRepo(options).userRootDir(userId), "chat", "conversations"),
      { withFileTypes: true },
    );
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function removeLegacyConversationArtifacts(userId, conversationId, options = {}) {
  const dirPath = legacyConversationDir(userId, conversationId, options);
  await fsp.rm(dirPath, { recursive: true, force: true }).catch((error) => {
    if (!error || error.code !== "ENOENT") throw error;
  });
}

function createChatStore(options = {}) {
  const repo = buildChatRepo(options);

  async function getConversationRecord(userId, conversationId) {
    const safeUserId = String(userId || "default").trim() || "default";
    const safeConversationId = String(conversationId || "").trim();
    if (!safeConversationId) return null;

    const current = await repo.getObjectData(
      safeUserId,
      CHAT_OBJECT_TYPE,
      safeConversationId,
    );
    if (current && typeof current === "object") {
      return normalizeConversationRecord(current, {
        conversation_id: safeConversationId,
        user_id: safeUserId,
      });
    }

    const legacy = await loadLegacyConversationRecord(
      safeUserId,
      safeConversationId,
      options,
    );
    if (!legacy) return null;

    await repo.upsertObject(
      safeUserId,
      CHAT_OBJECT_TYPE,
      safeConversationId,
      legacy,
      "ACTIVE",
    );
    await removeLegacyConversationArtifacts(
      safeUserId,
      safeConversationId,
      options,
    );
    return legacy;
  }

  async function saveConversation(userId, input = {}) {
    const safeUserId = String(userId || "default").trim() || "default";
    const conversationId =
      String(input.conversation_id || "").trim() || makeId("conv");
    const prev = await getConversationRecord(safeUserId, conversationId);
    const row = normalizeConversationRecord(
      {
        ...(prev || {}),
        ...input,
        user_id: safeUserId,
        conversation_id: conversationId,
        messages: Array.isArray(input.messages)
          ? input.messages
          : prev?.messages || [],
      },
      prev || {},
    );
    await repo.upsertObject(
      safeUserId,
      CHAT_OBJECT_TYPE,
      conversationId,
      row,
      "ACTIVE",
    );
    return normalizeConversation(row, row);
  }

  async function listMessages(userId, conversationId) {
    const record = await getConversationRecord(userId, conversationId);
    return record ? record.messages.map((item) => normalizeMessage(item, item)) : [];
  }

  async function saveMessage(userId, conversationId, input = {}) {
    const safeUserId = String(userId || "default").trim() || "default";
    const safeConversationId =
      String(conversationId || "").trim() || makeId("conv");
    const previousConversation = await getConversationRecord(
      safeUserId,
      safeConversationId,
    );
    const row = normalizeMessage(input, input);
    const fullMessages = [
      ...((previousConversation?.messages || []).filter(
        (message) => message.message_id !== row.message_id,
      )),
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
      user_id: safeUserId,
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
      messages: fullMessages,
      message_count: fullMessages.length,
      last_message_at: row.created_at,
      updated_at: row.created_at,
    });

    return row;
  }

  async function listConversations(userId, limit = 50) {
    const safeUserId = String(userId || "default").trim() || "default";
    const currentRows = await repo.listObjectsByType(safeUserId, CHAT_OBJECT_TYPE);
    const records = currentRows
      .map((row) =>
        normalizeConversationRecord(row?.data || {}, {
          conversation_id: row?.name || row?.object_id,
          user_id: safeUserId,
        }),
      )
      .filter(Boolean);
    const seen = new Set(records.map((item) => item.conversation_id));

    for (const legacyId of await listLegacyConversationIds(safeUserId, options)) {
      if (seen.has(legacyId)) continue;
      const legacy = await loadLegacyConversationRecord(safeUserId, legacyId, options);
      if (!legacy) continue;
      records.push(legacy);
      seen.add(legacyId);
      await repo.upsertObject(safeUserId, CHAT_OBJECT_TYPE, legacyId, legacy, "ACTIVE");
      await removeLegacyConversationArtifacts(safeUserId, legacyId, options);
    }

    return records
      .map((record) => normalizeConversation(record, record))
      .sort((a, b) =>
        String(b.last_message_at || b.updated_at).localeCompare(
          String(a.last_message_at || a.updated_at),
        ),
      )
      .slice(0, Math.max(1, Number(limit) || 50));
  }

  async function getConversationWithMessages(userId, conversationId) {
    const record = await getConversationRecord(userId, conversationId);
    if (!record) return null;
    return {
      conversation: normalizeConversation(record, record),
      messages: record.messages.map((item) => normalizeMessage(item, item)),
    };
  }

  async function getConversation(userId, conversationId) {
    const record = await getConversationRecord(userId, conversationId);
    return record ? normalizeConversation(record, record) : null;
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
  CHAT_OBJECT_TYPE,
  createChatStore,
  extractMessageText,
  resolveChatRootDir,
};
