const {
  eq,
  like,
  or,
  and,
  gte,
  lte,
  inArray,
  desc,
  sql,
  count,
} = require("drizzle-orm");
const schemaModule = require("./schema.js");

function resolveBackend(db) {
  return String(db?._backend || "postgres").trim().toLowerCase();
}

function resolveSchema(db) {
  return db?._schema || schemaModule.getSchemaForBackend(resolveBackend(db));
}

function toDriverTimestamp(db, value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const raw = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(raw.getTime())) return fallback;
  return resolveBackend(db) === "sqlite" ? raw.toISOString() : raw;
}

function toWriteValue(db, value) {
  if (value instanceof Date) {
    return toDriverTimestamp(db, value, null);
  }
  return value;
}

function toSnake(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase())] = value;
  }
  return out;
}

function rowsSnake(rows) {
  return Array.isArray(rows) ? rows.map(toSnake) : rows;
}

async function listTradesV2(db, filters = {}, page = 1, pageSize = 50) {
  const schema = resolveSchema(db);
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Math.min(200, Number(pageSize) || 50));
  const offset = (safePage - 1) * safePageSize;
  const conditions = [];
  const sids = Array.isArray(filters.sids)
    ? filters.sids.map((v) => String(v || "").trim()).filter(Boolean)
    : [];

  if (sids.length) conditions.push(inArray(schema.trades.sid, sids));
  if (filters.user_id) conditions.push(eq(schema.trades.userId, filters.user_id));
  if (filters.account_id) {
    conditions.push(eq(schema.trades.accountId, filters.account_id));
  }
  if (filters.source_id) conditions.push(eq(schema.trades.sourceId, filters.source_id));
  if (filters.dispatch_status) {
    conditions.push(eq(schema.trades.dispatchStatus, filters.dispatch_status));
  }
  if (filters.execution_status) {
    conditions.push(eq(schema.trades.executionStatus, filters.execution_status));
  }
  if (filters.created_from) {
    conditions.push(
      gte(schema.trades.createdAt, toDriverTimestamp(db, filters.created_from)),
    );
  }
  if (filters.created_to) {
    conditions.push(
      lte(schema.trades.createdAt, toDriverTimestamp(db, filters.created_to)),
    );
  }
  if (filters.symbol) conditions.push(eq(schema.trades.symbol, filters.symbol));
  if (filters.action || filters.side) {
    conditions.push(eq(schema.trades.action, filters.action || filters.side));
  }
  if (filters.entry_model) {
    conditions.push(eq(schema.trades.entryModel, filters.entry_model));
  }
  if (filters.chart_tf) conditions.push(eq(schema.trades.chartTf, filters.chart_tf));
  if (filters.q) {
    const q = `%${String(filters.q)}%`;
    conditions.push(
      or(
        like(schema.trades.sid, q),
        like(schema.trades.brokerTradeId, q),
        like(schema.trades.symbol, q),
        like(schema.trades.accountId, q),
        like(schema.trades.sourceId, q),
        like(schema.trades.action, q),
        like(schema.trades.entryModel, q),
        like(schema.trades.note, q),
      ),
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const countRes = await db
    .select({ count: count() })
    .from(schema.trades)
    .where(where);

  const items = await db
    .select()
    .from(schema.trades)
    .where(where)
    .orderBy(
      desc(sql`COALESCE(${schema.trades.closedAt}, ${schema.trades.updatedAt})`),
      desc(schema.trades.createdAt),
    )
    .limit(safePageSize)
    .offset(offset);

  return {
    items: rowsSnake(items),
    total: Number(countRes[0]?.count || 0),
    page: safePage,
    pageSize: safePageSize,
  };
}

async function listUiUsers(db) {
  const schema = resolveSchema(db);
  return rowsSnake(
    await db
      .select()
      .from(schema.users)
      .orderBy(schema.users.createdAt, schema.users.userId),
  );
}

async function getUserMetadata(db, userId) {
  const schema = resolveSchema(db);
  const rows = await db
    .select({ metadata: schema.users.metadata })
    .from(schema.users)
    .where(eq(schema.users.userId, userId))
    .limit(1);
  return rows[0]?.metadata || null;
}

async function updateUserMetadata(db, userId, metadata) {
  const schema = resolveSchema(db);
  return db
    .update(schema.users)
    .set({
      metadata,
      updatedAt: toDriverTimestamp(db, new Date()),
    })
    .where(eq(schema.users.userId, userId));
}

async function promoteDraftTrade(db, tradeRef, userId) {
  const schema = resolveSchema(db);
  const conditions = [eq(schema.trades.sid, tradeRef)];
  if (userId) conditions.push(eq(schema.trades.userId, userId));
  return db
    .update(schema.trades)
    .set({
      executionStatus: "PENDING",
      dispatchStatus: "OPEN",
      updatedAt: toDriverTimestamp(db, new Date()),
    })
    .where(and(...conditions))
    .returning();
}

function jsonField(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
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

module.exports = {
  listTradesV2,
  listUiUsers,
  getUserMetadata,
  updateUserMetadata,
  promoteDraftTrade,
  jsonField,
  parseJsonField,
  resolveSchema,
  resolveBackend,
  toDriverTimestamp,
  toWriteValue,
};
