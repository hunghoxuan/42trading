const { eq, ilike, or, and, gte, lte, inArray, desc, sql, count } = require("drizzle-orm");
const schema = require("./schema.js");

async function listTradesV2(db, filters = {}, page = 1, pageSize = 50) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Math.min(200, Number(pageSize) || 50));
  const offset = (safePage - 1) * safePageSize;
  const conditions = [];
  const sids = Array.isArray(filters.sids) ? filters.sids.map((v) => String(v || "").trim()).filter(Boolean) : [];
  if (sids.length) conditions.push(inArray(schema.trades.sid, sids));
  if (filters.user_id) conditions.push(eq(schema.trades.userId, filters.user_id));
  if (filters.account_id) conditions.push(eq(schema.trades.accountId, filters.account_id));
  if (filters.source_id) conditions.push(eq(schema.trades.sourceId, filters.source_id));
  if (filters.dispatch_status) conditions.push(eq(schema.trades.dispatchStatus, filters.dispatch_status));
  if (filters.execution_status) conditions.push(eq(schema.trades.executionStatus, filters.execution_status));
  if (filters.created_from) conditions.push(gte(schema.trades.createdAt, new Date(filters.created_from)));
  if (filters.created_to) conditions.push(lte(schema.trades.createdAt, new Date(filters.created_to)));
  if (filters.symbol) conditions.push(eq(schema.trades.symbol, filters.symbol));
  if (filters.action || filters.side) conditions.push(eq(schema.trades.action, filters.action || filters.side));
  if (filters.entry_model) conditions.push(eq(schema.trades.entryModel, filters.entry_model));
  if (filters.chart_tf) conditions.push(eq(schema.trades.chartTf, filters.chart_tf));
  if (filters.q) {
    const q = "%" + String(filters.q) + "%";
    conditions.push(or(ilike(schema.trades.sid, q), ilike(schema.trades.brokerTradeId, q), ilike(schema.trades.symbol, q), ilike(schema.trades.accountId, q), ilike(schema.trades.sourceId, q), ilike(schema.trades.action, q), ilike(schema.trades.entryModel, q), ilike(schema.trades.note, q)));
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const countRes = await db.select({ count: count() }).from(schema.trades).where(where);
  const items = await db.select().from(schema.trades).where(where).orderBy(desc(sql`COALESCE(${schema.trades.closedAt}, ${schema.trades.updatedAt})`), desc(schema.trades.createdAt)).limit(safePageSize).offset(offset);
  return { items, total: Number(countRes[0]?.count || 0), page: safePage, pageSize: safePageSize };
}

async function listSignals(db, filters = {}) {
  const conditions = [];
  if (filters.symbol) conditions.push(eq(schema.signals.symbol, filters.symbol));
  if (filters.status) conditions.push(eq(schema.signals.status, filters.status));
  if (filters.source) conditions.push(eq(schema.signals.source, filters.source));
  if (filters.side) conditions.push(eq(schema.signals.side, filters.side));
  const where = conditions.length ? and(...conditions) : undefined;
  return db.select().from(schema.signals).where(where).orderBy(desc(schema.signals.createdAt)).limit(200);
}

async function listUserAccounts(db, userId) {
  return db.select().from(schema.userAccounts).where(eq(schema.userAccounts.userId, String(userId || ""))).orderBy(schema.userAccounts.createdAt, schema.userAccounts.accountId);
}

async function upsertSignal(db, signal) {
  const v = { sid: signal.sid, createdAt: signal.created_at ? new Date(signal.created_at) : new Date(), userId: signal.user_id, symbol: signal.symbol, side: signal.side, source: signal.source || null, sourceId: signal.source_id || null, orderType: signal.order_type || null, entry: signal.entry != null ? Number(signal.entry) : null, sl: signal.sl != null ? Number(signal.sl) : null, tp: signal.tp != null ? Number(signal.tp) : null, strategy: signal.strategy || null, entryModel: signal.entry_model || null, signalTf: signal.signal_tf || null, chartTf: signal.chart_tf || null, rrPlanned: signal.rr_planned != null ? Number(signal.rr_planned) : null, riskMoneyPlanned: signal.risk_money_planned != null ? Number(signal.risk_money_planned) : null, riskPctPlanned: signal.risk_pct_planned != null ? Number(signal.risk_pct_planned) : null, note: signal.note || null, rejectionReason: signal.rejection_reason || null, rawJson: signal.raw_json || null, status: signal.status || "NEW", profile: signal.profile || null, confidencePct: signal.confidence_pct != null ? Number(signal.confidence_pct) : null, estimatedBars: signal.estimated_bars != null ? Number(signal.estimated_bars) : null, beTrigger: signal.be_trigger != null ? Number(signal.be_trigger) : null };
  try { await db.insert(schema.signals).values(v); return { sid: signal.sid }; }
  catch (e) { if (e.message?.includes("duplicate key") || e.code === "23505") return { sid: signal.sid, existed: true }; throw e; }
}

