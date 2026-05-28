// Drizzle ORM query functions — typed replacements for raw SQL
// Each function mirrors the existing mt5Backend method exactly

const { eq, ilike, or, and, gte, lte, inArray, desc, sql, count } = require("drizzle-orm");
const schema = require("./schema.js");

/**
 * listTradesV2 — Drizzle equivalent
 * Mirrors: webhook/server.js L10710 listTradesV2()
 */
async function listTradesV2(db, filters = {}, page = 1, pageSize = 50) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Math.min(200, Number(pageSize) || 50));
  const offset = (safePage - 1) * safePageSize;

  const conditions = [];

  // sids filter
  const sids = Array.isArray(filters.sids)
    ? filters.sids.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  if (sids.length) {
    conditions.push(inArray(schema.trades.sid, sids));
  }

  if (filters.user_id) {
    conditions.push(eq(schema.trades.userId, filters.user_id));
  }
  if (filters.account_id) {
    conditions.push(eq(schema.trades.accountId, filters.account_id));
  }
  if (filters.source_id) {
    conditions.push(eq(schema.trades.sourceId, filters.source_id));
  }
  if (filters.dispatch_status) {
    conditions.push(eq(schema.trades.dispatchStatus, filters.dispatch_status));
  }
  if (filters.execution_status) {
    conditions.push(eq(schema.trades.executionStatus, filters.execution_status));
  }
  if (filters.created_from) {
    conditions.push(gte(schema.trades.createdAt, new Date(filters.created_from)));
  }
  if (filters.created_to) {
    conditions.push(lte(schema.trades.createdAt, new Date(filters.created_to)));
  }
  if (filters.symbol) {
    conditions.push(eq(schema.trades.symbol, filters.symbol));
  }
  const actionFilter = filters.action || filters.side;
  if (actionFilter) {
    conditions.push(eq(schema.trades.action, actionFilter));
  }
  if (filters.entry_model) {
    conditions.push(eq(schema.trades.entryModel, filters.entry_model));
  }
  if (filters.chart_tf) {
    conditions.push(eq(schema.trades.chartTf, filters.chart_tf));
  }
  if (filters.q) {
    const q = `%${String(filters.q)}%`;
    conditions.push(
      or(
        ilike(schema.trades.sid, q),
        ilike(schema.trades.brokerTradeId, q),
        ilike(schema.trades.symbol, q),
        ilike(schema.trades.accountId, q),
        ilike(schema.trades.sourceId, q),
        ilike(schema.trades.action, q),
        ilike(schema.trades.entryModel, q),
        ilike(schema.trades.note, q),
      ),
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;

  // Count
  const countRes = await db
    .select({ count: count() })
    .from(schema.trades)
    .where(where);
  const total = Number(countRes[0]?.count || 0);

  // Query
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
    items,
    total,
    page: safePage,
    pageSize: safePageSize,
  };
}

/**
 * listSignals — Drizzle equivalent
 * Mirrors: webhook/server.js listSignals()
 */
async function listSignals(db, filters = {}) {
  const conditions = [];

  if (filters.symbol) {
    conditions.push(eq(schema.signals.symbol, filters.symbol));
  }
  if (filters.status) {
    conditions.push(eq(schema.signals.status, filters.status));
  }
  if (filters.source) {
    conditions.push(eq(schema.signals.source, filters.source));
  }
  if (filters.side) {
    conditions.push(eq(schema.signals.side, filters.side));
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const items = await db
    .select()
    .from(schema.signals)
    .where(where)
    .orderBy(desc(schema.signals.createdAt))
    .limit(200);

  return items;
}

module.exports = {
  listTradesV2,
  listSignals,
};
