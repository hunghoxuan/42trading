"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { DatabaseSync } = require("node:sqlite");

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function safeJson(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return clone(fallback);
  if (typeof value === "object") return clone(value);
  try {
    return JSON.parse(value);
  } catch {
    return clone(fallback);
  }
}

function text(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function optionalText(value) {
  const out = text(value);
  return out || null;
}

function numberOrNull(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function integerOrZero(value) {
  const out = Number(value);
  return Number.isFinite(out) ? Math.trunc(out) : 0;
}

function makeId(prefix) {
  const token =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : crypto.randomBytes(16).toString("hex");
  return `${prefix}_${token}`;
}

function defaultEntitySearchText(input = {}) {
  const parts = [
    input.entityType,
    input.entityKey,
    input.title,
    input.subtitle,
    input.category,
    input.subtype,
    input.userId,
    input.ownerId,
    input.slug,
    input.status,
    input.visibility,
    input.scopeModule,
    JSON.stringify(input.data || {}),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return parts.join(" ").toLowerCase();
}

function normalizeEntity(input = {}) {
  const now = nowIso();
  const tenantId = text(input.tenantId || input.tenant_id || "default", "default");
  const scopeType = text(input.scopeType || input.scope_type || "TENANT", "TENANT").toUpperCase();
  const lang = text(input.lang || input.locale, "");
  const locale = text(input.locale || input.lang, "");
  return {
    id: text(input.id) || makeId("ent"),
    tenant_id: tenantId,
    entity_type: text(input.entityType || input.entity_type),
    entity_key: text(input.entityKey || input.entity_key),
    parent_id: optionalText(input.parentId || input.parent_id),
    derived_from_id: optionalText(input.derivedFromId || input.derived_from_id),
    user_id: optionalText(input.userId || input.user_id),
    owner_id: optionalText(input.ownerId || input.owner_id),
    owner_team_id: optionalText(input.ownerTeamId || input.owner_team_id),
    slug: optionalText(input.slug),
    title: optionalText(input.title),
    subtitle: optionalText(input.subtitle),
    status: text(input.status || "ACTIVE", "ACTIVE").toUpperCase(),
    state: optionalText(input.state),
    category: optionalText(input.category),
    subtype: optionalText(input.subtype),
    priority: integerOrZero(input.priority),
    visibility: text(input.visibility || "PRIVATE", "PRIVATE").toUpperCase(),
    access_level: text(input.accessLevel || input.access_level || "OWNER_ONLY", "OWNER_ONLY").toUpperCase(),
    scope_type: scopeType,
    scope_tenant_id:
      scopeType === "GLOBAL"
        ? null
        : optionalText(input.scopeTenantId || input.scope_tenant_id || tenantId),
    scope_module: optionalText(input.scopeModule || input.scope_module),
    scope_user_id: optionalText(input.scopeUserId || input.scope_user_id || input.userId || input.user_id),
    lang,
    locale,
    country_code: optionalText(input.countryCode || input.country_code)?.toUpperCase() || null,
    sort_order: integerOrZero(input.sortOrder || input.sort_order),
    currency: optionalText(input.currency)?.toUpperCase() || null,
    amount: numberOrNull(input.amount),
    quantity: numberOrNull(input.quantity),
    price: numberOrNull(input.price),
    balance: numberOrNull(input.balance),
    image_url: optionalText(input.imageUrl || input.image_url),
    icon: optionalText(input.icon),
    source_system: optionalText(input.sourceSystem || input.source_system),
    source_id: optionalText(input.sourceId || input.source_id),
    sync_status: optionalText(input.syncStatus || input.sync_status),
    version_no: integerOrZero(input.versionNo || input.version_no),
    published_at: optionalText(input.publishedAt || input.published_at),
    archived_at: optionalText(input.archivedAt || input.archived_at),
    effective_from: optionalText(input.effectiveFrom || input.effective_from),
    effective_to: optionalText(input.effectiveTo || input.effective_to),
    start_at: optionalText(input.startAt || input.start_at),
    end_at: optionalText(input.endAt || input.end_at),
    due_at: optionalText(input.dueAt || input.due_at),
    scheduled_at: optionalText(input.scheduledAt || input.scheduled_at),
    search_text: text(
      input.searchText || input.search_text || defaultEntitySearchText(input),
    ),
    meta: clone(input.meta || input.meta_json || {}),
    data: clone(input.data || {}),
    created_at: text(input.createdAt || input.created_at || now, now),
    updated_at: text(input.updatedAt || input.updated_at || now, now),
  };
}

function normalizeLink(input = {}) {
  const now = nowIso();
  return {
    id: text(input.id) || makeId("lnk"),
    tenant_id: text(input.tenantId || input.tenant_id || "default", "default"),
    from_entity_id: text(input.fromEntityId || input.from_entity_id),
    to_entity_id: text(input.toEntityId || input.to_entity_id),
    from_type: optionalText(input.fromType || input.from_type),
    to_type: optionalText(input.toType || input.to_type),
    link_type: text(input.linkType || input.link_type),
    user_id: optionalText(input.userId || input.user_id),
    sort_order: integerOrZero(input.sortOrder || input.sort_order),
    status: text(input.status || "ACTIVE", "ACTIVE").toUpperCase(),
    data: clone(input.data || {}),
    created_at: text(input.createdAt || input.created_at || now, now),
    updated_at: text(input.updatedAt || input.updated_at || now, now),
  };
}

function normalizeJournal(input = {}) {
  const now = nowIso();
  return {
    id: text(input.id) || makeId("jrnl"),
    tenant_id: text(input.tenantId || input.tenant_id || "default", "default"),
    entity_id: optionalText(input.entityId || input.entity_id),
    entity_type: optionalText(input.entityType || input.entity_type),
    entity_key: optionalText(input.entityKey || input.entity_key),
    user_id: optionalText(input.userId || input.user_id),
    entry_type: text(input.entryType || input.entry_type),
    direction: optionalText(input.direction),
    amount: numberOrNull(input.amount),
    currency: optionalText(input.currency),
    happened_at: text(input.happenedAt || input.happened_at || now, now),
    sort_order: integerOrZero(input.sortOrder || input.sort_order),
    data: clone(input.data || {}),
    created_at: text(input.createdAt || input.created_at || now, now),
  };
}

function normalizeProcess(input = {}) {
  const now = nowIso();
  return {
    id: text(input.id) || makeId("prc"),
    tenant_id: text(input.tenantId || input.tenant_id || "default", "default"),
    process_type: text(input.processType || input.process_type),
    topic: text(input.topic),
    entity_id: optionalText(input.entityId || input.entity_id),
    entity_type: optionalText(input.entityType || input.entity_type),
    entity_key: optionalText(input.entityKey || input.entity_key),
    user_id: optionalText(input.userId || input.user_id),
    status: text(input.status || "PENDING", "PENDING").toUpperCase(),
    priority: integerOrZero(input.priority),
    attempt_count: integerOrZero(input.attemptCount || input.attempt_count),
    max_attempts: Math.max(1, integerOrZero(input.maxAttempts || input.max_attempts || 10)),
    run_at: text(input.runAt || input.run_at || now, now),
    locked_at: optionalText(input.lockedAt || input.locked_at),
    locked_by: optionalText(input.lockedBy || input.locked_by),
    last_error: optionalText(input.lastError || input.last_error),
    payload: clone(input.payload || {}),
    result: clone(input.result || {}),
    created_at: text(input.createdAt || input.created_at || now, now),
    updated_at: text(input.updatedAt || input.updated_at || now, now),
  };
}

function entityRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    tenantId: row.tenant_id,
    entity_type: row.entity_type,
    entityType: row.entity_type,
    entity_key: row.entity_key,
    entityKey: row.entity_key,
    parent_id: row.parent_id || null,
    parentId: row.parent_id || null,
    derived_from_id: row.derived_from_id || null,
    derivedFromId: row.derived_from_id || null,
    user_id: row.user_id || null,
    userId: row.user_id || null,
    owner_id: row.owner_id || null,
    ownerId: row.owner_id || null,
    owner_team_id: row.owner_team_id || null,
    ownerTeamId: row.owner_team_id || null,
    slug: row.slug || null,
    title: row.title || null,
    subtitle: row.subtitle || null,
    status: row.status,
    state: row.state || null,
    category: row.category || null,
    subtype: row.subtype || null,
    priority: integerOrZero(row.priority),
    visibility: row.visibility || null,
    access_level: row.access_level || null,
    accessLevel: row.access_level || null,
    scope_type: row.scope_type || null,
    scopeType: row.scope_type || null,
    scope_tenant_id: row.scope_tenant_id || null,
    scopeTenantId: row.scope_tenant_id || null,
    scope_module: row.scope_module || null,
    scopeModule: row.scope_module || null,
    scope_user_id: row.scope_user_id || null,
    scopeUserId: row.scope_user_id || null,
    lang: row.lang || null,
    locale: row.locale || row.lang || null,
    country_code: row.country_code || null,
    countryCode: row.country_code || null,
    sort_order: integerOrZero(row.sort_order),
    sortOrder: integerOrZero(row.sort_order),
    currency: row.currency || null,
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    balance: row.balance === null || row.balance === undefined ? null : Number(row.balance),
    image_url: row.image_url || null,
    imageUrl: row.image_url || null,
    icon: row.icon || null,
    source_system: row.source_system || null,
    sourceSystem: row.source_system || null,
    source_id: row.source_id || null,
    sourceId: row.source_id || null,
    sync_status: row.sync_status || null,
    syncStatus: row.sync_status || null,
    version_no: integerOrZero(row.version_no),
    versionNo: integerOrZero(row.version_no),
    published_at: row.published_at || null,
    publishedAt: row.published_at || null,
    archived_at: row.archived_at || null,
    archivedAt: row.archived_at || null,
    effective_from: row.effective_from || null,
    effectiveFrom: row.effective_from || null,
    effective_to: row.effective_to || null,
    effectiveTo: row.effective_to || null,
    start_at: row.start_at || null,
    startAt: row.start_at || null,
    end_at: row.end_at || null,
    endAt: row.end_at || null,
    due_at: row.due_at || null,
    dueAt: row.due_at || null,
    scheduled_at: row.scheduled_at || null,
    scheduledAt: row.scheduled_at || null,
    search_text: row.search_text || "",
    searchText: row.search_text || "",
    meta: safeJson(row.meta, {}),
    data: safeJson(row.data, {}),
    created_at: row.created_at,
    createdAt: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at,
  };
}

function linkRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    tenantId: row.tenant_id,
    from_entity_id: row.from_entity_id,
    fromEntityId: row.from_entity_id,
    to_entity_id: row.to_entity_id,
    toEntityId: row.to_entity_id,
    from_type: row.from_type || null,
    fromType: row.from_type || null,
    to_type: row.to_type || null,
    toType: row.to_type || null,
    link_type: row.link_type,
    linkType: row.link_type,
    user_id: row.user_id || null,
    userId: row.user_id || null,
    sort_order: integerOrZero(row.sort_order),
    sortOrder: integerOrZero(row.sort_order),
    status: row.status,
    data: safeJson(row.data, {}),
    created_at: row.created_at,
    createdAt: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at,
  };
}

function journalRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    tenantId: row.tenant_id,
    entity_id: row.entity_id || null,
    entityId: row.entity_id || null,
    entity_type: row.entity_type || null,
    entityType: row.entity_type || null,
    entity_key: row.entity_key || null,
    entityKey: row.entity_key || null,
    user_id: row.user_id || null,
    userId: row.user_id || null,
    entry_type: row.entry_type,
    entryType: row.entry_type,
    direction: row.direction || null,
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    currency: row.currency || null,
    happened_at: row.happened_at,
    happenedAt: row.happened_at,
    sort_order: integerOrZero(row.sort_order),
    sortOrder: integerOrZero(row.sort_order),
    data: safeJson(row.data, {}),
    created_at: row.created_at,
    createdAt: row.created_at,
  };
}

function processRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    tenantId: row.tenant_id,
    process_type: row.process_type,
    processType: row.process_type,
    topic: row.topic,
    entity_id: row.entity_id || null,
    entityId: row.entity_id || null,
    entity_type: row.entity_type || null,
    entityType: row.entity_type || null,
    entity_key: row.entity_key || null,
    entityKey: row.entity_key || null,
    user_id: row.user_id || null,
    userId: row.user_id || null,
    status: row.status,
    priority: integerOrZero(row.priority),
    attempt_count: integerOrZero(row.attempt_count),
    attemptCount: integerOrZero(row.attempt_count),
    max_attempts: integerOrZero(row.max_attempts),
    maxAttempts: integerOrZero(row.max_attempts),
    run_at: row.run_at,
    runAt: row.run_at,
    locked_at: row.locked_at || null,
    lockedAt: row.locked_at || null,
    locked_by: row.locked_by || null,
    lockedBy: row.locked_by || null,
    last_error: row.last_error || null,
    lastError: row.last_error || null,
    payload: safeJson(row.payload, {}),
    result: safeJson(row.result, {}),
    created_at: row.created_at,
    createdAt: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at,
  };
}

function entitySortSql(sortBy = "updated_at", sortDirection = "desc") {
  const allowed = new Set([
    "updated_at",
    "created_at",
    "sort_order",
    "entity_key",
    "scheduled_at",
    "due_at",
    "start_at",
    "end_at",
    "published_at",
    "price",
    "amount",
    "balance",
    "priority",
  ]);
  const direction = String(sortDirection || "desc").trim().toUpperCase() === "ASC" ? "ASC" : "DESC";
  const column = allowed.has(String(sortBy || "").trim()) ? sortBy : "updated_at";
  return ` ORDER BY ${column} ${direction}, entity_key ASC`;
}

function linkSortSql(sortBy = "sort_order", sortDirection = "asc") {
  const allowed = new Set(["sort_order", "updated_at", "created_at", "link_type"]);
  const direction = String(sortDirection || "asc").trim().toUpperCase() === "DESC" ? "DESC" : "ASC";
  const column = allowed.has(String(sortBy || "").trim()) ? sortBy : "sort_order";
  return ` ORDER BY ${column} ${direction}, created_at ASC`;
}

function journalSortSql(sortBy = "happened_at", sortDirection = "desc") {
  const allowed = new Set(["happened_at", "created_at", "sort_order", "entry_type"]);
  const direction = String(sortDirection || "desc").trim().toUpperCase() === "ASC" ? "ASC" : "DESC";
  const column = allowed.has(String(sortBy || "").trim()) ? sortBy : "happened_at";
  return ` ORDER BY ${column} ${direction}, created_at DESC`;
}

function processSortSql(sortBy = "run_at", sortDirection = "asc") {
  const allowed = new Set(["run_at", "updated_at", "created_at", "priority"]);
  const direction = String(sortDirection || "asc").trim().toUpperCase() === "DESC" ? "DESC" : "ASC";
  const column = allowed.has(String(sortBy || "").trim()) ? sortBy : "run_at";
  return ` ORDER BY ${column} ${direction}, priority DESC, created_at ASC`;
}

function sqliteColumnNames(db, tableName) {
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() || [])
      .map((row) => text(row?.name))
      .filter(Boolean),
  );
}

