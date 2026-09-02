"use strict";

const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const objectStore = require("../../../shared/objects/objectStoreRepo");
const {
  parseObjectLogLine,
  buildObjectLogLine,
  resolveObjectLogFilePath,
} = require("../../../shared/objects/objectLogService");
const { safePathPart } = objectStore;

const PROJECT_ROOT = path.resolve(
  String(process.env.OBJECT_STORE_PROJECT_ROOT || "").trim() ||
    path.join(__dirname, "..", "..", ".."),
);
const DATA_ROOT = path.join(
  String(process.env.OBJECT_STORE_DATA_ROOT || "").trim() ||
    path.join(PROJECT_ROOT, "data", "users"),
);
const GLOBAL_CRON_LOG_DIR = path.join(PROJECT_ROOT, "data", "logs", "CRON");
const SETTINGS_OBJECT_TYPE = "settings_store";

const writeQueues = new Map();
const migrationPromises = new Map();
const ROOT_FLAT_SETTINGS = new Map([
  ["notification_config:preferences", "notification.json"],
  ["settings:ANALYSE_SETTINGS", "analyse.json"],
  ["system_config:enabled_log_prefixes", "log_prefixes.json"],
  ["system_config:write_logs", "write_logs.json"],
  ["execution_profile:default", "execution_profile.json"],
  ["symbol_groups:default", "symbol_groups.json"],
]);
const ROOT_FLAT_SETTINGS_BY_FILE = new Map(
  [...ROOT_FLAT_SETTINGS.entries()].map(([key, file]) => [file, key]),
);

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

function rootFlatSettingFileName(type, name) {
  const t = String(type || "").trim();
  const n = String(name || "default").trim() || "default";
  if (t.toLowerCase() === "notification_config") {
    return ROOT_FLAT_SETTINGS.get("notification_config:preferences") || null;
  }
  return ROOT_FLAT_SETTINGS.get(`${t}:${n}`) || null;
}

function isRootFlatSetting(type, name) {
  return Boolean(rootFlatSettingFileName(type, name));
}

function settingFilePath(userId, type, name) {
  const rootFile = rootFlatSettingFileName(type, name);
  if (rootFile) {
    return path.join(settingsDirForUser(userId), rootFile);
  }
  return path.join(
    settingsDirForUser(userId),
    safePathPart(type, "settings"),
    `${safePathPart(name, "default")}.json`,
  );
}

function legacySettingFilePaths(userId, type, name) {
  const t = String(type || "").trim();
  const n = String(name || "default").trim() || "default";
  const paths = [];
  if (t.toLowerCase() === "notification_config") {
    paths.push(
      path.join(settingsDirForUser(userId), "Notification_config.json"),
      path.join(
        settingsDirForUser(userId),
        "notification_config",
        "Notification_config.json",
      ),
    );
    return paths;
  }
  if (t === "settings" && n === "ANALYSE_SETTINGS") {
    paths.push(
      path.join(settingsDirForUser(userId), "ANALYSE_SETTINGS.json"),
      path.join(
        settingsDirForUser(userId),
        "settings",
        "ANALYSE_SETTINGS.json",
      ),
    );
  }
  if (t === "system_config" && n === "enabled_log_prefixes") {
    paths.push(
      path.join(settingsDirForUser(userId), "enabled_log_prefixes.json"),
      path.join(
        settingsDirForUser(userId),
        "system_config",
        "enabled_log_prefixes.json",
      ),
    );
  }
  if (t === "execution_profile" && n === "default") {
    paths.push(
      path.join(
        settingsDirForUser(userId),
        "execution_profile",
        "default.json",
      ),
    );
  }
  if (isRootFlatSetting(t, n)) {
    paths.push(
      path.join(
        settingsDirForUser(userId),
        safePathPart(t, "settings"),
        `${safePathPart(n, "default")}.json`,
      ),
    );
  }
  return [...new Set(paths.filter(Boolean))];
}

function notificationConfigDirForUser(userId) {
  return path.join(settingsDirForUser(userId), "notification_config");
}

function isCronObjectSetting(type) {
  return (
    String(type || "")
      .trim()
      .toLowerCase() === "cron"
  );
}

function isNotificationConfigSetting(type) {
  return (
    String(type || "")
      .trim()
      .toLowerCase() === "notification_config"
  );
}

