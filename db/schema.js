// Drizzle ORM schema — all 10 tables
// mirrors existing PostgreSQL schema exactly

const {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  serial,
  uuid,
  uniqueIndex,
} = require("drizzle-orm/pg-core");

// ── users ──
const users = pgTable("users", {
  userId: text("user_id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  passwordSalt: text("password_salt"),
  role: text("role"),
  isActive: boolean("is_active").default(true),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── user_accounts ──
const userAccounts = pgTable("user_accounts", {
  accountId: text("account_id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),
  name: text("name"),
  balance: doublePrecision("balance"),
  apiKeyHash: text("api_key_hash"),
  apiKeyLast4: text("api_key_last4"),
  apiKeyRotatedAt: timestamp("api_key_rotated_at", { withTimezone: true }),
  sourceIdsCache: jsonb("source_ids_cache"),
  metadata: jsonb("metadata"),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── user_templates ──
const userTemplates = pgTable("user_templates", {
  id: serial("id").primaryKey(),
  userId: text("user_id").references(() => users.userId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  data: jsonb("data").notNull(),
  status: text("status").default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── user_settings ──
const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    name: text("name").notNull().default("default"),
    type: text("type").notNull(),
    data: jsonb("data").notNull(),
    status: text("status").default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniqueUserTypeName: uniqueIndex("idx_user_settings_user_type_name").on(
      table.userId,
      table.type,
      table.name,
    ),
  }),
);

// ── signals ──
const signals = pgTable("signals", {
  sid: text("sid").primaryKey(),
  id: serial("id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),
  source: text("source"),
  sourceId: text("source_id"),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  orderType: text("order_type"),
  entry: doublePrecision("entry"),
  entryModel: text("entry_model"),
  strategy: text("strategy"),
  sl: doublePrecision("sl"),
  tp: doublePrecision("tp"),
  signalTf: text("signal_tf"),
  chartTf: text("chart_tf"),
  rrPlanned: doublePrecision("rr_planned"),
  riskPctPlanned: doublePrecision("risk_pct_planned"),
  riskMoneyPlanned: doublePrecision("risk_money_planned"),
  note: text("note"),
  rejectionReason: text("rejection_reason"),
  rawJson: jsonb("raw_json"),
  status: text("status").default("NEW"),
  profile: text("profile"),
  confidencePct: doublePrecision("confidence_pct"),
  estimatedBars: integer("estimated_bars"),
  beTrigger: doublePrecision("be_trigger"),
});

// ── trades ──
const trades = pgTable("trades", {
  sid: text("sid").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => userAccounts.accountId, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),
  signalId: text("signal_id").references(() => signals.sid, {
    onDelete: "set null",
  }),
  sourceId: text("source_id"),
  strategy: text("strategy"),
  entryModel: text("entry_model"),
  signalTf: text("signal_tf"),
  chartTf: text("chart_tf"),
  symbol: text("symbol").notNull(),
  action: text("action").notNull(),
  orderType: text("order_type"),
  volume: doublePrecision("volume"),
  entry: doublePrecision("entry"),
  sl: doublePrecision("sl"),
  tp: doublePrecision("tp"),
  tp1: doublePrecision("tp1"),
  tp2: doublePrecision("tp2"),
  tp3: doublePrecision("tp3"),
  rrPlanned: doublePrecision("rr_planned"),
  riskPctPlanned: doublePrecision("risk_pct_planned"),
  riskMoneyPlanned: doublePrecision("risk_money_planned"),
  confidencePct: doublePrecision("confidence_pct"),
  estimatedBars: integer("estimated_bars"),
  beTrigger: doublePrecision("be_trigger"),
  profile: text("profile"),
  invalidation: text("invalidation"),
  entryCondition: text("entry_condition"),
  exitCondition: text("exit_condition"),
  confluenceChecklist: jsonb("confluence_checklist"),
  skipRecommendation: text("skip_recommendation"),
  riskManagement: jsonb("risk_management"),
  note: text("note"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  dispatchStatus: text("dispatch_status").notNull().default("NEW"),
  executionStatus: text("execution_status").notNull().default("PENDING"),
  closeReason: text("close_reason"),
  rejectionReason: text("rejection_reason"),
  brokerTradeId: text("broker_trade_id"),
  entryExec: doublePrecision("entry_exec"),
  brokerPips: doublePrecision("broker_pips"),
  brokerLots: doublePrecision("broker_lots"),
  brokerCommission: doublePrecision("broker_commission"),
  brokerSwap: doublePrecision("broker_swap"),
  brokerVolume: doublePrecision("broker_volume"),
  brokerPnl: doublePrecision("broker_pnl"),
  brokerMargin: doublePrecision("broker_margin"),
  brokerTpPnl: doublePrecision("broker_tp_pnl"),
  brokerSlPnl: doublePrecision("broker_sl_pnl"),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  pnlRealized: doublePrecision("pnl_realized"),
  metadata: jsonb("metadata"),
  rawJson: jsonb("raw_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── logs ──
const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  eventType: text("event_type"),
  objectType: text("object_type"),
  objectId: text("object_id"),
  userId: text("user_id"),
  eventTime: timestamp("event_time", { withTimezone: true }),
  data: jsonb("data"),
  metadata: jsonb("metadata"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── market_data ──
const marketData = pgTable("market_data", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  bars: jsonb("bars"),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── ui_auth_users ── (legacy — table dropped by migration)

module.exports = {
  users,
  userAccounts,
  userTemplates,
  userSettings,
  signals,
  trades,
  logs,
  marketData,
};