async function findAccountByApiKeyHash(db, apiKeyHash) {
  const rows = await db.select().from(schema.userAccounts).where(eq(schema.userAccounts.apiKeyHash, apiKeyHash)).limit(1);
  return rows[0] || null;
}

async function upsertUserAccount(db, userId, account) {
  const now = new Date();
  const rows = await db.insert(schema.userAccounts).values({ accountId: String(account?.account_id || ""), userId: String(userId || ""), name: String(account?.name || ""), balance: account?.balance != null && !Number.isNaN(Number(account.balance)) ? Number(account.balance) : null, status: String(account?.status || ""), metadata: account?.metadata || null, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: schema.userAccounts.accountId, set: { userId: sql`EXCLUDED.user_id`, name: sql`EXCLUDED.name`, balance: sql`EXCLUDED.balance`, status: sql`EXCLUDED.status`, metadata: sql`EXCLUDED.metadata`, updatedAt: now } }).returning();
  return rows[0] || null;
}

async function listUiUsers(db) { return db.select().from(schema.users).orderBy(schema.users.createdAt, schema.users.userId); }

async function deleteUserAccount(db, userId, accountId) {
  return db.delete(schema.userAccounts).where(and(eq(schema.userAccounts.userId, String(userId || "")), eq(schema.userAccounts.accountId, String(accountId || ""))));
}

async function listAllEvents(db, filters = {}, limit = 200) {
  const conditions = [];
  if (filters.object_id) conditions.push(eq(schema.logs.objectId, filters.object_id));
  if (filters.user_id) conditions.push(eq(schema.logs.userId, filters.user_id));
  if (filters.symbol) conditions.push(eq(schema.logs.symbol, filters.symbol));
  const where = conditions.length ? and(...conditions) : undefined;
  return db.select().from(schema.logs).where(where).orderBy(desc(schema.logs.createdAt)).limit(limit);
}

async function listActiveSignals(db, userId) {
  return db.select().from(schema.signals).where(and(eq(schema.signals.userId, String(userId || "")), eq(schema.signals.status, "ACTIVE"))).orderBy(desc(schema.signals.createdAt));
}

async function getSignalByTicket(db, ticket) {
  const rows = await db.select().from(schema.signals).where(eq(schema.signals.sid, String(ticket || ""))).limit(1);
  return rows[0] || null;
}

async function bulkAckSignals(db, ids) {
  if (!Array.isArray(ids) || !ids.length) return { count: 0 };
  return db.update(schema.signals).set({ status: "ACKED" }).where(inArray(schema.signals.sid, ids));
}

async function cancelSignalsByIds(db, ids) {
  if (!Array.isArray(ids) || !ids.length) return { count: 0 };
  return db.update(schema.signals).set({ status: "CANCELLED" }).where(inArray(schema.signals.sid, ids));
}

async function deleteSignalsByIds(db, ids) {
  if (!Array.isArray(ids) || !ids.length) return { count: 0 };
  return db.delete(schema.signals).where(inArray(schema.signals.sid, ids));
}

module.exports = { listTradesV2, listSignals, listUserAccounts, upsertSignal, findAccountByApiKeyHash, upsertUserAccount, listUiUsers, deleteUserAccount, listAllEvents, listActiveSignals, getSignalByTicket, bulkAckSignals, cancelSignalsByIds, deleteSignalsByIds };

async function findSignalById(db, id) {
  const rows = await db.select().from(schema.signals).where(eq(schema.signals.sid, String(id || ""))).limit(1);
  return rows[0] || null;
}

async function pruneOldSignals(db, days = 14) {
  const cutoff = new Date(Date.now() - days * 86400000);
  return db.delete(schema.signals).where(and(lte(schema.signals.createdAt, cutoff), eq(schema.signals.status, "CANCELLED")));
}

module.exports = Object.assign(module.exports, { findSignalById, pruneOldSignals });