const PROVIDER_SETTING_NAME_ALIASES = Object.freeze({
  GEMINI: "GEMINI_API_KEY",
  GOOGLE_GEMINI: "GEMINI_API_KEY",
  OPENAI: "OPENAI_API_KEY",
  DEEPSEEK: "DEEPSEEK_API_KEY",
  CLAUDE: "CLAUDE_API_KEY",
  ANTHROPIC: "CLAUDE_API_KEY",
  OPENROUTER: "OPENROUTER_API_KEY",
  OLLAMA: "OLLAMA_API_KEY",
  OLLAMA_LOCAL: "OLLAMA_API_KEY",
  OLLAMA_API_KEY: "OLLAMA_API_KEY",
  TWELVEDATA: "TWELVE_DATA_API_KEY",
  TWELVE_DATA: "TWELVE_DATA_API_KEY",
  TWELVE: "TWELVE_DATA_API_KEY",
});

function normalizeProviderSettingName(name = "default") {
  const raw = String(name || "default")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (!raw || raw === "DEFAULT") return "default";
  return PROVIDER_SETTING_NAME_ALIASES[raw] || raw;
}

function providerObjectIdFromSettingName(name = "default") {
  const normalized = normalizeProviderSettingName(name);
  if (normalized === "default") return normalized;
  return normalized.replace(/_API_KEY$/i, "");
}

function providerSettingNameFromObjectId(objectId = "default") {
  const normalized = normalizeProviderSettingName(objectId);
  if (normalized === "default") return normalized;
  return normalized.endsWith("_API_KEY") ? normalized : `${normalized}_API_KEY`;
}

function isProviderObjectSetting(type, name = "default") {
  return (
    String(type || "")
      .trim()
      .toLowerCase() === "api_key" &&
    normalizeProviderSettingName(name) !== "default"
  );
}

function isExecutionProfileRootSetting(type, name = "default") {
  return (
    String(type || "")
      .trim()
      .toLowerCase() === "execution_profile" &&
    String(name || "default")
      .trim()
      .toLowerCase() === "default"
  );
}

function genericSettingObjectId(type, name = "default") {
  return `${String(type || "").trim() || "settings"}:${String(
    name || "default",
  ).trim() || "default"}`;
}

function parseGenericSettingObjectId(objectId = "") {
  const raw = String(objectId || "").trim();
  const idx = raw.indexOf(":");
  if (idx < 0) {
    return {
      type: raw || "settings",
      name: "default",
    };
  }
  return {
    type: raw.slice(0, idx) || "settings",
    name: raw.slice(idx + 1) || "default",
  };
}

function coerceCronObjectRowToSettingRow(row) {
  if (!row) return null;
  return normalizeSettingRow({
    ...row,
    type: "cron",
    object_type: undefined,
    object_id: undefined,
    name: row.name || row.object_id || "default",
  });
}

function coerceProviderObjectRowToSettingRow(row) {
  if (!row) return null;
  return normalizeSettingRow({
    ...row,
    type: "api_key",
    object_type: undefined,
    object_id: undefined,
    name: providerSettingNameFromObjectId(
      row.name || row.object_id || "default",
    ),
  });
}

function coerceGenericSettingObjectRowToSettingRow(row) {
  if (!row) return null;
  const parsed = parseGenericSettingObjectId(row.name || row.object_id || "");
  return normalizeSettingRow({
    ...row,
    type: parsed.type,
    object_type: undefined,
    name: parsed.name,
    object_id: undefined,
  });
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

async function removeDirIfEmpty(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath);
    if (entries.length > 0) return false;
    await fsp.rmdir(dirPath);
    return true;
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTEMPTY"))
      return false;
    throw err;
  }
}

async function pruneEmptyDirChain(dirPaths = []) {
  for (const dirPath of dirPaths) {
    await removeDirIfEmpty(dirPath);
  }
}

async function removeDirRecursiveIfExists(dirPath) {
  await fsp.rm(dirPath, { recursive: true, force: true }).catch((err) => {
    if (!err || err.code !== "ENOENT") throw err;
  });
}

async function removeLegacySettingFiles(userId, type, name = "default") {
  const filePath = settingFilePath(userId, type, name || "default");
  const legacyPaths = [
    filePath,
    ...legacySettingFilePaths(userId, type, name || "default").filter(
      (p) => p && p !== filePath,
    ),
  ].filter(Boolean);
  for (const legacyPath of legacyPaths) {
    await fsp.unlink(legacyPath).catch((err) => {
      if (!err || err.code !== "ENOENT") throw err;
    });
  }
  const uniqueDirs = [...new Set(legacyPaths.map((legacyPath) => path.dirname(legacyPath)))];
  await pruneEmptyDirChain(uniqueDirs);
}

