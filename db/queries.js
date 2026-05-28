const { eq, like, or, and, gte, lte, inArray, desc, sql, count } = require("drizzle-orm");
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
    conditions.push(or(like(schema.trades.sid, q), like(schema.trades.brokerTradeId, q), like(schema.trades.symbol, q), like(schema.trades.accountId, q), like(schema.trades.sourceId, q), like(schema.trades.action, q), like(schema.trades.entryModel, q), like(schema.trades.note, q)));
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
  const v = { sid: signal.sid, createdAt: signal.created_at ? new Date(signal.created_at) : new Date(), userId: signal.user_id, symbol: signal.symbol, side: signal.side, source: signal.source || null, sourceId: signal.source_id || null, orderType: signal.order_type || null, entry: signal.entry != null ? Number(signal.entry) : null, sl: signal.sl != null ? Number(signal.sl) : null, tp: signal.tp != null ? Number(signal.tp) : null, strategy: signal.strategy || null, entryModel: signal.entry_model || null, signalTf: signal.signal_tf || null, chartTf: signal.chart_tf || null, rrPlanned: signal.rr_planned != null ? Number(signal.rr_planned) : null, riskMoneyPlanned: signal.risk_money_planned != null ? Number(signal.risk_money_planned) : null, riskPctPlanned: signal.risk_pct_planned != null ? Number(signal.risk_pct_planned) : null, note: signal.note || null, rejectionReason: signal.rejection_reason || null, rawJson: jsonField(signal.raw_json), metadata: jsonField(signal.metadata), status: signal.status || "NEW", profile: signal.profile || null, confidencePct: signal.confidence_pct != null ? Number(signal.confidence_pct) : null, estimatedBars: signal.estimated_bars != null ? Number(signal.estimated_bars) : null, beTrigger: signal.be_trigger != null ? Number(signal.be_trigger) : null };
  try { await db.insert(schema.signals).values(v); return { sid: signal.sid }; }
  catch (e) { if (e.message?.includes("duplicate key") || e.code === "23505") return { sid: signal.sid, existed: true }; throw e; }
}

async function findAccountByApiKeyHash(db, apiKeyHash) {
  const rows = await db.select().from(schema.userAccounts).where(eq(schema.userAccounts.apiKeyHash, apiKeyHash)).limit(1);
  return rows[0] || null;
}

async function upsertUserAccount(db, userId, account) {
  const now = new Date();
  const rows = await db.insert(schema.userAccounts).values({ accountId: String(account?.account_id || ""), userId: String(userId || ""), name: String(account?.name || ""), balance: account?.balance != null && !Number.isNaN(Number(account.balance)) ? Number(account.balance) : null, status: String(account?.status || ""), metadata: jsonField(account?.metadata), createdAt: now, updatedAt: now })
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

// ── Admin helpers (used in server.js route handlers) ──

async function deleteUserTemplate(db, id) {
  return db.delete(schema.userTemplates).where(eq(schema.userTemplates.id, Number(id)));
}

async function getUserTemplate(db, id) {
  const rows = await db.select().from(schema.userTemplates).where(eq(schema.userTemplates.id, Number(id))).limit(1);
  return rows[0] || null;
}

async function getUserTemplateData(db, id) {
  const rows = await db.select({ data: schema.userTemplates.data }).from(schema.userTemplates).where(eq(schema.userTemplates.id, Number(id))).limit(1);
  return rows[0]?.data || null;
}

module.exports = Object.assign(module.exports, { deleteUserTemplate, getUserTemplate, getUserTemplateData });

// ── user_settings helpers (most common pattern) ──

async function getUserSetting(db, userId, type, name) {
  const rows = await db.select().from(schema.userSettings)
    .where(and(eq(schema.userSettings.userId, userId), eq(schema.userSettings.type, type), eq(schema.userSettings.name, name || "default")))
    .limit(1);
  return rows[0] || null;
}

async function getUserSettingData(db, userId, type, name) {
  const rows = await db.select({ data: schema.userSettings.data }).from(schema.userSettings)
    .where(and(eq(schema.userSettings.userId, userId), eq(schema.userSettings.type, type), eq(schema.userSettings.name, name || "default")))
    .limit(1);
  return rows[0]?.data || null;
}

async function listUserSettingsByType(db, userId, type) {
  const conditions = [];
  if (type) conditions.push(eq(schema.userSettings.type, type));
  if (userId) conditions.push(eq(schema.userSettings.userId, userId));
  return db.select().from(schema.userSettings).where(and(...conditions)).orderBy(schema.userSettings.name);
}

async function upsertUserSetting(db, userId, type, name, data, status) {
  const now = new Date();
  return db.insert(schema.userSettings).values({
    userId, type, name: name || "default", data: jsonField(data),
    status: status || "ACTIVE", createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: [schema.userSettings.userId, schema.userSettings.type, schema.userSettings.name],
    set: { data: sql`EXCLUDED.data`, status: sql`EXCLUDED.status`, updatedAt: now },
  }).returning();
}

async function deleteUserSetting(db, userId, type, name) {
  return db.delete(schema.userSettings)
    .where(and(eq(schema.userSettings.userId, userId), eq(schema.userSettings.type, type), eq(schema.userSettings.name, name || "default")));
}

// ── users helpers ──

async function getUserMetadata(db, userId) {
  const rows = await db.select({ metadata: schema.users.metadata }).from(schema.users)
    .where(eq(schema.users.userId, userId)).limit(1);
  return rows[0]?.metadata || null;
}

async function updateUserMetadata(db, userId, metadata) {
  return db.update(schema.users).set({ metadata, updatedAt: new Date() })
    .where(eq(schema.users.userId, userId));
}

module.exports = Object.assign(module.exports, { getUserSetting, getUserSettingData, listUserSettingsByType, upsertUserSetting, deleteUserSetting, getUserMetadata, updateUserMetadata });

// ── Signal/trade resolution helpers ──

async function resolveSignalRef(db, numericId, sid, userId) {
  const conditions = [];
  if (numericId != null) conditions.push(eq(schema.signals.id, sql`${numericId}::bigint`));
  conditions.push(eq(schema.signals.sid, sid));
  if (userId) conditions.push(eq(schema.signals.userId, userId));
  const rows = await db.select({ id: schema.signals.id, sid: schema.signals.sid, userId: schema.signals.userId })
    .from(schema.signals).where(or(...conditions))
    .orderBy(desc(sql`COALESCE(${schema.signals.closedAt}, ${schema.signals.updatedAt})`)).limit(1);
  return rows[0] || null;
}

async function closeSignal(db, sid) {
  return db.update(schema.signals).set({ status: "CLOSED", updatedAt: new Date() }).where(eq(schema.signals.sid, sid));
}

async function promoteDraftTrade(db, tradeRef, userId) {
  const conditions = [eq(schema.trades.sid, tradeRef)];
  if (userId) conditions.push(eq(schema.trades.userId, userId));
  return db.update(schema.trades).set({ executionStatus: "PENDING", dispatchStatus: "NEW", updatedAt: new Date() })
    .where(and(...conditions)).returning();
}

module.exports = Object.assign(module.exports, { resolveSignalRef, closeSignal, promoteDraftTrade });

// ── JSON helpers (TEXT columns that store JSON) ──

function jsonField(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val;
  return JSON.stringify(val);
}

function parseJsonField(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch { return val; }
}

module.exports = Object.assign(module.exports, { jsonField, parseJsonField });
