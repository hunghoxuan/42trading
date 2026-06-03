const {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  serial,
  uuid,
  uniqueIndex,
} = require("drizzle-orm/pg-core");

const users = pgTable("users", {
  userId: text("user_id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  passwordSalt: text("password_salt"),
  role: text("role"),
  isActive: boolean("is_active").default(true),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

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
  sourceIdsCache: text("source_ids_cache"),
  metadata: text("metadata"),
  status: text("status"),
  equity: doublePrecision("equity"),
  margin: doublePrecision("margin"),
  freeMargin: doublePrecision("free_margin"),
  leverage: doublePrecision("leverage"),
  brokerName: text("broker_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

const userTemplates = pgTable("user_templates", {
  id: serial("id").primaryKey(),
  userId: text("user_id").references(() => users.userId, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  data: text("data").notNull(),
  status: text("status").default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

const userSettings = pgTable(
  "user_settings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    name: text("name").notNull().default("default"),
    type: text("type").notNull(),
    data: text("data").notNull(),
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

const trades = pgTable("trades", {
  sid: text("sid").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => userAccounts.accountId, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),
  signalId: text("signal_id"),
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
  confluenceChecklist: text("confluence_checklist"),
  skipRecommendation: text("skip_recommendation"),
  riskManagement: text("risk_management"),
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
  plannedTpPnl: doublePrecision("planned_tp_pnl"),
  plannedSlPnl: doublePrecision("planned_sl_pnl"),
  brokerTpPnl: doublePrecision("broker_tp_pnl"),
  brokerSlPnl: doublePrecision("broker_sl_pnl"),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  pnlRealized: doublePrecision("pnl_realized"),
  metadata: text("metadata"),
  rawJson: text("raw_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

module.exports = {
  users,
  userAccounts,
  userTemplates,
  userSettings,
  trades,
};
