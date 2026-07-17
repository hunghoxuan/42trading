const schemaModule = require("./schema.js");
const path = require("path");
const fs = require("fs");

let defaultDb = null;
let defaultBackend = null;

const dbInstances = new Map();
const migrationStates = new WeakMap();

function isPgPoolLike(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.query === "function" &&
    typeof value.end === "function"
  );
}

function normalizeConfig(input) {
  if (isPgPoolLike(input)) {
    return {
      backend: "postgres",
      pool: input,
      connectionTarget:
        input?.options?.connectionString ||
        input?.connectionString ||
        "pool",
    };
  }

  const backend = String(
    input?.storage?.backend || input?.backend || "postgres",
  )
    .trim()
    .toLowerCase();

  if (backend === "sqlite") {
    return {
      backend: "sqlite",
      sqlitePath:
        input?.storage?.sqlite?.path ||
        input?.sqlite?.path ||
        input?.path ||
        "./trading.db",
    };
  }

  return {
    backend: "postgres",
    pool: input?.pool || null,
    connectionTarget:
      input?.pool?.options?.connectionString ||
      input?.storage?.postgres?.url ||
      input?.postgres?.url ||
      process.env.POSTGRES_URL ||
      "",
  };
}

function attachDbMetadata(db, provider) {
  db._backend = provider.backend;
  db._schema = provider.schema;
  db._provider = provider;
  return db;
}

function createSqliteProvider(config) {
  const Database = require("better-sqlite3");
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  const schema = schemaModule.sqlite;
  const sqlitePath = config.sqlitePath;
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true, mode: 0o700 });
  const raw = new Database(sqlitePath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  const db = drizzle(raw, { schema });
  const provider = {
    backend: "sqlite",
    connection: { target: sqlitePath },
    raw,
    schema,
    db,
  };
  attachDbMetadata(db, provider);
  return provider;
}

function createPostgresProvider(config) {
  const { drizzle } = require("drizzle-orm/node-postgres");
  const { Pool } = require("pg");
  const schema = schemaModule.postgres;
  const pool =
    config.pool ||
    new Pool({
      connectionString: config.connectionTarget,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  const db = drizzle(pool, { schema });
  const provider = {
    backend: "postgres",
    connection: { target: config.connectionTarget || "pool" },
    raw: pool,
    schema,
    db,
  };
  attachDbMetadata(db, provider);
  return provider;
}

function initDb(input) {
  const config = normalizeConfig(input);
  const cacheKey =
    config.backend === "sqlite"
      ? `sqlite:${config.sqlitePath}`
      : `postgres:${config.connectionTarget || "pool"}`;

  if (dbInstances.has(cacheKey)) {
    const existing = dbInstances.get(cacheKey);
    if (!defaultDb) {
      defaultDb = existing.db;
      defaultBackend = existing.backend;
    }
    return existing.db;
  }

  const provider =
    config.backend === "sqlite"
      ? createSqliteProvider(config)
      : createPostgresProvider(config);

  dbInstances.set(cacheKey, provider);
  if (!defaultDb) {
    defaultDb = provider.db;
    defaultBackend = provider.backend;
  }
  return provider.db;
}

function getDb() {
  if (!defaultDb) {
    throw new Error("DB not initialized. Call initDb(config) first.");
  }
  return defaultDb;
}

function getBackend() {
  return defaultBackend;
}

function getDbProvider(db = null) {
  const target = db || getDb();
  return target?._provider || null;
}

function migrationsFolderForBackend(backend) {
  return path.join(
    __dirname,
    "migrations",
    backend === "sqlite" ? "sqlite" : "postgres",
  );
}

async function migrateDb(db = null) {
  const provider = getDbProvider(db);
  if (!provider) {
    throw new Error("DB provider not initialized. Call initDb(config) first.");
  }
  if (migrationStates.get(provider) === "done") {
    return provider.db;
  }
  const inFlight = provider._migrationPromise;
  if (inFlight) {
    await inFlight;
    return provider.db;
  }

  const promise = (async () => {
    if (provider.backend === "sqlite") {
      const { migrate } = require("drizzle-orm/better-sqlite3/migrator");
      migrate(provider.db, {
        migrationsFolder: migrationsFolderForBackend("sqlite"),
      });
    } else {
      const { migrate } = require("drizzle-orm/node-postgres/migrator");
      await migrate(provider.db, {
        migrationsFolder: migrationsFolderForBackend("postgres"),
      });
    }
    migrationStates.set(provider, "done");
  })();

  provider._migrationPromise = promise;
  try {
    await promise;
  } finally {
    provider._migrationPromise = null;
  }
  return provider.db;
}

module.exports = {
  initDb,
  getDb,
  getBackend,
  getDbProvider,
  normalizeConfig,
  migrateDb,
};