function ensureSqliteColumns(db, tableName, definitions = []) {
  const existing = sqliteColumnNames(db, tableName);
  for (const definition of definitions) {
    const name = text(definition?.name);
    const sql = text(definition?.sql);
    if (!name || !sql || existing.has(name)) continue;
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${sql};`);
  }
}

class SqliteUniversalStoreAdapter {
  constructor(options = {}) {
    const sqlitePath = text(
      options.sqlitePath || options.path || path.join(process.cwd(), ".local", "universal-store.sqlite"),
    );
    this.backend = "sqlite";
    this.connectionTarget = sqlitePath;
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(sqlitePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS object_entities (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        parent_id TEXT,
        derived_from_id TEXT,
        user_id TEXT,
        owner_id TEXT,
        owner_team_id TEXT,
        slug TEXT,
        title TEXT,
        subtitle TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        state TEXT,
        category TEXT,
        subtype TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        visibility TEXT NOT NULL DEFAULT 'PRIVATE',
        access_level TEXT NOT NULL DEFAULT 'OWNER_ONLY',
        scope_type TEXT NOT NULL DEFAULT 'TENANT',
        scope_tenant_id TEXT,
        scope_module TEXT,
        scope_user_id TEXT,
        lang TEXT NOT NULL DEFAULT '',
        locale TEXT NOT NULL DEFAULT '',
        country_code TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        currency TEXT,
        amount REAL,
        quantity REAL,
        price REAL,
        balance REAL,
        image_url TEXT,
        icon TEXT,
        source_system TEXT,
        source_id TEXT,
        sync_status TEXT,
        version_no INTEGER NOT NULL DEFAULT 0,
        published_at TEXT,
        archived_at TEXT,
        effective_from TEXT,
        effective_to TEXT,
        start_at TEXT,
        end_at TEXT,
        due_at TEXT,
        scheduled_at TEXT,
        search_text TEXT,
        meta TEXT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, entity_type, entity_key, lang)
      );
      CREATE INDEX IF NOT EXISTS idx_object_entities_tenant_type
        ON object_entities (tenant_id, entity_type, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_entities_user
        ON object_entities (tenant_id, user_id, entity_type, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_entities_owner
        ON object_entities (tenant_id, owner_id, entity_type, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_entities_parent
        ON object_entities (tenant_id, parent_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_entities_state
        ON object_entities (tenant_id, entity_type, state, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_entities_lang_status
        ON object_entities (tenant_id, entity_type, lang, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_entities_search
        ON object_entities (tenant_id, entity_type, search_text);
      CREATE TABLE IF NOT EXISTS object_links (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        from_entity_id TEXT NOT NULL,
        to_entity_id TEXT NOT NULL,
        from_type TEXT,
        to_type TEXT,
        link_type TEXT NOT NULL,
        user_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, from_entity_id, to_entity_id, link_type)
      );
      CREATE INDEX IF NOT EXISTS idx_object_links_from
        ON object_links (tenant_id, from_entity_id, link_type, sort_order);
      CREATE INDEX IF NOT EXISTS idx_object_links_to
        ON object_links (tenant_id, to_entity_id, link_type, sort_order);
      CREATE INDEX IF NOT EXISTS idx_object_links_from_status
        ON object_links (tenant_id, from_entity_id, link_type, status, sort_order);
      CREATE INDEX IF NOT EXISTS idx_object_links_to_status
        ON object_links (tenant_id, to_entity_id, link_type, status, sort_order);
      CREATE INDEX IF NOT EXISTS idx_object_links_user
        ON object_links (tenant_id, user_id, link_type, updated_at DESC);

      CREATE TABLE IF NOT EXISTS object_journal (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        entity_id TEXT,
        entity_type TEXT,
        entity_key TEXT,
        user_id TEXT,
        entry_type TEXT NOT NULL,
        direction TEXT,
        amount REAL,
        currency TEXT,
        happened_at TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_object_journal_entity
        ON object_journal (tenant_id, entity_id, happened_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_journal_type_key
        ON object_journal (tenant_id, entity_type, entity_key, happened_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_journal_user
        ON object_journal (tenant_id, user_id, happened_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_journal_entry
        ON object_journal (tenant_id, entry_type, happened_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_journal_entity_entry
        ON object_journal (tenant_id, entity_id, entry_type, happened_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_journal_type_entry
        ON object_journal (tenant_id, entity_type, entry_type, happened_at DESC);

      CREATE TABLE IF NOT EXISTS object_processes (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        process_type TEXT NOT NULL,
        topic TEXT NOT NULL,
        entity_id TEXT,
        entity_type TEXT,
        entity_key TEXT,
        user_id TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        priority INTEGER NOT NULL DEFAULT 0,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 10,
        run_at TEXT NOT NULL,
        locked_at TEXT,
        locked_by TEXT,
        last_error TEXT,
        payload TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_object_processes_due
        ON object_processes (tenant_id, status, run_at, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_object_processes_entity
        ON object_processes (tenant_id, entity_id, status, run_at);
      CREATE INDEX IF NOT EXISTS idx_object_processes_user
        ON object_processes (tenant_id, user_id, status, run_at);
      CREATE INDEX IF NOT EXISTS idx_object_processes_type
        ON object_processes (tenant_id, process_type, status, run_at, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_object_processes_topic
        ON object_processes (tenant_id, topic, status, run_at, priority DESC);
    `);
    ensureSqliteColumns(this.db, "object_entities", [
      { name: "derived_from_id", sql: "derived_from_id TEXT" },
      { name: "owner_team_id", sql: "owner_team_id TEXT" },
      { name: "title", sql: "title TEXT" },
      { name: "subtitle", sql: "subtitle TEXT" },
      { name: "state", sql: "state TEXT" },
      { name: "category", sql: "category TEXT" },
      { name: "subtype", sql: "subtype TEXT" },
      { name: "priority", sql: "priority INTEGER NOT NULL DEFAULT 0" },
      { name: "visibility", sql: "visibility TEXT NOT NULL DEFAULT 'PRIVATE'" },
      { name: "access_level", sql: "access_level TEXT NOT NULL DEFAULT 'OWNER_ONLY'" },
      { name: "scope_type", sql: "scope_type TEXT NOT NULL DEFAULT 'TENANT'" },
      { name: "scope_tenant_id", sql: "scope_tenant_id TEXT" },
      { name: "scope_module", sql: "scope_module TEXT" },
      { name: "scope_user_id", sql: "scope_user_id TEXT" },
      { name: "locale", sql: "locale TEXT NOT NULL DEFAULT ''" },
      { name: "country_code", sql: "country_code TEXT" },
      { name: "currency", sql: "currency TEXT" },
      { name: "amount", sql: "amount REAL" },
      { name: "quantity", sql: "quantity REAL" },
      { name: "price", sql: "price REAL" },
      { name: "balance", sql: "balance REAL" },
      { name: "image_url", sql: "image_url TEXT" },
      { name: "icon", sql: "icon TEXT" },
      { name: "source_system", sql: "source_system TEXT" },
      { name: "source_id", sql: "source_id TEXT" },
      { name: "sync_status", sql: "sync_status TEXT" },
      { name: "version_no", sql: "version_no INTEGER NOT NULL DEFAULT 0" },
      { name: "published_at", sql: "published_at TEXT" },
      { name: "archived_at", sql: "archived_at TEXT" },
      { name: "effective_from", sql: "effective_from TEXT" },
      { name: "effective_to", sql: "effective_to TEXT" },
      { name: "start_at", sql: "start_at TEXT" },
      { name: "end_at", sql: "end_at TEXT" },
      { name: "due_at", sql: "due_at TEXT" },
      { name: "scheduled_at", sql: "scheduled_at TEXT" },
      { name: "meta", sql: "meta TEXT" },
    ]);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_object_entities_scope
        ON object_entities (scope_type, scope_tenant_id, scope_module, visibility, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_entities_scope_user
        ON object_entities (scope_type, scope_tenant_id, scope_module, scope_user_id, visibility, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_entities_category
        ON object_entities (tenant_id, entity_type, category, subtype, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_entities_schedule
        ON object_entities (tenant_id, status, scheduled_at, due_at);
      CREATE INDEX IF NOT EXISTS idx_object_entities_source
        ON object_entities (tenant_id, source_system, source_id);
      CREATE INDEX IF NOT EXISTS idx_object_entities_currency
        ON object_entities (tenant_id, entity_type, currency, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_object_entities_country
        ON object_entities (tenant_id, entity_type, country_code, status, updated_at DESC);
    `);
  }

  getInfo() {
    return {
      backend: this.backend,
      connectionTarget: this.connectionTarget,
    };
  }

  upsertEntity(input = {}) {
    const row = normalizeEntity(input);
    this.db.prepare(`
      INSERT INTO object_entities (
        id, tenant_id, entity_type, entity_key, parent_id, derived_from_id, user_id, owner_id,
        owner_team_id, slug, title, subtitle, status, state, category, subtype, priority,
        visibility, access_level, scope_type, scope_tenant_id, scope_module, scope_user_id,
        lang, locale, country_code, sort_order, currency, amount, quantity, price, balance,
        image_url, icon, source_system, source_id, sync_status, version_no, published_at,
        archived_at, effective_from, effective_to, start_at, end_at, due_at, scheduled_at,
        search_text, meta, data, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, entity_type, entity_key, lang) DO UPDATE SET
        id = excluded.id,
        parent_id = excluded.parent_id,
        derived_from_id = excluded.derived_from_id,
        user_id = excluded.user_id,
        owner_id = excluded.owner_id,
        owner_team_id = excluded.owner_team_id,
        slug = excluded.slug,
        title = excluded.title,
        subtitle = excluded.subtitle,
        status = excluded.status,
        state = excluded.state,
        category = excluded.category,
        subtype = excluded.subtype,
        priority = excluded.priority,
        visibility = excluded.visibility,
        access_level = excluded.access_level,
        scope_type = excluded.scope_type,
        scope_tenant_id = excluded.scope_tenant_id,
        scope_module = excluded.scope_module,
        scope_user_id = excluded.scope_user_id,
        locale = excluded.locale,
        country_code = excluded.country_code,
        sort_order = excluded.sort_order,
        currency = excluded.currency,
        amount = excluded.amount,
        quantity = excluded.quantity,
        price = excluded.price,
        balance = excluded.balance,
        image_url = excluded.image_url,
        icon = excluded.icon,
        source_system = excluded.source_system,
        source_id = excluded.source_id,
        sync_status = excluded.sync_status,
        version_no = excluded.version_no,
        published_at = excluded.published_at,
        archived_at = excluded.archived_at,
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        due_at = excluded.due_at,
        scheduled_at = excluded.scheduled_at,
        search_text = excluded.search_text,
        meta = excluded.meta,
        data = excluded.data,
        updated_at = excluded.updated_at
    `).run(
      row.id,
      row.tenant_id,
      row.entity_type,
      row.entity_key,
      row.parent_id,
      row.derived_from_id,
      row.user_id,
      row.owner_id,
      row.owner_team_id,
      row.slug,
      row.title,
      row.subtitle,
      row.status,
      row.state,
      row.category,
      row.subtype,
      row.priority,
      row.visibility,
      row.access_level,
      row.scope_type,
      row.scope_tenant_id,
      row.scope_module,
      row.scope_user_id,
      row.lang,
      row.locale,
      row.country_code,
      row.sort_order,
      row.currency,
      row.amount,
      row.quantity,
      row.price,
      row.balance,
      row.image_url,
      row.icon,
      row.source_system,
      row.source_id,
      row.sync_status,
      row.version_no,
      row.published_at,
      row.archived_at,
      row.effective_from,
      row.effective_to,
      row.start_at,
      row.end_at,
      row.due_at,
      row.scheduled_at,
      row.search_text,
      JSON.stringify(row.meta || {}),
      JSON.stringify(row.data || {}),
      row.created_at,
      row.updated_at,
    );
    return this.getEntity(row.tenant_id, row.entity_type, row.entity_key, { lang: row.lang });
  }

  getEntity(tenantId, entityType, entityKey, options = {}) {
    const row = this.db.prepare(`
      SELECT *
      FROM object_entities
      WHERE tenant_id = ?
        AND entity_type = ?
        AND entity_key = ?
        AND lang = ?
      LIMIT 1
    `).get(text(tenantId, "default"), text(entityType), text(entityKey), text(options.lang, ""));
    return entityRow(row);
  }

  listEntities(filters = {}) {
    const params = [];
    const where = [];
    if (filters.tenantId || filters.tenant_id) {
      where.push("tenant_id = ?");
      params.push(text(filters.tenantId || filters.tenant_id));
    }
    if (filters.entityType || filters.entity_type) {
      where.push("entity_type = ?");
      params.push(text(filters.entityType || filters.entity_type));
    }
    if (filters.userId || filters.user_id) {
      where.push("user_id = ?");
      params.push(text(filters.userId || filters.user_id));
    }
    if (filters.ownerId || filters.owner_id) {
      where.push("owner_id = ?");
      params.push(text(filters.ownerId || filters.owner_id));
    }
    if (filters.parentId || filters.parent_id) {
      where.push("parent_id = ?");
      params.push(text(filters.parentId || filters.parent_id));
    }
    if (filters.status) {
      where.push("status = ?");
      params.push(text(filters.status).toUpperCase());
    }
    if (filters.state) {
      where.push("state = ?");
      params.push(text(filters.state));
    }
    if (filters.category) {
      where.push("category = ?");
      params.push(text(filters.category));
    }
    if (filters.subtype) {
      where.push("subtype = ?");
      params.push(text(filters.subtype));
    }
    if (filters.visibility) {
      where.push("visibility = ?");
      params.push(text(filters.visibility).toUpperCase());
    }
    if (filters.accessLevel || filters.access_level) {
      where.push("access_level = ?");
      params.push(text(filters.accessLevel || filters.access_level).toUpperCase());
    }
    if (filters.scopeType || filters.scope_type) {
      where.push("scope_type = ?");
      params.push(text(filters.scopeType || filters.scope_type).toUpperCase());
    }
    if (filters.scopeTenantId || filters.scope_tenant_id) {
      where.push("scope_tenant_id = ?");
      params.push(text(filters.scopeTenantId || filters.scope_tenant_id));
    }
    if (filters.scopeModule || filters.scope_module) {
      where.push("scope_module = ?");
      params.push(text(filters.scopeModule || filters.scope_module));
    }
    if (filters.scopeUserId || filters.scope_user_id) {
      where.push("scope_user_id = ?");
      params.push(text(filters.scopeUserId || filters.scope_user_id));
    }
    if (filters.currency) {
      where.push("currency = ?");
      params.push(text(filters.currency).toUpperCase());
    }
    if (filters.countryCode || filters.country_code) {
      where.push("country_code = ?");
      params.push(text(filters.countryCode || filters.country_code).toUpperCase());
    }
    if (filters.sourceSystem || filters.source_system) {
      where.push("source_system = ?");
      params.push(text(filters.sourceSystem || filters.source_system));
    }
    if (filters.sourceId || filters.source_id) {
      where.push("source_id = ?");
      params.push(text(filters.sourceId || filters.source_id));
    }
    if (filters.lang !== undefined) {
      where.push("lang = ?");
      params.push(text(filters.lang, ""));
    }
    if (filters.locale !== undefined) {
      where.push("locale = ?");
      params.push(text(filters.locale, ""));
    }
    if (filters.search || filters.q) {
      where.push("search_text LIKE ?");
      params.push(`%${text(filters.search || filters.q).toLowerCase()}%`);
    }
    const sql = `
      SELECT *
      FROM object_entities
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ${entitySortSql(filters.sortBy, filters.sortDirection)}
      LIMIT ?
      OFFSET ?
    `;
    params.push(Math.max(1, Number(filters.limit) || 200));
    params.push(Math.max(0, Number(filters.offset) || 0));
    return this.db.prepare(sql).all(...params).map(entityRow).filter(Boolean);
  }

  deleteEntity(tenantId, entityType, entityKey, options = {}) {
    return this.db.prepare(`
      DELETE FROM object_entities
      WHERE tenant_id = ?
        AND entity_type = ?
        AND entity_key = ?
        AND lang = ?
    `).run(text(tenantId, "default"), text(entityType), text(entityKey), text(options.lang, ""));
  }

  upsertLink(input = {}) {
    const row = normalizeLink(input);
    this.db.prepare(`
      INSERT INTO object_links (
        id, tenant_id, from_entity_id, to_entity_id, from_type, to_type, link_type, user_id,
        sort_order, status, data, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, from_entity_id, to_entity_id, link_type) DO UPDATE SET
        id = excluded.id,
        from_type = excluded.from_type,
        to_type = excluded.to_type,
        user_id = excluded.user_id,
        sort_order = excluded.sort_order,
        status = excluded.status,
        data = excluded.data,
        updated_at = excluded.updated_at
    `).run(
      row.id,
      row.tenant_id,
      row.from_entity_id,
      row.to_entity_id,
      row.from_type,
      row.to_type,
      row.link_type,
      row.user_id,
      row.sort_order,
      row.status,
      JSON.stringify(row.data || {}),
      row.created_at,
      row.updated_at,
    );
    return this.getLink(row.id);
  }

  getLink(id) {
    return linkRow(this.db.prepare(`SELECT * FROM object_links WHERE id = ? LIMIT 1`).get(text(id)));
  }

  listLinks(filters = {}) {
    const params = [];
    const where = [];
    if (filters.tenantId || filters.tenant_id) {
      where.push("tenant_id = ?");
      params.push(text(filters.tenantId || filters.tenant_id));
    }
    if (filters.fromEntityId || filters.from_entity_id) {
      where.push("from_entity_id = ?");
      params.push(text(filters.fromEntityId || filters.from_entity_id));
    }
    if (filters.toEntityId || filters.to_entity_id) {
      where.push("to_entity_id = ?");
      params.push(text(filters.toEntityId || filters.to_entity_id));
    }
    if (filters.linkType || filters.link_type) {
      where.push("link_type = ?");
      params.push(text(filters.linkType || filters.link_type));
    }
    if (filters.userId || filters.user_id) {
      where.push("user_id = ?");
      params.push(text(filters.userId || filters.user_id));
    }
    if (filters.status) {
      where.push("status = ?");
      params.push(text(filters.status).toUpperCase());
    }
    const sql = `
      SELECT *
      FROM object_links
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ${linkSortSql(filters.sortBy, filters.sortDirection)}
      LIMIT ?
      OFFSET ?
    `;
    params.push(Math.max(1, Number(filters.limit) || 200));
    params.push(Math.max(0, Number(filters.offset) || 0));
    return this.db.prepare(sql).all(...params).map(linkRow).filter(Boolean);
  }

  deleteLink(id) {
    return this.db.prepare(`DELETE FROM object_links WHERE id = ?`).run(text(id));
  }

  appendJournal(input = {}) {
    const row = normalizeJournal(input);
    this.db.prepare(`
      INSERT INTO object_journal (
        id, tenant_id, entity_id, entity_type, entity_key, user_id, entry_type, direction,
        amount, currency, happened_at, sort_order, data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.tenant_id,
      row.entity_id,
      row.entity_type,
      row.entity_key,
      row.user_id,
      row.entry_type,
      row.direction,
      row.amount,
      row.currency,
      row.happened_at,
      row.sort_order,
      JSON.stringify(row.data || {}),
      row.created_at,
    );
    return this.getJournalEntry(row.id);
  }

  getJournalEntry(id) {
    return journalRow(this.db.prepare(`SELECT * FROM object_journal WHERE id = ? LIMIT 1`).get(text(id)));
  }

  listJournal(filters = {}) {
    const params = [];
    const where = [];
    if (filters.tenantId || filters.tenant_id) {
      where.push("tenant_id = ?");
      params.push(text(filters.tenantId || filters.tenant_id));
    }
    if (filters.entityId || filters.entity_id) {
      where.push("entity_id = ?");
      params.push(text(filters.entityId || filters.entity_id));
    }
    if (filters.entityType || filters.entity_type) {
      where.push("entity_type = ?");
      params.push(text(filters.entityType || filters.entity_type));
    }
    if (filters.entityKey || filters.entity_key) {
      where.push("entity_key = ?");
      params.push(text(filters.entityKey || filters.entity_key));
    }
    if (filters.userId || filters.user_id) {
      where.push("user_id = ?");
      params.push(text(filters.userId || filters.user_id));
    }
    if (filters.entryType || filters.entry_type) {
      where.push("entry_type = ?");
      params.push(text(filters.entryType || filters.entry_type));
    }
    if (filters.search || filters.q) {
      where.push("LOWER(data) LIKE ?");
      params.push(`%${text(filters.search || filters.q).toLowerCase()}%`);
    }
    const sql = `
      SELECT *
      FROM object_journal
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ${journalSortSql(filters.sortBy, filters.sortDirection)}
      LIMIT ?
      OFFSET ?
    `;
    params.push(Math.max(1, Number(filters.limit) || 200));
    params.push(Math.max(0, Number(filters.offset) || 0));
    return this.db.prepare(sql).all(...params).map(journalRow).filter(Boolean);
  }

  upsertProcess(input = {}) {
    const row = normalizeProcess(input);
    this.db.prepare(`
      INSERT INTO object_processes (
        id, tenant_id, process_type, topic, entity_id, entity_type, entity_key, user_id,
        status, priority, attempt_count, max_attempts, run_at, locked_at, locked_by,
        last_error, payload, result, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        process_type = excluded.process_type,
        topic = excluded.topic,
        entity_id = excluded.entity_id,
        entity_type = excluded.entity_type,
        entity_key = excluded.entity_key,
        user_id = excluded.user_id,
        status = excluded.status,
        priority = excluded.priority,
        attempt_count = excluded.attempt_count,
        max_attempts = excluded.max_attempts,
        run_at = excluded.run_at,
        locked_at = excluded.locked_at,
        locked_by = excluded.locked_by,
        last_error = excluded.last_error,
        payload = excluded.payload,
        result = excluded.result,
        updated_at = excluded.updated_at
    `).run(
      row.id,
      row.tenant_id,
      row.process_type,
      row.topic,
      row.entity_id,
      row.entity_type,
      row.entity_key,
      row.user_id,
      row.status,
      row.priority,
      row.attempt_count,
      row.max_attempts,
      row.run_at,
      row.locked_at,
      row.locked_by,
      row.last_error,
      JSON.stringify(row.payload || {}),
      JSON.stringify(row.result || {}),
      row.created_at,
      row.updated_at,
    );
    return this.getProcess(row.id);
  }

  getProcess(id) {
    return processRow(this.db.prepare(`SELECT * FROM object_processes WHERE id = ? LIMIT 1`).get(text(id)));
  }

  listProcesses(filters = {}) {
    const params = [];
    const where = [];
    if (filters.tenantId || filters.tenant_id) {
      where.push("tenant_id = ?");
      params.push(text(filters.tenantId || filters.tenant_id));
    }
    if (filters.processType || filters.process_type) {
      where.push("process_type = ?");
      params.push(text(filters.processType || filters.process_type));
    }
    if (filters.topic) {
      where.push("topic = ?");
      params.push(text(filters.topic));
    }
    if (filters.entityId || filters.entity_id) {
      where.push("entity_id = ?");
      params.push(text(filters.entityId || filters.entity_id));
    }
    if (filters.userId || filters.user_id) {
      where.push("user_id = ?");
      params.push(text(filters.userId || filters.user_id));
    }
    if (filters.status) {
      where.push("status = ?");
      params.push(text(filters.status).toUpperCase());
    }
    if (filters.dueOnly) {
      where.push("run_at <= ?");
      params.push(text(filters.now || nowIso()));
    }
    const sql = `
      SELECT *
      FROM object_processes
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ${processSortSql(filters.sortBy, filters.sortDirection)}
      LIMIT ?
      OFFSET ?
    `;
    params.push(Math.max(1, Number(filters.limit) || 200));
    params.push(Math.max(0, Number(filters.offset) || 0));
    return this.db.prepare(sql).all(...params).map(processRow).filter(Boolean);
  }
}

class PostgresUniversalStoreAdapter {
  constructor(options = {}) {
    this.backend = "postgres";
    this.connectionTarget = text(
      options.postgresUrl || options.connectionString || process.env.MT5_POSTGRES_URL || process.env.POSTGRES_URL,
    );
    this.pool =
      options.pool && typeof options.pool.query === "function"
        ? options.pool
        : null;
    this._initPromise = null;
  }

  async init() {
    if (!this.pool) {
      if (!this.connectionTarget) {
        throw new Error("postgresUrl or POSTGRES_URL is required for Postgres universal store adapter");
      }
      this.pool = new Pool({
        connectionString: this.connectionTarget,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
    }
    if (!this._initPromise) {
      this._initPromise = this.pool.query(`
        CREATE TABLE IF NOT EXISTS object_entities (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_key TEXT NOT NULL,
          parent_id TEXT,
          derived_from_id TEXT,
          user_id TEXT,
          owner_id TEXT,
          owner_team_id TEXT,
          slug TEXT,
          title TEXT,
          subtitle TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          state TEXT,
          category TEXT,
          subtype TEXT,
          priority INTEGER NOT NULL DEFAULT 0,
          visibility TEXT NOT NULL DEFAULT 'PRIVATE',
          access_level TEXT NOT NULL DEFAULT 'OWNER_ONLY',
          scope_type TEXT NOT NULL DEFAULT 'TENANT',
          scope_tenant_id TEXT,
          scope_module TEXT,
          scope_user_id TEXT,
          lang TEXT NOT NULL DEFAULT '',
          locale TEXT NOT NULL DEFAULT '',
          country_code TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          currency TEXT,
          amount NUMERIC,
          quantity DOUBLE PRECISION,
          price NUMERIC,
          balance NUMERIC,
          image_url TEXT,
          icon TEXT,
          source_system TEXT,
          source_id TEXT,
          sync_status TEXT,
          version_no INTEGER NOT NULL DEFAULT 0,
          published_at TIMESTAMPTZ,
          archived_at TIMESTAMPTZ,
          effective_from TIMESTAMPTZ,
          effective_to TIMESTAMPTZ,
          start_at TIMESTAMPTZ,
          end_at TIMESTAMPTZ,
          due_at TIMESTAMPTZ,
          scheduled_at TIMESTAMPTZ,
          search_text TEXT,
          meta JSONB NOT NULL DEFAULT '{}'::jsonb,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, entity_type, entity_key, lang)
        );
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS derived_from_id TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS owner_team_id TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS title TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS subtitle TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS state TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS category TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS subtype TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'PRIVATE';
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'OWNER_ONLY';
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'TENANT';
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS scope_tenant_id TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS scope_module TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS scope_user_id TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT '';
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS country_code TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS currency TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS amount NUMERIC;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS quantity DOUBLE PRECISION;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS price NUMERIC;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS balance NUMERIC;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS image_url TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS icon TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS source_system TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS source_id TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS sync_status TEXT;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS version_no INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
        ALTER TABLE object_entities ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
        CREATE INDEX IF NOT EXISTS idx_object_entities_tenant_type
          ON object_entities (tenant_id, entity_type, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_entities_user
          ON object_entities (tenant_id, user_id, entity_type, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_entities_owner
          ON object_entities (tenant_id, owner_id, entity_type, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_entities_parent
          ON object_entities (tenant_id, parent_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_entities_state
          ON object_entities (tenant_id, entity_type, state, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_entities_lang_status
          ON object_entities (tenant_id, entity_type, lang, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_entities_search
          ON object_entities (tenant_id, entity_type, search_text);
        CREATE INDEX IF NOT EXISTS idx_object_entities_scope
          ON object_entities (scope_type, scope_tenant_id, scope_module, visibility, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_entities_scope_user
          ON object_entities (scope_type, scope_tenant_id, scope_module, scope_user_id, visibility, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_entities_category
          ON object_entities (tenant_id, entity_type, category, subtype, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_entities_schedule
          ON object_entities (tenant_id, status, scheduled_at, due_at);
        CREATE INDEX IF NOT EXISTS idx_object_entities_source
          ON object_entities (tenant_id, source_system, source_id);
        CREATE INDEX IF NOT EXISTS idx_object_entities_currency
          ON object_entities (tenant_id, entity_type, currency, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_entities_country
          ON object_entities (tenant_id, entity_type, country_code, status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS object_links (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          from_entity_id TEXT NOT NULL,
          to_entity_id TEXT NOT NULL,
          from_type TEXT,
          to_type TEXT,
          link_type TEXT NOT NULL,
          user_id TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, from_entity_id, to_entity_id, link_type)
        );
        CREATE INDEX IF NOT EXISTS idx_object_links_from
          ON object_links (tenant_id, from_entity_id, link_type, sort_order);
        CREATE INDEX IF NOT EXISTS idx_object_links_to
          ON object_links (tenant_id, to_entity_id, link_type, sort_order);
        CREATE INDEX IF NOT EXISTS idx_object_links_from_status
          ON object_links (tenant_id, from_entity_id, link_type, status, sort_order);
        CREATE INDEX IF NOT EXISTS idx_object_links_to_status
          ON object_links (tenant_id, to_entity_id, link_type, status, sort_order);
        CREATE INDEX IF NOT EXISTS idx_object_links_user
          ON object_links (tenant_id, user_id, link_type, updated_at DESC);

        CREATE TABLE IF NOT EXISTS object_journal (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          entity_id TEXT,
          entity_type TEXT,
          entity_key TEXT,
          user_id TEXT,
          entry_type TEXT NOT NULL,
          direction TEXT,
          amount NUMERIC,
          currency TEXT,
          happened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          sort_order INTEGER NOT NULL DEFAULT 0,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_object_journal_entity
          ON object_journal (tenant_id, entity_id, happened_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_journal_type_key
          ON object_journal (tenant_id, entity_type, entity_key, happened_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_journal_user
          ON object_journal (tenant_id, user_id, happened_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_journal_entry
          ON object_journal (tenant_id, entry_type, happened_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_journal_entity_entry
          ON object_journal (tenant_id, entity_id, entry_type, happened_at DESC);
        CREATE INDEX IF NOT EXISTS idx_object_journal_type_entry
          ON object_journal (tenant_id, entity_type, entry_type, happened_at DESC);

        CREATE TABLE IF NOT EXISTS object_processes (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          process_type TEXT NOT NULL,
          topic TEXT NOT NULL,
          entity_id TEXT,
          entity_type TEXT,
          entity_key TEXT,
          user_id TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING',
          priority INTEGER NOT NULL DEFAULT 0,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 10,
          run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          locked_at TIMESTAMPTZ,
          locked_by TEXT,
          last_error TEXT,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          result JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_object_processes_due
          ON object_processes (tenant_id, status, run_at, priority DESC);
        CREATE INDEX IF NOT EXISTS idx_object_processes_entity
          ON object_processes (tenant_id, entity_id, status, run_at);
        CREATE INDEX IF NOT EXISTS idx_object_processes_user
          ON object_processes (tenant_id, user_id, status, run_at);
        CREATE INDEX IF NOT EXISTS idx_object_processes_type
          ON object_processes (tenant_id, process_type, status, run_at, priority DESC);
        CREATE INDEX IF NOT EXISTS idx_object_processes_topic
          ON object_processes (tenant_id, topic, status, run_at, priority DESC);
      `);
    }
    await this._initPromise;
  }

  getInfo() {
    return {
      backend: this.backend,
      connectionTarget: this.connectionTarget,
    };
  }

  async upsertEntity(input = {}) {
    const row = normalizeEntity(input);
    await this.pool.query(`
      INSERT INTO object_entities (
        id, tenant_id, entity_type, entity_key, parent_id, derived_from_id, user_id, owner_id,
        owner_team_id, slug, title, subtitle, status, state, category, subtype, priority,
        visibility, access_level, scope_type, scope_tenant_id, scope_module, scope_user_id,
        lang, locale, country_code, sort_order, currency, amount, quantity, price, balance,
        image_url, icon, source_system, source_id, sync_status, version_no, published_at,
        archived_at, effective_from, effective_to, start_at, end_at, due_at, scheduled_at,
        search_text, meta, data, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39::timestamptz,$40::timestamptz,$41::timestamptz,$42::timestamptz,$43::timestamptz,$44::timestamptz,$45::timestamptz,$46::timestamptz,$47,$48::jsonb,$49::jsonb,$50::timestamptz,$51::timestamptz)
      ON CONFLICT (tenant_id, entity_type, entity_key, lang) DO UPDATE SET
        id = EXCLUDED.id,
        parent_id = EXCLUDED.parent_id,
        derived_from_id = EXCLUDED.derived_from_id,
        user_id = EXCLUDED.user_id,
        owner_id = EXCLUDED.owner_id,
        owner_team_id = EXCLUDED.owner_team_id,
        slug = EXCLUDED.slug,
        title = EXCLUDED.title,
        subtitle = EXCLUDED.subtitle,
        status = EXCLUDED.status,
        state = EXCLUDED.state,
        category = EXCLUDED.category,
        subtype = EXCLUDED.subtype,
        priority = EXCLUDED.priority,
        visibility = EXCLUDED.visibility,
        access_level = EXCLUDED.access_level,
        scope_type = EXCLUDED.scope_type,
        scope_tenant_id = EXCLUDED.scope_tenant_id,
        scope_module = EXCLUDED.scope_module,
        scope_user_id = EXCLUDED.scope_user_id,
        locale = EXCLUDED.locale,
        country_code = EXCLUDED.country_code,
        sort_order = EXCLUDED.sort_order,
        currency = EXCLUDED.currency,
        amount = EXCLUDED.amount,
        quantity = EXCLUDED.quantity,
        price = EXCLUDED.price,
        balance = EXCLUDED.balance,
        image_url = EXCLUDED.image_url,
        icon = EXCLUDED.icon,
        source_system = EXCLUDED.source_system,
        source_id = EXCLUDED.source_id,
        sync_status = EXCLUDED.sync_status,
        version_no = EXCLUDED.version_no,
        published_at = EXCLUDED.published_at,
        archived_at = EXCLUDED.archived_at,
        effective_from = EXCLUDED.effective_from,
        effective_to = EXCLUDED.effective_to,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        due_at = EXCLUDED.due_at,
        scheduled_at = EXCLUDED.scheduled_at,
        search_text = EXCLUDED.search_text,
        meta = EXCLUDED.meta,
        data = EXCLUDED.data,
        updated_at = EXCLUDED.updated_at
    `, [
      row.id,
      row.tenant_id,
      row.entity_type,
      row.entity_key,
      row.parent_id,
      row.derived_from_id,
      row.user_id,
      row.owner_id,
      row.owner_team_id,
      row.slug,
      row.title,
      row.subtitle,
      row.status,
      row.state,
      row.category,
      row.subtype,
      row.priority,
      row.visibility,
      row.access_level,
      row.scope_type,
      row.scope_tenant_id,
      row.scope_module,
      row.scope_user_id,
      row.lang,
      row.locale,
      row.country_code,
      row.sort_order,
      row.currency,
      row.amount,
      row.quantity,
      row.price,
      row.balance,
      row.image_url,
      row.icon,
      row.source_system,
      row.source_id,
      row.sync_status,
      row.version_no,
      row.published_at,
      row.archived_at,
      row.effective_from,
      row.effective_to,
      row.start_at,
      row.end_at,
      row.due_at,
      row.scheduled_at,
      row.search_text,
      JSON.stringify(row.meta || {}),
      JSON.stringify(row.data || {}),
      row.created_at,
      row.updated_at,
    ]);
    return this.getEntity(row.tenant_id, row.entity_type, row.entity_key, { lang: row.lang });
  }

  async getEntity(tenantId, entityType, entityKey, options = {}) {
    const result = await this.pool.query(`
      SELECT *
      FROM object_entities
      WHERE tenant_id = $1
        AND entity_type = $2
        AND entity_key = $3
        AND lang = $4
      LIMIT 1
    `, [text(tenantId, "default"), text(entityType), text(entityKey), text(options.lang, "")]);
    return entityRow(result.rows?.[0]);
  }

  async listEntities(filters = {}) {
    const params = [];
    const where = [];
    const push = (sql, value) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (filters.tenantId || filters.tenant_id) push("tenant_id = ?", text(filters.tenantId || filters.tenant_id));
    if (filters.entityType || filters.entity_type) push("entity_type = ?", text(filters.entityType || filters.entity_type));
    if (filters.userId || filters.user_id) push("user_id = ?", text(filters.userId || filters.user_id));
    if (filters.ownerId || filters.owner_id) push("owner_id = ?", text(filters.ownerId || filters.owner_id));
    if (filters.parentId || filters.parent_id) push("parent_id = ?", text(filters.parentId || filters.parent_id));
    if (filters.status) push("status = ?", text(filters.status).toUpperCase());
    if (filters.state) push("state = ?", text(filters.state));
    if (filters.category) push("category = ?", text(filters.category));
    if (filters.subtype) push("subtype = ?", text(filters.subtype));
    if (filters.visibility) push("visibility = ?", text(filters.visibility).toUpperCase());
    if (filters.accessLevel || filters.access_level) {
      push("access_level = ?", text(filters.accessLevel || filters.access_level).toUpperCase());
    }
    if (filters.scopeType || filters.scope_type) {
      push("scope_type = ?", text(filters.scopeType || filters.scope_type).toUpperCase());
    }
    if (filters.scopeTenantId || filters.scope_tenant_id) {
      push("scope_tenant_id = ?", text(filters.scopeTenantId || filters.scope_tenant_id));
    }
    if (filters.scopeModule || filters.scope_module) {
      push("scope_module = ?", text(filters.scopeModule || filters.scope_module));
    }
    if (filters.scopeUserId || filters.scope_user_id) {
      push("scope_user_id = ?", text(filters.scopeUserId || filters.scope_user_id));
    }
    if (filters.currency) push("currency = ?", text(filters.currency).toUpperCase());
    if (filters.countryCode || filters.country_code) {
      push("country_code = ?", text(filters.countryCode || filters.country_code).toUpperCase());
    }
    if (filters.sourceSystem || filters.source_system) {
      push("source_system = ?", text(filters.sourceSystem || filters.source_system));
    }
    if (filters.sourceId || filters.source_id) {
      push("source_id = ?", text(filters.sourceId || filters.source_id));
    }
    if (filters.lang !== undefined) push("lang = ?", text(filters.lang, ""));
    if (filters.locale !== undefined) push("locale = ?", text(filters.locale, ""));
    if (filters.search || filters.q) push("search_text ILIKE ?", `%${text(filters.search || filters.q).toLowerCase()}%`);
    params.push(Math.max(1, Number(filters.limit) || 200));
    params.push(Math.max(0, Number(filters.offset) || 0));
    const result = await this.pool.query(`
      SELECT *
      FROM object_entities
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ${entitySortSql(filters.sortBy, filters.sortDirection)}
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `, params);
    return (result.rows || []).map(entityRow).filter(Boolean);
  }

  async deleteEntity(tenantId, entityType, entityKey, options = {}) {
    return this.pool.query(`
      DELETE FROM object_entities
      WHERE tenant_id = $1
        AND entity_type = $2
        AND entity_key = $3
        AND lang = $4
    `, [text(tenantId, "default"), text(entityType), text(entityKey), text(options.lang, "")]);
  }

  async upsertLink(input = {}) {
    const row = normalizeLink(input);
    await this.pool.query(`
      INSERT INTO object_links (
        id, tenant_id, from_entity_id, to_entity_id, from_type, to_type, link_type, user_id,
        sort_order, status, data, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::timestamptz,$13::timestamptz)
      ON CONFLICT (tenant_id, from_entity_id, to_entity_id, link_type) DO UPDATE SET
        id = EXCLUDED.id,
        from_type = EXCLUDED.from_type,
        to_type = EXCLUDED.to_type,
        user_id = EXCLUDED.user_id,
        sort_order = EXCLUDED.sort_order,
        status = EXCLUDED.status,
        data = EXCLUDED.data,
        updated_at = EXCLUDED.updated_at
    `, [
      row.id,
      row.tenant_id,
      row.from_entity_id,
      row.to_entity_id,
      row.from_type,
      row.to_type,
      row.link_type,
      row.user_id,
      row.sort_order,
      row.status,
      JSON.stringify(row.data || {}),
      row.created_at,
      row.updated_at,
    ]);
    return this.getLink(row.id);
  }

  async getLink(id) {
    const result = await this.pool.query(`SELECT * FROM object_links WHERE id = $1 LIMIT 1`, [text(id)]);
    return linkRow(result.rows?.[0]);
  }

  async listLinks(filters = {}) {
    const params = [];
    const where = [];
    const push = (sql, value) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (filters.tenantId || filters.tenant_id) push("tenant_id = ?", text(filters.tenantId || filters.tenant_id));
    if (filters.fromEntityId || filters.from_entity_id) push("from_entity_id = ?", text(filters.fromEntityId || filters.from_entity_id));
    if (filters.toEntityId || filters.to_entity_id) push("to_entity_id = ?", text(filters.toEntityId || filters.to_entity_id));
    if (filters.linkType || filters.link_type) push("link_type = ?", text(filters.linkType || filters.link_type));
    if (filters.userId || filters.user_id) push("user_id = ?", text(filters.userId || filters.user_id));
    if (filters.status) push("status = ?", text(filters.status).toUpperCase());
    params.push(Math.max(1, Number(filters.limit) || 200));
    params.push(Math.max(0, Number(filters.offset) || 0));
    const result = await this.pool.query(`
      SELECT *
      FROM object_links
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ${linkSortSql(filters.sortBy, filters.sortDirection)}
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `, params);
    return (result.rows || []).map(linkRow).filter(Boolean);
  }

  async deleteLink(id) {
    return this.pool.query(`DELETE FROM object_links WHERE id = $1`, [text(id)]);
  }

  async appendJournal(input = {}) {
    const row = normalizeJournal(input);
    await this.pool.query(`
      INSERT INTO object_journal (
        id, tenant_id, entity_id, entity_type, entity_key, user_id, entry_type, direction,
        amount, currency, happened_at, sort_order, data, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12,$13::jsonb,$14::timestamptz)
    `, [
      row.id,
      row.tenant_id,
      row.entity_id,
      row.entity_type,
      row.entity_key,
      row.user_id,
      row.entry_type,
      row.direction,
      row.amount,
      row.currency,
      row.happened_at,
      row.sort_order,
      JSON.stringify(row.data || {}),
      row.created_at,
    ]);
    return this.getJournalEntry(row.id);
  }

  async getJournalEntry(id) {
    const result = await this.pool.query(`SELECT * FROM object_journal WHERE id = $1 LIMIT 1`, [text(id)]);
    return journalRow(result.rows?.[0]);
  }

  async listJournal(filters = {}) {
    const params = [];
    const where = [];
    const push = (sql, value) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (filters.tenantId || filters.tenant_id) push("tenant_id = ?", text(filters.tenantId || filters.tenant_id));
    if (filters.entityId || filters.entity_id) push("entity_id = ?", text(filters.entityId || filters.entity_id));
    if (filters.entityType || filters.entity_type) push("entity_type = ?", text(filters.entityType || filters.entity_type));
    if (filters.entityKey || filters.entity_key) push("entity_key = ?", text(filters.entityKey || filters.entity_key));
    if (filters.userId || filters.user_id) push("user_id = ?", text(filters.userId || filters.user_id));
    if (filters.entryType || filters.entry_type) push("entry_type = ?", text(filters.entryType || filters.entry_type));
    if (filters.search || filters.q) push("CAST(data AS TEXT) ILIKE ?", `%${text(filters.search || filters.q).toLowerCase()}%`);
    params.push(Math.max(1, Number(filters.limit) || 200));
    params.push(Math.max(0, Number(filters.offset) || 0));
    const result = await this.pool.query(`
      SELECT *
      FROM object_journal
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ${journalSortSql(filters.sortBy, filters.sortDirection)}
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `, params);
    return (result.rows || []).map(journalRow).filter(Boolean);
  }

  async upsertProcess(input = {}) {
    const row = normalizeProcess(input);
    await this.pool.query(`
      INSERT INTO object_processes (
        id, tenant_id, process_type, topic, entity_id, entity_type, entity_key, user_id,
        status, priority, attempt_count, max_attempts, run_at, locked_at, locked_by,
        last_error, payload, result, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14::timestamptz,$15,$16,$17::jsonb,$18::jsonb,$19::timestamptz,$20::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        process_type = EXCLUDED.process_type,
        topic = EXCLUDED.topic,
        entity_id = EXCLUDED.entity_id,
        entity_type = EXCLUDED.entity_type,
        entity_key = EXCLUDED.entity_key,
        user_id = EXCLUDED.user_id,
        status = EXCLUDED.status,
        priority = EXCLUDED.priority,
        attempt_count = EXCLUDED.attempt_count,
        max_attempts = EXCLUDED.max_attempts,
        run_at = EXCLUDED.run_at,
        locked_at = EXCLUDED.locked_at,
        locked_by = EXCLUDED.locked_by,
        last_error = EXCLUDED.last_error,
        payload = EXCLUDED.payload,
        result = EXCLUDED.result,
        updated_at = EXCLUDED.updated_at
    `, [
      row.id,
      row.tenant_id,
      row.process_type,
      row.topic,
      row.entity_id,
      row.entity_type,
      row.entity_key,
      row.user_id,
      row.status,
      row.priority,
      row.attempt_count,
      row.max_attempts,
      row.run_at,
      row.locked_at,
      row.locked_by,
      row.last_error,
      JSON.stringify(row.payload || {}),
      JSON.stringify(row.result || {}),
      row.created_at,
      row.updated_at,
    ]);
    return this.getProcess(row.id);
  }

  async getProcess(id) {
    const result = await this.pool.query(`SELECT * FROM object_processes WHERE id = $1 LIMIT 1`, [text(id)]);
    return processRow(result.rows?.[0]);
  }

  async listProcesses(filters = {}) {
    const params = [];
    const where = [];
    const push = (sql, value) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (filters.tenantId || filters.tenant_id) push("tenant_id = ?", text(filters.tenantId || filters.tenant_id));
    if (filters.processType || filters.process_type) push("process_type = ?", text(filters.processType || filters.process_type));
    if (filters.topic) push("topic = ?", text(filters.topic));
    if (filters.entityId || filters.entity_id) push("entity_id = ?", text(filters.entityId || filters.entity_id));
    if (filters.userId || filters.user_id) push("user_id = ?", text(filters.userId || filters.user_id));
    if (filters.status) push("status = ?", text(filters.status).toUpperCase());
    if (filters.dueOnly) push("run_at <= ?", text(filters.now || nowIso()));
    params.push(Math.max(1, Number(filters.limit) || 200));
    params.push(Math.max(0, Number(filters.offset) || 0));
    const result = await this.pool.query(`
      SELECT *
      FROM object_processes
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ${processSortSql(filters.sortBy, filters.sortDirection)}
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `, params);
    return (result.rows || []).map(processRow).filter(Boolean);
  }
}

function createUniversalStoreAdapter(options = {}) {
  const backend = text(
    options.provider || options.backend || options.storageBackend || "sqlite",
    "sqlite",
  ).toLowerCase();
  if (backend === "postgres") return new PostgresUniversalStoreAdapter(options);
  return new SqliteUniversalStoreAdapter(options);
}

module.exports = {
  createUniversalStoreAdapter,
  normalizeEntity,
  normalizeLink,
  normalizeJournal,
  normalizeProcess,
  defaultEntitySearchText,
};
