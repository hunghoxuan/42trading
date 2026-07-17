"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { createObjectStoreRepo } = require("../objects/objectStoreRepo");

const SYSTEM_USER_ID = "__system__";
const CONFIG_ROOT = path.join("src", "config");
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
}

async function readJsonFile(filePath) {
  const raw = await fsp.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await fsp.rename(tmpPath, filePath);
}

function normalizeId(value, fallback = "default") {
  const raw = String(value || "").trim() || fallback;
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_") || fallback;
}

function configRootFromProject(projectRoot) {
  return path.join(
    path.resolve(projectRoot || DEFAULT_PROJECT_ROOT),
    CONFIG_ROOT,
  );
}

function createConfigStore(options = {}) {
  const projectRoot = path.resolve(
    options.projectRoot || DEFAULT_PROJECT_ROOT,
  );
  const rootDir = configRootFromProject(projectRoot);
  const repo = options.repo || createObjectStoreRepo(options.objectStore || {});
  const systemUserId = String(options.systemUserId || SYSTEM_USER_ID).trim() || SYSTEM_USER_ID;

  function resolvePath(kind, id = "") {
    if (kind === "root") return path.join(rootDir, `${id}.json`);
    if (kind === "schema") return path.join(rootDir, "schema", `${id}.json`);
    if (kind === "strategy") return path.join(rootDir, "strategies", `${id}.json`);
    throw new Error(`Unsupported config kind "${kind}"`);
  }

  function objectTypeForKind(kind) {
    return `system_config_${kind}`;
  }

  async function loadFileBackedDocument(kind, id, { refresh = false } = {}) {
    const safeId = normalizeId(id);
    const objectType = objectTypeForKind(kind);
    if (!refresh) {
      const cached = await repo.getObjectData(systemUserId, objectType, safeId);
      if (cached && typeof cached === "object") return cached;
    }
    const value = await readJsonFile(resolvePath(kind, safeId));
    await repo.upsertObject(systemUserId, objectType, safeId, value);
    return value;
  }

  async function saveFileBackedDocument(kind, id, value) {
    const safeId = normalizeId(id);
    const objectType = objectTypeForKind(kind);
    await writeJsonAtomic(resolvePath(kind, safeId), value);
    await repo.upsertObject(systemUserId, objectType, safeId, value);
    return value;
  }

  async function listStrategyKeys() {
    const dirPath = path.join(rootDir, "strategies");
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.replace(/\.json$/i, ""))
      .filter(Boolean)
      .sort();
  }

  return {
    repo,
    async getConfig(options = {}) {
      return loadFileBackedDocument("root", "config", options);
    },
    async saveConfig(value) {
      return saveFileBackedDocument("root", "config", value);
    },
    async getApps(options = {}) {
      return loadFileBackedDocument("root", "apps", options);
    },
    async saveApps(value) {
      return saveFileBackedDocument("root", "apps", value);
    },
    async getRuleVariables(options = {}) {
      return loadFileBackedDocument("root", "ruleVariables", options);
    },
    async saveRuleVariables(value) {
      return saveFileBackedDocument("root", "ruleVariables", value);
    },
    async getHealth(options = {}) {
      return loadFileBackedDocument("root", "health", options);
    },
    async saveHealth(value) {
      return saveFileBackedDocument("root", "health", value);
    },
    async getStrategyFunctions(options = {}) {
      return loadFileBackedDocument("root", "strategyFunctions", options);
    },
    async saveStrategyFunctions(value) {
      return saveFileBackedDocument("root", "strategyFunctions", value);
    },
    async getSchema(name, options = {}) {
      return loadFileBackedDocument("schema", name, options);
    },
    async saveSchema(name, value) {
      return saveFileBackedDocument("schema", name, value);
    },
    async getStrategy(name, options = {}) {
      return loadFileBackedDocument("strategy", name, options);
    },
    async saveStrategy(name, value) {
      return saveFileBackedDocument("strategy", name, value);
    },
    async listStrategies(options = {}) {
      const keys = await listStrategyKeys();
      return Promise.all(
        keys.map((key) => this.getStrategy(key, { ...options, refresh: true })),
      );
    },
  };
}

module.exports = {
  CONFIG_ROOT,
  SYSTEM_USER_ID,
  createConfigStore,
};
