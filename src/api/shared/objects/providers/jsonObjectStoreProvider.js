"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { isPersistentLogWritesEnabled } = require("../../logWriteGate");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const DATA_ROOT = path.join(PROJECT_ROOT, "data", "users");
const OBJECT_DATA_FILE = "data.json";
const OBJECT_LOGS_DIRNAME = "logs";
const WATCHLIST_AUDIT_LOG_PATH = path.join(
  PROJECT_ROOT,
  "data",
  "logs",
  "watchlist-audit.log",
);

const writeQueues = new Map();

const OBJECT_TYPE_ALIASES = Object.freeze({
  api_key: "providers",
  provider: "providers",
});

const LEGACY_SETTINGS_TYPE_BY_OBJECT_TYPE = Object.freeze({
  cron: "cron",
  providers: "api_key",
});

function safePathPart(value, fallback = "default") {
  const raw = String(value || "").trim() || fallback;
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+$/, "_");
  return safe || fallback;
}

function resolveDataRoot(options = {}) {
  const explicitDataRoot = String(options.dataRoot || "").trim();
  if (explicitDataRoot) return explicitDataRoot;
  const envDataRoot = String(process.env.OBJECT_STORE_DATA_ROOT || "").trim();
  if (envDataRoot) return envDataRoot;
  const explicitProjectRoot = String(options.projectRoot || "").trim();
  if (explicitProjectRoot) {
    return path.join(explicitProjectRoot, "data", "users");
  }
  const envProjectRoot = String(process.env.OBJECT_STORE_PROJECT_ROOT || "").trim();
  if (envProjectRoot) {
    return path.join(envProjectRoot, "data", "users");
  }
  return DATA_ROOT;
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

function canonicalObjectType(objectType) {
  const raw = String(objectType || "objects").trim() || "objects";
  const canonical = OBJECT_TYPE_ALIASES[raw] || raw;
  return safePathPart(canonical, "objects");
}

function legacySettingsTypeForObjectType(objectType) {
  const canonicalType = canonicalObjectType(objectType);
  return LEGACY_SETTINGS_TYPE_BY_OBJECT_TYPE[canonicalType] || null;
}

function userRootDir(userId, options = {}) {
  return path.join(resolveDataRoot(options), safePathPart(userId));
}

function objectTypeDir(userId, objectType, options = {}) {
  return path.join(
    userRootDir(userId, options),
    canonicalObjectType(objectType),
  );
}

function objectDir(userId, objectType, objectId, options = {}) {
  return path.join(
    objectTypeDir(userId, objectType, options),
    safePathPart(objectId, "default"),
  );
}

function objectDataPath(userId, objectType, objectId, options = {}) {
  return path.join(
    objectDir(userId, objectType, objectId, options),
    OBJECT_DATA_FILE,
  );
}

function objectLogsDir(userId, objectType, objectId, options = {}) {
  return path.join(
    objectDir(userId, objectType, objectId, options),
    OBJECT_LOGS_DIRNAME,
  );
}

function legacySettingsDirForUser(userId, options = {}) {
  return path.join(userRootDir(userId, options), "settings");
}

function legacySettingFilePath(userId, objectType, objectId, options = {}) {
  const legacyType = legacySettingsTypeForObjectType(objectType);
  if (!legacyType) return null;
  return path.join(
    legacySettingsDirForUser(userId, options),
    safePathPart(legacyType, "settings"),
    `${safePathPart(objectId, "default")}.json`,
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

function extractWatchlistSymbols(data) {
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const watchlist = groups.find(
    (group) => String(group?.id || "").trim().toLowerCase() === "watchlist",
  );
  return [
    ...new Set(
      (Array.isArray(watchlist?.symbols) ? watchlist.symbols : [])
        .map((value) =>
          String(value || "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  ];
}

async function appendWatchlistAudit(entry) {
  if (!isPersistentLogWritesEnabled()) return;
  try {
    await ensurePrivateDir(path.dirname(WATCHLIST_AUDIT_LOG_PATH));
    await fsp.appendFile(
      WATCHLIST_AUDIT_LOG_PATH,
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );
  } catch {}
}

function queueForFile(filePath, fn) {
  const prev = writeQueues.get(filePath) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (writeQueues.get(filePath) === next) writeQueues.delete(filePath);
  });
  writeQueues.set(filePath, next);
  return next;
}

async function removeDirIfEmpty(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath);
    if (entries.length > 0) return false;
    await fsp.rmdir(dirPath);
    return true;
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTEMPTY")) return false;
    throw err;
  }
}

async function pruneEmptyDirChain(dirPaths = []) {
  for (const dirPath of dirPaths) {
    await removeDirIfEmpty(dirPath);
  }
}

function normalizeObjectRow(row = {}, fallback = {}) {
  const now = new Date().toISOString();
  const requestedUserId = fallback.user_id || fallback.userId || "default";
  const requestedType = fallback.type || fallback.object_type || "objects";
  const requestedObjectId = fallback.object_id || fallback.name || "default";
  const userId =
    String(row.user_id || row.userId || requestedUserId).trim() || "default";
  const type = canonicalObjectType(
    row.type || row.object_type || requestedType,
  );
  const objectId =
    String(row.object_id || row.name || requestedObjectId).trim() || "default";
  const name = String(row.name || objectId).trim() || objectId;
  const createdAt = normalizeDate(row.created_at || row.createdAt, now);
  const updatedAt = normalizeDate(row.updated_at || row.updatedAt, now);
  const objectData = parseJsonField(row.data) || {};
  const preserved = { ...row };
  delete preserved.id;
  delete preserved.user_id;
  delete preserved.userId;
  delete preserved.type;
  delete preserved.object_type;
  delete preserved.name;
  delete preserved.object_id;
  delete preserved.data;
  delete preserved.value;
  delete preserved.status;
  delete preserved.created_at;
  delete preserved.createdAt;
  delete preserved.updated_at;
  delete preserved.updatedAt;

  return {
    id: String(
      row.id ||
        crypto
          .createHash("sha1")
          .update(`${userId}:${type}:${objectId}`)
          .digest("hex"),
    ),
    user_id: userId,
    userId,
    type,
    object_type: type,
    name,
    object_id: objectId,
    data: objectData,
    value: row.value ?? null,
    status: String(row.status || "ACTIVE"),
    created_at: createdAt,
    createdAt,
    updated_at: updatedAt,
    updatedAt,
    ...preserved,
  };
}

async function readObjectFile(filePath, fallback = {}) {
  return normalizeObjectRow(await readJsonFile(filePath), fallback);
}

async function listJsonObjectFolders(dirPath) {
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }

  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dirPath, entry.name, OBJECT_DATA_FILE);
    try {
      const stat = await fsp.stat(full);
      if (stat.isFile()) out.push(full);
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
  }
  return out;
}

async function listUsersWithObjectType(objectType, options = {}) {
  let entries;
  try {
    entries = await fsp.readdir(resolveDataRoot(options), { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }

  const users = [];
  const objectTypeName = canonicalObjectType(objectType);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(resolveDataRoot(options), entry.name, objectTypeName);
    if (fs.existsSync(dir)) users.push(entry.name);
  }
  return users;
}

function coerceRowToObjectType(row, objectType, objectId) {
  if (!row) return null;
  return normalizeObjectRow(row, {
    type: canonicalObjectType(objectType),
    name: objectId,
  });
}

async function listObjectsByType(userId, objectType, options = {}) {
  const canonicalType = canonicalObjectType(objectType);
  const users = userId
    ? [String(userId)]
    : await listUsersWithObjectType(canonicalType, options);
  const rows = [];

  for (const uid of users) {
    const files = await listJsonObjectFolders(
      objectTypeDir(uid, canonicalType, options),
    );
    for (const file of files) {
      try {
        rows.push(
          await readObjectFile(file, {
            user_id: uid,
            type: canonicalType,
          }),
        );
      } catch (err) {
        console.warn(
          `[object-store] skipped invalid object file ${file}:`,
          err.message,
        );
      }
    }
  }

  rows.sort((a, b) =>
    `${a.user_id}:${a.type}:${a.name}`.localeCompare(
      `${b.user_id}:${b.type}:${b.name}`,
    ),
  );
  return rows;
}

async function listUsersWithLegacySettings(type, options = {}) {
  let entries;
  try {
    entries = await fsp.readdir(resolveDataRoot(options), { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }

  const users = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(
      DATA_ROOT,
      entry.name,
      "settings",
      safePathPart(type, "settings"),
    );
    if (fs.existsSync(dir)) users.push(entry.name);
  }
  return users;
}

async function listObjectsByTypeWithLegacyFallback(userId, objectType, options = {}) {
  const rows = await listObjectsByType(userId, objectType, options);
  const seen = new Set(rows.map((row) => `${row.user_id}:${row.name}`));
  const legacyType = legacySettingsTypeForObjectType(objectType);
  if (!legacyType) return rows;

  const users = userId
    ? [String(userId)]
    : await listUsersWithLegacySettings(legacyType, options);
  for (const uid of users) {
    const legacyDir = path.join(
      legacySettingsDirForUser(uid, options),
      safePathPart(legacyType, "settings"),
    );
    let entries;
    try {
      entries = await fsp.readdir(legacyDir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const objectId = entry.name.replace(/\.json$/i, "");
      const key = `${uid}:${objectId}`;
      if (seen.has(key)) continue;
      try {
        const row = await readObjectFile(path.join(legacyDir, entry.name), {
          user_id: uid,
          type: objectType,
          name: objectId,
        });
        rows.push(coerceRowToObjectType(row, objectType, objectId));
        seen.add(key);
      } catch (err) {
        console.warn(
          `[object-store] skipped invalid legacy object file ${path.join(legacyDir, entry.name)}:`,
          err.message,
        );
      }
    }
  }

  rows.sort((a, b) =>
    `${a.user_id}:${a.type}:${a.name}`.localeCompare(
      `${b.user_id}:${b.type}:${b.name}`,
    ),
  );
  return rows;
}

async function getObject(userId, objectType, objectId = "default", options = {}) {
  const filePath = objectDataPath(
    userId,
    objectType,
    objectId || "default",
    options,
  );
  try {
    return await readObjectFile(filePath, {
      user_id: userId,
      type: objectType,
      name: objectId,
    });
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function getObjectWithLegacyFallback(
  userId,
  objectType,
  objectId = "default",
  options = {},
) {
  const primary = await getObject(userId, objectType, objectId, options);
  if (primary) return primary;

  const legacyPath = legacySettingFilePath(userId, objectType, objectId, options);
  if (!legacyPath) return null;

  try {
    const legacy = await readObjectFile(legacyPath, {
      user_id: userId,
      type: objectType,
      name: objectId,
    });
    return coerceRowToObjectType(legacy, objectType, objectId);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function getObjectData(userId, objectType, objectId = "default", options = {}) {
  const row = await getObject(userId, objectType, objectId, options);
  return row ? row.data : null;
}

async function getObjectDataWithLegacyFallback(
  userId,
  objectType,
  objectId = "default",
  options = {},
) {
  const row = await getObjectWithLegacyFallback(
    userId,
    objectType,
    objectId,
    options,
  );
  return row ? row.data : null;
}

async function upsertObject(
  userId,
  objectType,
  objectId,
  data,
  status = "ACTIVE",
  meta = {},
  options = {},
) {
  const canonicalType = canonicalObjectType(objectType);
  const filePath = objectDataPath(
    userId,
    canonicalType,
    objectId || "default",
    options,
  );
  return queueForFile(filePath, async () => {
    const now = new Date().toISOString();
    let prev = null;
    try {
      prev = await readObjectFile(filePath, {
        user_id: userId,
        type: canonicalType,
        name: objectId,
      });
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }

    await ensurePrivateDir(
      objectLogsDir(userId, canonicalType, objectId || "default", options),
    );

    const row = normalizeObjectRow({
      id: meta.id || prev?.id,
      user_id: userId,
      type: canonicalType,
      name: objectId || "default",
      data,
      value: meta.value ?? prev?.value ?? null,
      status: status || prev?.status || "ACTIVE",
      created_at: meta.created_at || meta.createdAt || prev?.created_at || now,
      updated_at: meta.updated_at || meta.updatedAt || now,
    });

    if (
      canonicalType === "settings_store" &&
      String(objectId || "default").trim() === "symbol_groups:default"
    ) {
      const beforeList = extractWatchlistSymbols(prev?.data || {});
      const afterList = extractWatchlistSymbols(row?.data || {});
      const beforeSet = new Set(beforeList);
      const afterSet = new Set(afterList);
      await appendWatchlistAudit({
        t: now,
        pid: process.pid,
        user_id: String(userId || "").trim() || "default",
        object_type: canonicalType,
        object_id: String(objectId || "default"),
        file_path: filePath,
        before_count: beforeList.length,
        after_count: afterList.length,
        added: afterList.filter((symbol) => !beforeSet.has(symbol)),
        removed: beforeList.filter((symbol) => !afterSet.has(symbol)),
        before: beforeList,
        after: afterList,
        stack: String(new Error().stack || "")
          .split("\n")
          .slice(1, 8),
      });
    }

    await writeJsonAtomic(filePath, row);
    return [row];
  });
}

async function putObjectRow(row, options = {}) {
  const normalized = normalizeObjectRow(row);
  return upsertObject(
    normalized.user_id,
    normalized.type,
    normalized.name,
    normalized.data,
    normalized.status,
    normalized,
    options,
  );
}

async function deleteObject(userId, objectType, objectId = "default", options = {}) {
  const canonicalType = canonicalObjectType(objectType);
  const dirPath = objectDir(
    userId,
    canonicalType,
    objectId || "default",
    options,
  );
  return queueForFile(
    objectDataPath(userId, canonicalType, objectId || "default", options),
    async () => {
      await fsp.rm(dirPath, { recursive: true, force: true });
      await pruneEmptyDirChain([
        objectTypeDir(userId, canonicalType, options),
        userRootDir(userId, options),
      ]);
    },
  );
}

module.exports = {
  name: "json",
  kind: "file",
  DATA_ROOT,
  resolveDataRoot,
  OBJECT_DATA_FILE,
  OBJECT_LOGS_DIRNAME,
  OBJECT_TYPE_ALIASES,
  safePathPart,
  parseJsonField,
  canonicalObjectType,
  legacySettingsTypeForObjectType,
  userRootDir,
  objectTypeDir,
  objectDir,
  objectDataPath,
  objectLogsDir,
  legacySettingFilePath,
  listObjectsByType,
  listObjectsByTypeWithLegacyFallback,
  getObject,
  getObjectWithLegacyFallback,
  getObjectData,
  getObjectDataWithLegacyFallback,
  upsertObject,
  putObjectRow,
  deleteObject,
};
