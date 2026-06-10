"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const {
  safePathPart,
  canonicalObjectType,
  objectLogsDir,
} = require("./objectStore");

const SENSITIVE_KEY_RE =
  /key|secret|token|password|authorization|cookie|session|credential|private/i;

const OBJECT_EVENT_FILE_MAP = Object.freeze({
  cron: Object.freeze({
    TASK_FETCH: "tasks.log",
    CRON_AI_ANALYSIS: "ai_analysis.log",
    CRON_SNAPSHOT: "snapshots.log",
  }),
  providers: Object.freeze({
    API_CALL: "api_calls.log",
    API_REQUEST: "api_calls.log",
    API_RESPONSE: "api_calls.log",
    AI_API_CALL_REQUEST: "api_calls.log",
    AI_API_CALL_RESPONSE: "api_calls.log",
    CREDITS_REFRESH: "credits.log",
    CREDITS_UPDATED: "credits.log",
    CREDIT_REFRESH: "credits.log",
    CREDIT_UPDATED: "credits.log",
    AUTH_ERROR: "errors.log",
    API_ERROR: "errors.log",
    PROVIDER_ERROR: "errors.log",
    VALIDATION_ERROR: "errors.log",
  }),
});

function normalizeEventType(metadata = {}) {
  return String(metadata.event || metadata.event_type || "INFO")
    .trim()
    .toUpperCase();
}

function deriveDefaultLogFile(objectType, eventType, metadata = {}) {
  const requested = String(metadata.log_file || metadata.file || "").trim();
  if (requested) {
    const safeRequested = safePathPart(
      requested.replace(/\.log$/i, ""),
      "activity",
    );
    return `${safeRequested}.log`;
  }

  const canonicalType = canonicalObjectType(objectType);
  const typeMap = OBJECT_EVENT_FILE_MAP[canonicalType] || null;
  if (typeMap && typeMap[eventType]) {
    return typeMap[eventType];
  }

  if (canonicalType === "cron") {
    if (eventType.startsWith("CRON_SNAPSHOT_")) return "snapshots.log";
    if (eventType.startsWith("CRON_AI_")) return "ai_analysis.log";
    if (eventType.startsWith("TASK_")) return "tasks.log";
    return "activity.log";
  }

  if (canonicalType === "providers") {
    if (metadata.error || /ERROR|FAIL|AUTH|DENY|INVALID/.test(eventType)) {
      return "errors.log";
    }
    if (/CREDIT/.test(eventType)) {
      return "credits.log";
    }
    if (/API|REQUEST|RESPONSE|CALL/.test(eventType)) {
      return "api_calls.log";
    }
    return "activity.log";
  }

  return "activity.log";
}

function resolveObjectLogFilePath(userId, objectType, objectId, metadata = {}) {
  const eventType = normalizeEventType(metadata);
  const fileName = deriveDefaultLogFile(objectType, eventType, metadata);
  return path.join(
    objectLogsDir(userId, objectType, objectId),
    safePathPart(fileName.replace(/\.log$/i, ""), "activity") + ".log",
  );
}

function redactSensitiveString(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.length > 128 && /^[A-Za-z0-9+/_=-]+$/.test(trimmed)) {
    return "[REDACTED]";
  }
  return trimmed
    .replace(/Bearer\s+[A-Za-z0-9._=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(sk-[A-Za-z0-9_-]{6,}|AIza[0-9A-Za-z\-_]{10,})\b/g,
      "[REDACTED]",
    )
    .replace(/\b[A-Za-z0-9+/_=-]{40,}\b/g, "[REDACTED]");
}

function sanitizeLogValue(value, key = "") {
  if (value === undefined || value === null) return null;
  if (SENSITIVE_KEY_RE.test(String(key || ""))) return "[REDACTED]";
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, key));
  }
  if (value && typeof value === "object") {
    return sanitizeLogObject(value);
  }
  if (typeof value === "string") {
    return redactSensitiveString(value);
  }
  return value;
}