async function ensureFlattenedSettingMigration(userId, type, name) {
  const currentPath = settingFilePath(userId, type, name);
  const legacyPaths = legacySettingFilePaths(userId, type, name).filter(
    (p) => p && p !== currentPath,
  );
  if (!legacyPaths.length) return;

  let currentExists = false;
  try {
    await fsp.access(currentPath);
    currentExists = true;
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }

  for (const legacyPath of legacyPaths) {
    let legacyExists = false;
    try {
      await fsp.access(legacyPath);
      legacyExists = true;
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
    if (!legacyExists) continue;

    if (!currentExists) {
      const legacyValue = await readJsonFile(legacyPath);
      await writeJsonAtomic(currentPath, extractStoredSettingData(legacyValue));
      currentExists = true;
    }

    await fsp.unlink(legacyPath).catch((err) => {
      if (!err || err.code !== "ENOENT") throw err;
    });
    await pruneEmptyDirChain([path.dirname(legacyPath)]);
  }
}

function queueForFile(filePath, fn) {
  const prev = writeQueues.get(filePath) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (writeQueues.get(filePath) === next) writeQueues.delete(filePath);
  });
  writeQueues.set(filePath, next);
  return next;
}

function inferSettingMetaFromPath(filePath) {
  const relative = path.relative(DATA_ROOT, filePath);
  const parts = relative.split(path.sep).filter(Boolean);
  const userId = String(parts[0] || "default").trim() || "default";
  const fileName = String(parts[parts.length - 1] || "").trim();
  const rootKey = ROOT_FLAT_SETTINGS_BY_FILE.get(fileName);
  if (rootKey) {
    const [type, name] = rootKey.split(":");
    return { user_id: userId, userId, type, name };
  }
  const settingsIndex = parts.indexOf("settings");
  if (settingsIndex >= 0 && parts.length >= settingsIndex + 3) {
    const type =
      String(parts[settingsIndex + 1] || "settings").trim() || "settings";
    const name =
      String(fileName.replace(/\.json$/i, "") || "default").trim() || "default";
    return { user_id: userId, userId, type, name };
  }
  return { user_id: userId, userId, type: "settings", name: "default" };
}

function hasStoredSettingEnvelope(raw) {
  return Boolean(
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (Object.prototype.hasOwnProperty.call(raw, "data") ||
      Object.prototype.hasOwnProperty.call(raw, "type") ||
      Object.prototype.hasOwnProperty.call(raw, "name") ||
      Object.prototype.hasOwnProperty.call(raw, "status") ||
      Object.prototype.hasOwnProperty.call(raw, "value")),
  );
}

function extractStoredSettingData(raw) {
  if (hasStoredSettingEnvelope(raw)) {
    const parsedData = parseJsonField(raw.data);
    if (
      parsedData !== null &&
      parsedData !== undefined &&
      (!(typeof parsedData === "object" && !Array.isArray(parsedData)) ||
        Object.keys(parsedData || {}).length > 0)
    ) {
      return parsedData;
    }
    if (raw.value !== undefined && raw.value !== null) {
      const parsed = parseJsonField(raw.value);
      if (parsed && typeof parsed === "object") return parsed;
      return { value: raw.value };
    }
    return parsedData || {};
  }
  return parseJsonField(raw) || {};
}

function normalizeSettingRow(row = {}, meta = {}) {
  const now = new Date().toISOString();
  const userId =
    String(
      meta.user_id || meta.userId || row.user_id || row.userId || "default",
    ).trim() || "default";
  const type = String(meta.type || row.type || "settings").trim() || "settings";
  const name = String(meta.name || row.name || "default").trim() || "default";
  const createdAt = normalizeDate(row.created_at || row.createdAt, now);
  const updatedAt = normalizeDate(row.updated_at || row.updatedAt, now);
  return {
    id: String(
      row.id ||
        crypto
          .createHash("sha1")
          .update(`${userId}:${type}:${name}`)
          .digest("hex"),
    ),
    user_id: userId,
    userId,
    type,
    name,
    data: extractStoredSettingData(row),
    value: row.value ?? null,
    status: String(row.status || "ACTIVE"),
    created_at: createdAt,
    createdAt,
    updated_at: updatedAt,
    updatedAt,
  };
}

async function readSettingFile(filePath) {
  const raw = await readJsonFile(filePath);
  const meta = inferSettingMetaFromPath(filePath);
  const row = normalizeSettingRow(raw, meta);
  return row;
}

async function readNotificationConfigMap(userId) {
  const existingRow = await objectStore.getObject(
    userId,
    SETTINGS_OBJECT_TYPE,
    genericSettingObjectId("notification_config", "preferences"),
  );
  if (
    existingRow?.data &&
    typeof existingRow.data === "object" &&
    !Array.isArray(existingRow.data)
  ) {
    return existingRow.data;
  }
  return {};
}

