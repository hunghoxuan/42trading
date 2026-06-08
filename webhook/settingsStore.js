"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_DATA_ROOT = path.join(PROJECT_ROOT, "data");
const DATA_ROOT = path.resolve(process.env.SETTINGS_DATA_ROOT || DEFAULT_DATA_ROOT);

const writeQueues = new Map();

function safePathPart(value, fallback = "default") {
  const raw = String(value || "").trim() || fallback;
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+$/, "_");
  return safe || fallback;
}

function parseJsonField(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeDate(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : String(value);
}

function settingsDirForUser(userId) {
  return path.join(DATA_ROOT, safePathPart(userId), "settings");
}

function settingFilePath(userId, type, name) {
  return path.join(
    settingsDirForUser(userId),
    safePathPart(type, "settings"),
    `${safePathPart(name, "default")}.json`,
  );
}

async function ensurePrivateDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true, mode: 0o700 });
}

async function readJsonFile(filePath) {
  const raw = await fsp.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonAtomic(filePath, value) {
  await ensurePrivateDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await fsp.writeFile(tmpPath, body, { mode: 0o600 });
  await fsp.rename(tmpPath, filePath);
}

function queueForFile(filePath, fn) {
  const prev = writeQueues.get(filePath) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (writeQueues.get(filePath) === next) writeQueues.delete(filePath);
  });
  writeQueues.set(filePath, next);
  return next;
}

function normalizeSettingRow(row = {}) {
  const now = new Date().toISOString();
  const userId = String(row.user_id || row.userId || "default").trim() || "default";
  const type = String(row.type || "settings").trim() || "settings";
  const name = String(row.name || "default").trim() || "default";
  const createdAt = normalizeDate(row.created_at || row.createdAt, now);
  const updatedAt = normalizeDate(row.updated_at || row.updatedAt, now);
  return {
    id: String(row.id || crypto.createHash("sha1").update(`${userId}:${type}:${name}`).digest("hex")),
    user_id: userId,
    userId,
    type,
    name,
    data: parseJsonField(row.data) || {},
    value: row.value ?? null,
    status: String(row.status || "ACTIVE"),
    created_at: createdAt,
    createdAt,
    updated_at: updatedAt,
    updatedAt,
  };
}

async function readSettingFile(filePath) {
  const row = normalizeSettingRow(await readJsonFile(filePath));
  return row;
}

async function listFilesRecursive(dirPath) {
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}

async function listUsersWithSettings() {
  let entries;
  try {
    entries = await fsp.readdir(DATA_ROOT, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  const users = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(DATA_ROOT, entry.name, "settings");
    if (fs.existsSync(dir)) users.push(entry.name);
  }
  return users;
}

async function listUserSettingsByType(userId, type = null) {
  const users = userId ? [String(userId)] : await listUsersWithSettings();
  const rows = [];
  for (const uid of users) {
    const baseDir = type
      ? path.join(settingsDirForUser(uid), safePathPart(type, "settings"))
      : settingsDirForUser(uid);
    const files = await listFilesRecursive(baseDir);
    for (const file of files) {
      try {
        const row = await readSettingFile(file);
        if (type && row.type !== type) continue;
        rows.push(row);
      } catch (err) {
        console.warn(`[settings-store] skipped invalid settings file ${file}:`, err.message);
      }
    }
  }
  rows.sort((a, b) => `${a.user_id}:${a.type}:${a.name}`.localeCompare(`${b.user_id}:${b.type}:${b.name}`));
  return rows;
}

async function getUserSetting(userId, type, name = "default") {
  const filePath = settingFilePath(userId, type, name || "default");
  try {
    return await readSettingFile(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function getUserSettingData(userId, type, name = "default") {
  const row = await getUserSetting(userId, type, name);
  return row ? row.data : null;
}

async function upsertUserSetting(userId, type, name, data, status = "ACTIVE", meta = {}) {
  const filePath = settingFilePath(userId, type, name || "default");
  return queueForFile(filePath, async () => {
    const now = new Date().toISOString();
    let prev = null;
    try {
      prev = await readSettingFile(filePath);
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
    const row = normalizeSettingRow({
      id: meta.id || prev?.id,
      user_id: userId,
      type,
      name: name || "default",
      data,
      value: meta.value ?? prev?.value ?? null,
      status: status || prev?.status || "ACTIVE",
      created_at: meta.created_at || meta.createdAt || prev?.created_at || now,
      updated_at: meta.updated_at || meta.updatedAt || now,
    });
    await writeJsonAtomic(filePath, row);
    return [row];
  });
}

async function putUserSettingRow(row) {
  const normalized = normalizeSettingRow(row);
  return upsertUserSetting(
    normalized.user_id,
    normalized.type,
    normalized.name,
    normalized.data,
    normalized.status,
    normalized,
  );
}

async function deleteUserSetting(userId, type, name = "default") {
  const filePath = settingFilePath(userId, type, name || "default");
  return queueForFile(filePath, async () => {
    try {
      await fsp.unlink(filePath);
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
  });
}

module.exports = {
  DATA_ROOT,
  safePathPart,
  settingsDirForUser,
  settingFilePath,
  parseJsonField,
  listUserSettingsByType,
  getUserSetting,
  getUserSettingData,
  upsertUserSetting,
  putUserSettingRow,
  deleteUserSetting,
};