function sanitizeLogObject(value) {
  if (!value || typeof value !== "object") return value;
  const out = Array.isArray(value) ? [] : {};
  for (const [key, raw] of Object.entries(value)) {
    out[key] = sanitizeLogValue(raw, key);
  }
  return out;
}

function buildObjectLogLine(userId, objectType, objectId, metadata = {}) {
  const evt = normalizeEventType(metadata);
  const level = metadata.error
    ? "ERROR"
    : String(metadata.level || "INFO").toUpperCase();
  const iso = new Date().toISOString();
  const canonicalType = canonicalObjectType(objectType);
  const safeObjectId = String(objectId || "default").trim() || "default";
  const safeUserId = String(userId || "default").trim() || "default";
  const autoMsg = `${evt.replace(/_/g, " ").toLowerCase()}: ${safeObjectId}`;
  const message = String(metadata.message || "").trim() || autoMsg;
  const sanitizedMetadata = sanitizeLogObject(metadata);
  const extra = [
    message,
    `object_type=${canonicalType}`,
    `object_id=${safeObjectId}`,
    `user_id=${safeUserId}`,
  ];

  for (const [key, rawValue] of Object.entries(sanitizedMetadata || {})) {
    if (rawValue === undefined || rawValue === null) continue;
    if (
      key === "event" ||
      key === "event_type" ||
      key === "message" ||
      key === "level" ||
      key === "error"
    ) {
      continue;
    }
    const value =
      typeof rawValue === "object"
        ? JSON.stringify(rawValue)
        : String(rawValue);
    if (!value || value === "[object Object]") continue;
    extra.push(`${key}=${value.includes(" ") ? `\"${value}\"` : value}`);
  }

  return `[${iso}] [${level}] [${evt}] ${extra.join(", ")}\n`;
}

async function writeObjectLog(userId, objectType, objectId, metadata = {}) {
  const fullPath = resolveObjectLogFilePath(
    userId,
    objectType,
    objectId,
    metadata,
  );
  const line = buildObjectLogLine(userId, objectType, objectId, metadata);
  await fsp.mkdir(path.dirname(fullPath), { recursive: true, mode: 0o700 });
  await fsp.appendFile(fullPath, line, { encoding: "utf8", mode: 0o600 });
  return { path: fullPath, line };
}

function parseObjectLogLine(line, fallbackObjectId = null) {
  const m = String(line || "").match(
    /^\[([^\]]+)\]\s+\[(\w+)\]\s+\[(\S+)\]\s+(.*)/,
  );
  if (!m) return null;
  const [, ts, level, eventType, rest] = m;
  const objIdx = rest.indexOf("object_type=");
  const msg = objIdx > 0 ? rest.slice(0, objIdx - 2).trim() : "";
  const kvStr = objIdx > 0 ? rest.slice(objIdx) : rest;
  const payload = { level, message: msg };
  const kvRe = /(\w+)=("([^"]*)"|(\S+))/g;
  let kvMatch;
  while ((kvMatch = kvRe.exec(kvStr)) !== null) {
    payload[kvMatch[1]] = kvMatch[3] !== undefined ? kvMatch[3] : kvMatch[4];
  }
  return {
    log_id: `${ts}_${eventType}`,
    object_id: payload.object_id || fallbackObjectId,
    event_type: eventType,
    event_time: ts,
    created_at: ts,
    metadata: payload,
    payload_json: payload,
  };
}

async function listObjectLogFiles(userId, objectType, objectId) {
  const dirPath = objectLogsDir(userId, objectType, objectId);
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
    .map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  OBJECT_EVENT_FILE_MAP,
  normalizeEventType,
  deriveDefaultLogFile,
  resolveObjectLogFilePath,
  sanitizeLogObject,
  buildObjectLogLine,
  writeObjectLog,
  parseObjectLogLine,
  listObjectLogFiles,
};