function notificationConfigRow(userId, name, data, meta = {}) {
  const now = new Date().toISOString();
  return normalizeSettingRow({
    id:
      meta.id ||
      crypto
        .createHash("sha1")
        .update(`${userId}:notification_config:${name}`)
        .digest("hex"),
    user_id: userId,
    type: "notification_config",
    name,
    data,
    value: meta.value ?? null,
    status: meta.status || "ACTIVE",
    created_at: meta.created_at || meta.createdAt || now,
    updated_at: meta.updated_at || meta.updatedAt || now,
  });
}

async function listNotificationConfigRows(userId) {
  const merged = await readNotificationConfigMap(userId);
  return Object.entries(merged)
    .map(([name, data]) => notificationConfigRow(userId, name, data))
    .sort((a, b) =>
      `${a.user_id}:${a.type}:${a.name}`.localeCompare(
        `${b.user_id}:${b.type}:${b.name}`,
      ),
    );
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

async function migrateLegacySettingsDirForUser(userId) {
  const settingsDir = settingsDirForUser(userId);
  let exists = true;
  try {
    await fsp.access(settingsDir);
  } catch (err) {
    if (err && err.code === "ENOENT") exists = false;
    else throw err;
  }
  if (!exists) return { migrated: 0, removed: 0 };

  const files = await listFilesRecursive(settingsDir);
  if (!files.length) {
    await removeDirRecursiveIfExists(settingsDir);
    await pruneEmptyDirChain([path.join(DATA_ROOT, safePathPart(userId))]);
    return { migrated: 0, removed: 0 };
  }

  let migrated = 0;
  const notificationMap = {};
  for (const file of files) {
    const row = await readSettingFile(file);
    if (!row) continue;
    if (row.type === "notification_config") {
      notificationMap[row.name] = row.data;
      migrated += 1;
      continue;
    }
    if (row.type === "cron") {
      await objectStore.putObjectRow({
        ...row,
        type: "cron",
        object_type: "cron",
        name: row.name || "default",
        object_id: row.name || "default",
      });
      migrated += 1;
      continue;
    }
    if (String(row.type || "").trim().toLowerCase() === "api_key") {
      const providerObjectId = providerObjectIdFromSettingName(row.name || "default");
      await objectStore.putObjectRow({
        ...row,
        type: "providers",
        object_type: "providers",
        name: providerObjectId,
        object_id: providerObjectId,
      });
      migrated += 1;
      continue;
    }
    const objectId = genericSettingObjectId(row.type, row.name || "default");
    await objectStore.putObjectRow({
      ...row,
      type: SETTINGS_OBJECT_TYPE,
      object_type: SETTINGS_OBJECT_TYPE,
      name: objectId,
      object_id: objectId,
    });
    migrated += 1;
  }

  if (Object.keys(notificationMap).length > 0) {
    const objectId = genericSettingObjectId("notification_config", "preferences");
    await objectStore.upsertObject(
      userId,
      SETTINGS_OBJECT_TYPE,
      objectId,
      notificationMap,
      "ACTIVE",
      {
        type: SETTINGS_OBJECT_TYPE,
        object_type: SETTINGS_OBJECT_TYPE,
        name: objectId,
        object_id: objectId,
      },
    );
  }

  await removeDirRecursiveIfExists(settingsDir);
  await pruneEmptyDirChain([path.join(DATA_ROOT, safePathPart(userId))]);
  return { migrated, removed: files.length };
}

async function ensureSettingsMigrated(userId = null) {
  const key = userId ? String(userId) : "__all__";
  if (migrationPromises.has(key)) return migrationPromises.get(key);
  const work = (async () => {
    if (userId) {
      await migrateLegacySettingsDirForUser(userId);
      return;
    }
    const users = await listUsersWithSettings();
    for (const uid of users) {
      await migrateLegacySettingsDirForUser(uid);
    }
  })().finally(() => {
    migrationPromises.delete(key);
  });
  migrationPromises.set(key, work);
  return work;
}

async function listUserSettingsByType(userId, type = null) {
  await ensureSettingsMigrated(userId || null);
  if (isNotificationConfigSetting(type)) {
    return listNotificationConfigRows(userId);
  }

  if (isCronObjectSetting(type)) {
    const rows = await objectStore.listObjectsByTypeWithLegacyFallback(
      userId,
      "cron",
    );
    return rows
      .map(coerceCronObjectRowToSettingRow)
      .sort((a, b) =>
        `${a.user_id}:${a.type}:${a.name}`.localeCompare(
          `${b.user_id}:${b.type}:${b.name}`,
        ),
      );
  }

  if (
    String(type || "")
      .trim()
      .toLowerCase() === "api_key"
  ) {
    const rows = await objectStore.listObjectsByTypeWithLegacyFallback(
      userId,
      "providers",
    );
    return rows.map(coerceProviderObjectRowToSettingRow).sort((a, b) =>
      `${a.user_id}:${a.type}:${a.name}`.localeCompare(
        `${b.user_id}:${b.type}:${b.name}`,
      ),
    );
  }

  const genericRows = (
    await objectStore.listObjectsByType(userId, SETTINGS_OBJECT_TYPE)
  ).map(coerceGenericSettingObjectRowToSettingRow);
  const rows = genericRows.filter((row) => {
    if (!row) return false;
    if (row.type === "notification_config") return false;
    return type ? row.type === type : true;
  });

  if (type === null) {
    const [cronRows, providerRows] = await Promise.all([
      objectStore.listObjectsByTypeWithLegacyFallback(userId, "cron"),
      objectStore.listObjectsByTypeWithLegacyFallback(userId, "providers"),
    ]);
    rows.push(...cronRows.map(coerceCronObjectRowToSettingRow));
    rows.push(...providerRows.map(coerceProviderObjectRowToSettingRow));
  }

  rows.sort((a, b) =>
    `${a.user_id}:${a.type}:${a.name}`.localeCompare(
      `${b.user_id}:${b.type}:${b.name}`,
    ),
  );
  return rows;
}

async function getUserSetting(userId, type, name = "default") {
  await ensureSettingsMigrated(userId);
  if (isNotificationConfigSetting(type)) {
    const map = await readNotificationConfigMap(userId);
    const key = String(name || "preferences").trim() || "preferences";
    return notificationConfigRow(
      userId,
      key,
      key === "preferences" ? map : map[key] || {},
    );
  }

  if (isCronObjectSetting(type)) {
    const row = await objectStore.getObject(
      userId,
      "cron",
      name || "default",
    );
    return coerceCronObjectRowToSettingRow(row);
  }

  if (isProviderObjectSetting(type, name)) {
    const row = await getProviderObjectSetting(userId, name || "default");
    return coerceProviderObjectRowToSettingRow(row);
  }

  const objectId = genericSettingObjectId(type, name || "default");
  const row = await objectStore.getObject(userId, SETTINGS_OBJECT_TYPE, objectId);
  if (row) {
    await removeLegacySettingFiles(userId, type, name || "default").catch(() => {});
    return coerceGenericSettingObjectRowToSettingRow(row);
  }

  return null;
}

async function getProviderObjectSetting(userId, name = "default") {
  const objectId = providerObjectIdFromSettingName(name);
  const lookupIds = [
    ...new Set([
      objectId,
      normalizeProviderSettingName(name),
      String(name || "default").trim() || "default",
    ]),
  ].filter((id) => id && id !== "default");
  for (const lookupId of lookupIds) {
    const row = await objectStore.getObject(
      userId,
      "providers",
      lookupId,
    );
    if (row) return row;
  }
  return null;
}

async function getUserSettingData(userId, type, name = "default") {
  const row = await getUserSetting(userId, type, name);
  return row ? row.data : null;
}

async function upsertUserSetting(
  userId,
  type,
  name,
  data,
  status = "ACTIVE",
  meta = {},
) {
  await ensureSettingsMigrated(userId);
  if (isNotificationConfigSetting(type)) {
    const objectId = genericSettingObjectId("notification_config", "preferences");
    const eventKey = String(name || "preferences").trim() || "preferences";
    return queueForFile(objectId, async () => {
      const current = await readNotificationConfigMap(userId);
      const next =
        eventKey === "preferences" &&
        data &&
        typeof data === "object" &&
        !Array.isArray(data)
          ? { ...data }
          : { ...current, [eventKey]: data };
      await objectStore.upsertObject(
        userId,
        SETTINGS_OBJECT_TYPE,
        objectId,
        next,
        status,
        {
          ...meta,
          type: SETTINGS_OBJECT_TYPE,
          object_type: SETTINGS_OBJECT_TYPE,
          name: objectId,
          object_id: objectId,
        },
      );
      return [
        notificationConfigRow(userId, eventKey, next[eventKey] ?? data, {
          ...meta,
          status: status || meta.status || "ACTIVE",
        }),
      ];
    });
  }

  if (isCronObjectSetting(type)) {
    const result = await objectStore.upsertObject(
      userId,
      "cron",
      name || "default",
      data,
      status,
      {
        ...meta,
        type: "cron",
        object_type: "cron",
        name: name || "default",
        object_id: name || "default",
      },
    );
    return result.map(coerceCronObjectRowToSettingRow);
  }

  if (isProviderObjectSetting(type, name)) {
    const providerObjectId = providerObjectIdFromSettingName(name || "default");
    const result = await objectStore.upsertObject(
      userId,
      "providers",
      providerObjectId,
      data,
      status,
      {
        ...meta,
        type: "providers",
        object_type: "providers",
        name: providerObjectId,
        object_id: providerObjectId,
      },
    );
    const legacyObjectId = normalizeProviderSettingName(name || "default");
    if (legacyObjectId !== providerObjectId) {
      await objectStore.deleteObject(userId, "providers", legacyObjectId);
    }
    return result.map(coerceProviderObjectRowToSettingRow);
  }

  const objectId = genericSettingObjectId(type, name || "default");
  const prev = await getUserSetting(userId, type, name || "default");
  const now = new Date().toISOString();
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
  const result = await objectStore.upsertObject(
    userId,
    SETTINGS_OBJECT_TYPE,
    objectId,
    row.data,
    row.status,
    {
      ...row,
      type: SETTINGS_OBJECT_TYPE,
      object_type: SETTINGS_OBJECT_TYPE,
      name: objectId,
      object_id: objectId,
    },
  );
  await removeLegacySettingFiles(userId, type, name || "default");
  return result.map(coerceGenericSettingObjectRowToSettingRow);
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
  await ensureSettingsMigrated(userId);
  if (isNotificationConfigSetting(type)) {
    const objectId = genericSettingObjectId("notification_config", "preferences");
    return queueForFile(objectId, async () => {
      const current = await readNotificationConfigMap(userId);
      const key = String(name || "preferences").trim() || "preferences";
      if (key === "preferences") {
        await objectStore.deleteObject(userId, SETTINGS_OBJECT_TYPE, objectId);
        const legacyPaths = legacySettingFilePaths(userId, type, key).filter(
          Boolean,
        );
        for (const legacyPath of legacyPaths) {
          await fsp.unlink(legacyPath).catch((err) => {
            if (!err || err.code !== "ENOENT") throw err;
          });
          await pruneEmptyDirChain([path.dirname(legacyPath)]);
        }
        return;
      }
      if (!current || !Object.prototype.hasOwnProperty.call(current, key)) {
        return;
      }
      const next = { ...current };
      delete next[key];
      if (Object.keys(next).length === 0) {
        await objectStore.deleteObject(userId, SETTINGS_OBJECT_TYPE, objectId);
      } else {
        await objectStore.upsertObject(
          userId,
          SETTINGS_OBJECT_TYPE,
          objectId,
          next,
          "ACTIVE",
          {
            type: SETTINGS_OBJECT_TYPE,
            object_type: SETTINGS_OBJECT_TYPE,
            name: objectId,
            object_id: objectId,
          },
        );
      }
    });
  }

  if (isCronObjectSetting(type)) {
    return objectStore.deleteObject(userId, "cron", name || "default");
  }

  if (isProviderObjectSetting(type, name)) {
    const providerObjectId = providerObjectIdFromSettingName(name || "default");
    const legacyObjectId = normalizeProviderSettingName(name || "default");
    await objectStore.deleteObject(userId, "providers", providerObjectId);
    if (legacyObjectId !== providerObjectId) {
      await objectStore.deleteObject(userId, "providers", legacyObjectId);
    }
    return;
  }

  const filePath = settingFilePath(userId, type, name || "default");
  const legacyPaths = legacySettingFilePaths(
    userId,
    type,
    name || "default",
  ).filter((p) => p && p !== filePath);
  return queueForFile(filePath, async () => {
    await objectStore.deleteObject(
      userId,
      SETTINGS_OBJECT_TYPE,
      genericSettingObjectId(type, name || "default"),
    );
    try {
      await fsp.unlink(filePath);
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
    for (const legacyPath of legacyPaths) {
      await fsp.unlink(legacyPath).catch((err) => {
        if (!err || err.code !== "ENOENT") throw err;
      });
      await pruneEmptyDirChain([path.dirname(legacyPath)]);
    }
  });
}

async function mergeCronLegacyLogIntoObject(userId, cronName) {
  const legacyPath = path.join(
    GLOBAL_CRON_LOG_DIR,
    `${safePathPart(cronName, "default")}.log`,
  );
  try {
    await fsp.access(legacyPath);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { migratedFiles: 0, migratedLines: 0, removedLegacyLogs: 0 };
    }
    throw err;
  }

  const raw = await fsp.readFile(legacyPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    await fsp.unlink(legacyPath).catch((err) => {
      if (!err || err.code !== "ENOENT") throw err;
    });
    return { migratedFiles: 0, migratedLines: 0, removedLegacyLogs: 1 };
  }

  const targetFileLines = new Map();
  for (const line of lines) {
    const parsed = parseObjectLogLine(line, cronName);
    let targetPath = "";
    let normalizedLine = line;

    if (parsed) {
      const parsedMeta =
        parsed.metadata && typeof parsed.metadata === "object"
          ? { ...parsed.metadata }
          : {};
      const level = String(parsedMeta.level || "INFO").toUpperCase();
      const message = String(parsedMeta.message || "").trim();
      delete parsedMeta.level;
      delete parsedMeta.message;
      delete parsedMeta.object_type;
      delete parsedMeta.object_id;
      delete parsedMeta.user_id;

      const logMetadata = {
        ...parsedMeta,
        event: parsed.event_type,
        level,
        message,
        cron_name: cronName,
      };
      targetPath = resolveObjectLogFilePath(
        userId,
        "cron",
        cronName,
        logMetadata,
      );
      normalizedLine = buildObjectLogLine(
        userId,
        "cron",
        cronName,
        logMetadata,
      ).trimEnd();
    } else {
      targetPath = resolveObjectLogFilePath(userId, "cron", cronName, {
        event: "INFO",
        cron_name: cronName,
      });
    }

    if (!targetFileLines.has(targetPath))
      targetFileLines.set(targetPath, new Set());
    targetFileLines.get(targetPath).add(normalizedLine);
  }

  let migratedFiles = 0;
  let migratedLines = 0;
  for (const [targetPath, nextLines] of targetFileLines.entries()) {
    let existingLines = [];
    try {
      existingLines = (await fsp.readFile(targetPath, "utf8"))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }

    const merged = new Set(existingLines);
    for (const line of nextLines) merged.add(line);
    const sortedLines = [...merged].sort();
    await ensurePrivateDir(path.dirname(targetPath));
    await fsp.writeFile(targetPath, `${sortedLines.join("\n")}\n`, {
      mode: 0o600,
    });
    migratedFiles += 1;
    migratedLines += nextLines.size;
  }

  await fsp.unlink(legacyPath).catch((err) => {
    if (!err || err.code !== "ENOENT") throw err;
  });

  return {
    migratedFiles,
    migratedLines,
    removedLegacyLogs: 1,
  };
}

async function migrateCronSettingsToObjects() {
  const users = await listUsersWithSettings();
  let moved = 0;
  let removedLegacy = 0;
  let migratedLogFiles = 0;
  let migratedLogLines = 0;
  let removedLegacyLogs = 0;

  for (const uid of users) {
    const legacyDir = path.join(
      settingsDirForUser(uid),
      safePathPart("cron", "settings"),
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
      const cronName = entry.name.replace(/\.json$/i, "");
      if (!cronName) continue;

      const legacyPath = path.join(legacyDir, entry.name);
      const legacyRow = await readSettingFile(legacyPath);
      const existingObject = await objectStore.getObject(uid, "cron", cronName);

      if (!existingObject) {
        await objectStore.putObjectRow({
          ...legacyRow,
          user_id: legacyRow.user_id || legacyRow.userId || uid,
          userId: legacyRow.user_id || legacyRow.userId || uid,
          type: "cron",
          object_type: "cron",
          name: cronName,
          object_id: cronName,
        });
        moved += 1;
      }

      const logResult = await mergeCronLegacyLogIntoObject(uid, cronName);
      migratedLogFiles += logResult.migratedFiles || 0;
      migratedLogLines += logResult.migratedLines || 0;
      removedLegacyLogs += logResult.removedLegacyLogs || 0;

      await queueForFile(legacyPath, async () => {
        try {
          await fsp.unlink(legacyPath);
          removedLegacy += 1;
        } catch (err) {
          if (!err || err.code !== "ENOENT") throw err;
        }
      });
    }
  }

  return {
    moved,
    removedLegacy,
    migratedLogFiles,
    migratedLogLines,
    removedLegacyLogs,
  };
}

async function moveProviderObjectFolder(uid, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return false;
  const fromDir = objectStore.objectDir(uid, "providers", fromId);
  const toDir = objectStore.objectDir(uid, "providers", toId);
  try {
    await fsp.access(fromDir);
  } catch (err) {
    if (err && err.code === "ENOENT") return false;
    throw err;
  }
  try {
    await fsp.access(toDir);
    const fromRow = await objectStore.getObject(uid, "providers", fromId);
    if (fromRow) {
      await objectStore.putObjectRow({
        ...fromRow,
        type: "providers",
        object_type: "providers",
        name: toId,
        object_id: toId,
      });
    }
    const fromLogsDir = objectStore.objectLogsDir(uid, "providers", fromId);
    const toLogsDir = objectStore.objectLogsDir(uid, "providers", toId);
    try {
      const logEntries = await fsp.readdir(fromLogsDir, {
        withFileTypes: true,
      });
      await ensurePrivateDir(toLogsDir);
      for (const entry of logEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".log")) continue;
        const src = path.join(fromLogsDir, entry.name);
        const dest = path.join(toLogsDir, entry.name);
        try {
          await fsp.access(dest);
          const content = await fsp.readFile(src, "utf8");
          if (content) await fsp.appendFile(dest, content);
          await fsp.unlink(src);
        } catch (err) {
          if (err && err.code === "ENOENT") {
            await fsp.rename(src, dest);
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
    await fsp.rm(fromDir, { recursive: true, force: true });
    const row = await objectStore.getObject(uid, "providers", toId);
    if (row) {
      await objectStore.putObjectRow({
        ...row,
        type: "providers",
        object_type: "providers",
        name: toId,
        object_id: toId,
      });
    }
    return true;
  } catch (err) {
    if (err && err.code === "ENOENT") {
      await fsp.rename(fromDir, toDir);
      const row = await objectStore.getObject(uid, "providers", toId);
      if (row) {
        await objectStore.putObjectRow({
          ...row,
          type: "providers",
          object_type: "providers",
          name: toId,
          object_id: toId,
        });
      }
      return true;
    }
    throw err;
  }
}

async function migrateNamedProviderSettingsToObjects() {
  const users = await listUsersWithSettings();
  let moved = 0;
  let removedLegacy = 0;
  let renamedObjects = 0;

  for (const uid of users) {
    const settingsDir = settingsDirForUser(uid);
    const userDir = path.join(DATA_ROOT, safePathPart(uid));
    const legacyDir = path.join(
      settingsDir,
      safePathPart("api_key", "settings"),
    );
    let entries;
    try {
      entries = await fsp.readdir(legacyDir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === "ENOENT") {
        await pruneEmptyDirChain([settingsDir, userDir]);
        entries = [];
      } else {
        throw err;
      }
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const legacyProviderId = entry.name.replace(/\.json$/i, "");
      const providerId = providerObjectIdFromSettingName(legacyProviderId);
      if (!providerId || providerId.toLowerCase() === "default") continue;

      const legacyPath = path.join(legacyDir, entry.name);
      const legacyRow = await readSettingFile(legacyPath);
      const existingObject =
        (await objectStore.getObject(uid, "providers", providerId)) ||
        (legacyProviderId !== providerId
          ? await objectStore.getObject(uid, "providers", legacyProviderId)
          : null);

      if (!existingObject) {
        await objectStore.putObjectRow({
          ...legacyRow,
          user_id: legacyRow.user_id || legacyRow.userId || uid,
          userId: legacyRow.user_id || legacyRow.userId || uid,
          type: "providers",
          object_type: "providers",
          name: providerId,
          object_id: providerId,
        });
        moved += 1;
      }

      await queueForFile(legacyPath, async () => {
        try {
          await fsp.unlink(legacyPath);
          removedLegacy += 1;
        } catch (err) {
          if (!err || err.code !== "ENOENT") throw err;
        }
      });
    }

    const providerDir = objectStore.objectTypeDir(uid, "providers");
    let providerEntries = [];
    try {
      providerEntries = await fsp.readdir(providerDir, { withFileTypes: true });
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
    for (const entry of providerEntries) {
      if (!entry.isDirectory()) continue;
      const fromId = entry.name;
      const toId = providerObjectIdFromSettingName(fromId);
      if (await moveProviderObjectFolder(uid, fromId, toId))
        renamedObjects += 1;
    }

    await pruneEmptyDirChain([legacyDir, settingsDir, userDir]);
  }

  return { moved, removedLegacy, renamedObjects };
}

module.exports = {
  DATA_ROOT,
  safePathPart,
  settingsDirForUser,
  settingFilePath,
  parseJsonField,
  normalizeProviderSettingName,
  providerObjectIdFromSettingName,
  providerSettingNameFromObjectId,
  listUserSettingsByType,
  getUserSetting,
  getUserSettingData,
  upsertUserSetting,
  putUserSettingRow,
  deleteUserSetting,
  migrateCronSettingsToObjects,
  migrateNamedProviderSettingsToObjects,
};
