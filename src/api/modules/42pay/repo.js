"use strict";
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const { createObjectStoreRepo } = require("../../shared/objects/objectStoreRepo");
const sqliteObjectStoreProvider = require("../../shared/objects/providers/sqliteObjectStoreProvider");
const { createUniversalStoreFacade } = require("../../shared/universal-store");

const PAY42_SCOPE = "__42pay__";
const PRODUCT_TYPE = "42pay_products";
const OFFER_TYPE = "42pay_product_offers";
const ORDER_TYPE = "42pay_product_orders";
const TOPUP_TYPE = "42pay_wallet_topups";
const USER_TYPE = "42pay_users";
const WALLET_TYPE = "user_account";
const WALLET_LINK_TYPE = "owns";
const PAY42_WALLET_CURRENCY = "USD";
const PAY42_SELLER_ID = "seller";
const PAY42_BUYER_ID = "user";
const LEGACY_PAY42_ACTOR_ID_MAP = Object.freeze({
  "42pay.seller": PAY42_SELLER_ID,
  "42pay.buyer": PAY42_BUYER_ID,
  "42pay.admin": "admin",
});

const SEEDED_PRODUCTS = [
  {
    sid: "P42P_MARINA_BAY_SUITES",
    name: "Grand Hyatt Singapore",
    image: "/pay42/grand-hyatt-singapore.jpg",
    type: "hotel",
    status: "ACTIVE",
    metadata: {
      category: "Luxury Hotel",
      city: "Singapore",
      country: "Singapore",
      nights: 2,
      seller_name: "Sofia Chen",
      description:
        "Renovated Orchard Road stay with club lounge access, pool deck, and breakfast for two.",
    },
    create_sid: PAY42_SELLER_ID,
  },
  {
    sid: "P42P_KYOTO_GARDEN_RYOKAN",
    name: "Park Hyatt Kyoto",
    image: "/pay42/park-hyatt-kyoto.jpg",
    type: "hotel",
    status: "ACTIVE",
    metadata: {
      category: "Luxury Hotel",
      city: "Kyoto",
      country: "Japan",
      nights: 1,
      seller_name: "Sofia Chen",
      description:
        "Higashiyama hillside stay with temple-view rooms, evening tea service, and curated dining.",
    },
    create_sid: PAY42_SELLER_ID,
  },
  {
    sid: "P42P_ALPINE_LAKE_RETREAT",
    name: "Whole Foods Market SoMa",
    image: "/pay42/whole-foods-soma.jpg",
    type: "supermarket",
    status: "ACTIVE",
    metadata: {
      category: "Supermarket",
      city: "San Francisco",
      country: "United States",
      nights: 0,
      seller_name: "Sofia Chen",
      description:
        "Premium grocery basket pickup with organic produce, bakery staples, and ready-to-eat meals.",
    },
    create_sid: PAY42_SELLER_ID,
  },
  {
    sid: "P42P_OLD_QUARTER_HERITAGE",
    name: "Carrefour City Louvre",
    image: "/pay42/carrefour-city-louvre.jpg",
    type: "supermarket",
    status: "ACTIVE",
    metadata: {
      category: "Supermarket",
      city: "Paris",
      country: "France",
      nights: 0,
      seller_name: "Sofia Chen",
      description:
        "Central neighbourhood grocery with fresh essentials, wine pairings, and family pantry bundles.",
    },
    create_sid: PAY42_SELLER_ID,
  },
];

const SEEDED_OFFERS = [
  {
    sid: "P42O_MARINA_BAY_2N",
    product_id: "P42P_MARINA_BAY_SUITES",
    price: 428,
    tax: 36.38,
    seller_id: PAY42_SELLER_ID,
    status: "ACTIVE",
    start_at: "2026-07-01T00:00:00.000Z",
    end_at: "2026-12-31T23:59:59.999Z",
    metadata: {
      currency: "USD",
      offer_name: "2-Night Club Room Escape",
      inventory: 20,
    },
  },
  {
    sid: "P42O_KYOTO_GARDEN_1N",
    product_id: "P42P_KYOTO_GARDEN_RYOKAN",
    price: 512,
    tax: 43.52,
    seller_id: PAY42_SELLER_ID,
    status: "ACTIVE",
    start_at: "2026-07-01T00:00:00.000Z",
    end_at: "2026-11-30T23:59:59.999Z",
    metadata: {
      currency: "USD",
      offer_name: "Temple View Night Stay",
      inventory: 12,
    },
  },
  {
    sid: "P42O_ALPINE_RETREAT_3N",
    product_id: "P42P_ALPINE_LAKE_RETREAT",
    price: 84.5,
    tax: 6.76,
    seller_id: PAY42_SELLER_ID,
    status: "ACTIVE",
    start_at: "2026-07-01T00:00:00.000Z",
    end_at: "2027-01-31T23:59:59.999Z",
    metadata: {
      currency: "USD",
      offer_name: "Weekly Pantry Basket",
      inventory: 8,
    },
  },
  {
    sid: "P42O_HANOI_HERITAGE_2N",
    product_id: "P42P_OLD_QUARTER_HERITAGE",
    price: 129,
    tax: 10.32,
    seller_id: PAY42_SELLER_ID,
    status: "ACTIVE",
    start_at: "2026-07-01T00:00:00.000Z",
    end_at: "2026-10-31T23:59:59.999Z",
    metadata: {
      currency: "USD",
      offer_name: "Weekend Family Essentials",
      inventory: 30,
    },
  },
];

const SEEDED_ORDERS = [];

function nowIso() {
  return new Date().toISOString();
}

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeRoles(values) {
  const source = Array.isArray(values) ? values : [values];
  return uniq(
    source.map((value) => {
      const raw = String(value || "").trim().toLowerCase();
      if (!raw) return "";
      if (raw === "user") return "buyer";
      return raw;
    }),
  );
}

function hasRole(actor = {}, roleId) {
  return normalizeRoles(actor.roles).includes(String(roleId || "").trim().toLowerCase());
}

function isAdmin(actor = {}) {
  return hasRole(actor, "admin");
}

function isSeller(actor = {}) {
  return isAdmin(actor) || hasRole(actor, "seller");
}

function isBuyer(actor = {}) {
  return isAdmin(actor) || hasRole(actor, "buyer");
}

function asNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function text(value, fallback = "") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function slugId(prefix, name = "") {
  const base = String(name || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return `${prefix}${base ? `_${base}` : ""}_${Date.now().toString(36).toUpperCase()}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function stableToken(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
}

function migrateLegacyActorId(value) {
  const raw = String(value || "").trim();
  return LEGACY_PAY42_ACTOR_ID_MAP[raw] || raw;
}

function uniqStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function resolve42PayProjectRoot(options = {}) {
  const explicit = String(options.projectRoot || "").trim();
  if (explicit) return explicit;
  return path.resolve(__dirname, "..", "..", "..", "..");
}

function resolve42PayObjectStoreOptions(options = {}) {
  const objectStoreOptions =
    options.objectStore && typeof options.objectStore === "object"
      ? { ...options.objectStore }
      : {};
  if (!objectStoreOptions.provider) objectStoreOptions.provider = "postgres";
  if (options.sqlitePath && !objectStoreOptions.sqlitePath) {
    objectStoreOptions.sqlitePath = options.sqlitePath;
  }
  if (options.postgresUrl && !objectStoreOptions.postgresUrl) {
    objectStoreOptions.postgresUrl = options.postgresUrl;
  }
  if (options.cache && !objectStoreOptions.cache) {
    objectStoreOptions.cache = options.cache;
  }
  return objectStoreOptions;
}

function resolveLegacy42PaySqlitePath(options = {}) {
  const explicit = String(options.legacySqlitePath || options.sqlitePath || "").trim();
  if (explicit) return explicit;
  return sqliteObjectStoreProvider.resolveObjectStoreSqlitePath(
    PAY42_SCOPE,
    resolve42PayObjectStoreOptions(options),
  );
}

function resolveLegacy42PayJsonDataRoots(options = {}) {
  const explicit = Array.isArray(options.legacyJsonDataRoots)
    ? options.legacyJsonDataRoots
    : [];
  const objectStoreOptions = resolve42PayObjectStoreOptions(options);
  const projectRoot = resolve42PayProjectRoot(options);
  return uniqStrings(
    [
      ...explicit,
      objectStoreOptions.dataRoot,
      path.join(projectRoot, "src", "data", "users"),
    ].map((value) => String(value || "").trim()),
  );
}

function objectStore(options = {}) {
  return createObjectStoreRepo(resolve42PayObjectStoreOptions(options));
}

function universalStore(options = {}) {
  const objectStoreOptions = resolve42PayObjectStoreOptions(options);
  return createUniversalStoreFacade({
    provider: objectStoreOptions.provider,
    sqlitePath: objectStoreOptions.sqlitePath || options.sqlitePath,
    postgresUrl: objectStoreOptions.postgresUrl || options.postgresUrl,
  });
}

function legacySqliteStore(options = {}) {
  return createObjectStoreRepo({
    provider: "sqlite",
    sqlitePath: resolveLegacy42PaySqlitePath(options),
    ...(options.cache && typeof options.cache === "object"
      ? { cache: options.cache }
      : {}),
  });
}

async function listType(repo, type) {
  const rows = await repo.listEntities({
    tenantId: PAY42_SCOPE,
    entityType: type,
    limit: 10000,
  });
  return rows
    .map((row) => (row && row.data && typeof row.data === "object" ? row.data : null))
    .filter(Boolean);
}

async function putType(repo, type, sid, data) {
  const payload =
    data && typeof data === "object" ? clone(data) : {};
  const normalizedType = String(type || "").trim();
  const isPublicCatalogEntity =
    normalizedType === PRODUCT_TYPE || normalizedType === OFFER_TYPE;
  const category = text(
    payload.metadata?.category ||
      payload.type ||
      payload.method ||
      payload.account_type,
  ).toLowerCase();
  const subtype = text(
    normalizedType === PRODUCT_TYPE
      ? payload.type
      : normalizedType === OFFER_TYPE
        ? "offer"
        : normalizedType === ORDER_TYPE
          ? "order"
          : normalizedType === TOPUP_TYPE
            ? "topup"
            : "",
  ).toLowerCase();
  const currency = text(
    payload.metadata?.currency || payload.currency || PAY42_WALLET_CURRENCY,
  ).toUpperCase();
  const price =
    normalizedType === OFFER_TYPE
      ? asNumber(payload.price, null)
      : normalizedType === ORDER_TYPE
        ? Number((asNumber(payload.profit, 0) + asNumber(payload.tax, 0)).toFixed(2))
        : normalizedType === TOPUP_TYPE
          ? asNumber(payload.amount, null)
          : null;
  await repo.upsertEntity({
    tenantId: PAY42_SCOPE,
    entityType: type,
    entityKey: sid,
    userId: payload.buyer_id || payload.seller_id || payload.create_sid || null,
    ownerId: payload.seller_id || payload.create_sid || payload.buyer_id || null,
    title: payload.name || payload.metadata?.offer_name || sid,
    subtitle:
      payload.metadata?.city ||
      payload.metadata?.country ||
      payload.method ||
      payload.product_id ||
      "",
    status: payload.status || "ACTIVE",
    state: text(payload.status || "ACTIVE").toLowerCase(),
    category,
    subtype,
    visibility: isPublicCatalogEntity ? "PUBLIC" : "PRIVATE",
    accessLevel: isPublicCatalogEntity ? "PUBLIC_READ" : "OWNER_ONLY",
    scopeType: "TENANT",
    scopeTenantId: PAY42_SCOPE,
    scopeModule: "42pay",
    scopeUserId: payload.buyer_id || payload.create_sid || payload.seller_id || null,
    currency,
    amount:
      normalizedType === TOPUP_TYPE
        ? asNumber(payload.amount, null)
        : normalizedType === ORDER_TYPE
          ? Number((asNumber(payload.profit, 0) + asNumber(payload.tax, 0)).toFixed(2))
          : null,
    price,
    publishedAt:
      isPublicCatalogEntity
        ? payload.created_at || payload.create_at || nowIso()
        : null,
    effectiveFrom: payload.start_at || null,
    effectiveTo: payload.end_at || payload.close_at || null,
    startAt: payload.start_at || payload.create_at || null,
    endAt: payload.end_at || payload.close_at || null,
    sourceSystem: "42pay",
    sourceId: sid,
    sortOrder: Number(payload.id || 0),
    searchText: [
      sid,
      payload.name,
      payload.type,
      payload.product_id,
      payload.product_offer_id,
      payload.metadata?.offer_name,
      payload.metadata?.city,
      payload.metadata?.category,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    data: payload,
    updatedAt: payload.updated_at || nowIso(),
    createdAt: payload.created_at || payload.create_at || nowIso(),
  });
}

function productView(product = {}) {
  return {
    ...clone(product),
    offer_count: asNumber(product.offer_count, 0),
  };
}

function offerView(offer = {}, productBySid = {}) {
  const product = productBySid[offer.product_id] || null;
  return {
    ...clone(offer),
    qr_code_image: String(offer.qr_code_image || ""),
    product_name: product ? product.name : "",
    product_image: product ? product.image : "",
    type: product ? product.type : "",
  };
}

function orderView(order = {}, offerBySid = {}, productBySid = {}) {
  const offer = offerBySid[order.product_offer_id] || null;
  const product = offer ? productBySid[offer.product_id] || null : null;
  return {
    ...clone(order),
    offer_name: offer?.metadata?.offer_name || "",
    product_name: product?.name || "",
    product_image: product?.image || "",
    seller_id: String(order?.metadata?.seller_id || offer?.seller_id || ""),
    total_amount: Number(asNumber(order.profit) + asNumber(order.tax)),
  };
}

function topupView(topup = {}) {
  return {
    ...clone(topup),
    amount: asNumber(topup.amount, 0),
    method: text(topup.method).toUpperCase(),
  };
}

async function generateQrCodeImage(qrPayload) {
  return QRCode.toDataURL(String(qrPayload || ""), {
    margin: 1,
    width: 256,
  });
}

function paymentPreviewView({
  offer = {},
  productBySid = {},
  wallet = null,
  qr_code = "",
} = {}) {
  const offerRow = offerView(offer, productBySid);
  const walletBalance = asNumber(wallet?.balance, 0);
  const totalAmount = Number((asNumber(offer.price) + asNumber(offer.tax)).toFixed(2));
  const remainingBalance = Number((walletBalance - totalAmount).toFixed(2));
  const canPay = remainingBalance >= 0;
  return {
    qr_code: String(qr_code || ""),
    offer: offerRow,
    wallet: wallet
      ? {
          account_id: String(wallet.account_id || ""),
          user_id: String(wallet.user_id || ""),
          balance: walletBalance,
        }
      : null,
    payment: {
      subtotal: asNumber(offer.price),
      tax: asNumber(offer.tax),
      total_amount: totalAmount,
      balance_before: walletBalance,
      balance_after: canPay ? remainingBalance : walletBalance,
      can_pay: canPay,
      shortfall: canPay ? 0 : Number(Math.abs(remainingBalance).toFixed(2)),
    },
  };
}

function createQrPayload(offer = {}) {
  return `42pay:${JSON.stringify({
    kind: "offer",
    offer_sid: offer.sid,
    seller_id: offer.seller_id,
    price: asNumber(offer.price),
    tax: asNumber(offer.tax),
  })}`;
}

function parseQrPayload(qrCode = "") {
  const raw = String(qrCode || "").trim();
  if (!raw.startsWith("42pay:")) {
    throw new Error("Invalid 42pay QR code");
  }
  const payload = JSON.parse(raw.slice("42pay:".length));
  if (!payload || payload.kind !== "offer" || !payload.offer_sid) {
    throw new Error("Unsupported 42pay QR code payload");
  }
  return payload;
}

function accountList(adapter, userId) {
  if (!adapter || typeof adapter.listUserAccounts !== "function") return [];
  return adapter.listUserAccounts(userId);
}

function legacyWalletAccount(accounts = [], userId = "") {
  const targetUserId = text(userId);
  const rows = Array.isArray(accounts) ? accounts : [];
  return (
    rows.find(
      (row) =>
        text(row.user_id) === targetUserId &&
        row?.metadata &&
        typeof row.metadata === "object" &&
        row.metadata.pay42_wallet === true,
    ) ||
    rows.find(
      (row) =>
        text(row.user_id) === targetUserId &&
        String(row.account_id || "").trim().toLowerCase().includes("42pay_wallet"),
    ) ||
    rows.find((row) => text(row.user_id) === targetUserId) ||
    null
  );
}

function walletEntityId(userId = "") {
  return `pay42_wallet_${stableToken(userId)}`;
}

function walletEntityKey(userId = "", currency = PAY42_WALLET_CURRENCY) {
  return `wallet:${String(currency || PAY42_WALLET_CURRENCY).trim().toLowerCase()}:${text(userId)}`;
}

function userEntityId(userId = "") {
  return `pay42_user_${stableToken(userId)}`;
}

function userEntityKey(userId = "") {
  return `user:${text(userId)}`;
}

function walletLinkId(userId = "") {
  return `pay42_wallet_link_${stableToken(userId)}`;
}

function defaultWalletBalanceForRole(role = "") {
  return String(role || "").trim().toLowerCase() === "seller" ? 1200 : 0;
}

function walletRecordFromEntity(entity = null) {
  if (!entity) return null;
  const data = entity.data && typeof entity.data === "object" ? entity.data : {};
  const balance = asNumber(data.balance, 0);
  const lockedBalance = asNumber(data.locked_balance, 0);
  return {
    entity_id: entity.id,
    entity_type: entity.entity_type || entity.entityType || WALLET_TYPE,
    entity_key: entity.entity_key || entity.entityKey || "",
    account_id: String(data.account_id || entity.entity_key || entity.entityKey || ""),
    user_id: String(entity.user_id || entity.userId || data.user_id || ""),
    owner_id: String(entity.owner_id || entity.ownerId || data.owner_id || ""),
    name: String(data.name || ""),
    balance,
    available_balance:
      data.available_balance === undefined || data.available_balance === null
        ? balance - lockedBalance
        : asNumber(data.available_balance, balance - lockedBalance),
    locked_balance: lockedBalance,
    currency: String(data.currency || PAY42_WALLET_CURRENCY),
    status: String(entity.status || "ACTIVE"),
    metadata:
      data.metadata && typeof data.metadata === "object"
        ? clone(data.metadata)
        : {},
    raw: entity,
  };
}

async function ensureWalletIdentity(repo, wallet = null) {
  if (!wallet || !wallet.user_id) return wallet;
  const role = String(wallet.metadata?.role || "").trim().toLowerCase() || "buyer";
  await repo.upsertEntity({
    id: userEntityId(wallet.user_id),
    tenantId: PAY42_SCOPE,
    entityType: USER_TYPE,
    entityKey: userEntityKey(wallet.user_id),
    userId: wallet.user_id,
    ownerId: wallet.user_id,
    title: wallet.name || wallet.user_id,
    category: "user",
    subtype: role,
    visibility: "PRIVATE",
    accessLevel: "OWNER_ONLY",
    scopeType: "TENANT",
    scopeTenantId: PAY42_SCOPE,
    scopeModule: "42pay",
    scopeUserId: wallet.user_id,
    status: wallet.status || "ACTIVE",
    searchText: `${wallet.user_id} ${role} 42pay user`.toLowerCase(),
    sourceSystem: "42pay",
    sourceId: wallet.user_id,
    data: {
      user_id: wallet.user_id,
      name: wallet.name || wallet.user_id,
      roles: uniq([role]),
      source: "42pay",
    },
  });
  await repo.upsertLink({
    id: walletLinkId(wallet.user_id),
    tenantId: PAY42_SCOPE,
    fromEntityId: userEntityId(wallet.user_id),
    toEntityId: wallet.entity_id,
    fromType: USER_TYPE,
    toType: WALLET_TYPE,
    linkType: WALLET_LINK_TYPE,
    userId: wallet.user_id,
    status: "ACTIVE",
    data: {
      relationship: "primary_wallet",
      account_id: wallet.account_id,
      currency: wallet.currency || PAY42_WALLET_CURRENCY,
    },
  });
  return wallet;
}

async function appendWalletJournal(repo, wallet = null, input = {}) {
  if (!wallet) return null;
  return repo.appendJournal({
    tenantId: PAY42_SCOPE,
    entityId: wallet.entity_id,
    entityType: WALLET_TYPE,
    entityKey: wallet.entity_key,
    userId: wallet.user_id,
    entryType: input.entryType,
    direction: input.direction,
    amount: asNumber(input.amount, 0),
    currency: input.currency || wallet.currency || PAY42_WALLET_CURRENCY,
    happenedAt: input.happenedAt || nowIso(),
    data: input.data && typeof input.data === "object" ? clone(input.data) : {},
  });
}

async function upsertWalletEntity(repo, wallet = null, options = {}) {
  if (!wallet) return null;
  const now = options.updatedAt || nowIso();
  const balance = asNumber(wallet.balance, 0);
  const lockedBalance = asNumber(wallet.locked_balance, 0);
  const entity = await repo.upsertEntity({
    id: wallet.entity_id || walletEntityId(wallet.user_id),
    tenantId: PAY42_SCOPE,
    entityType: WALLET_TYPE,
    entityKey: wallet.entity_key || walletEntityKey(wallet.user_id, wallet.currency),
    userId: wallet.user_id,
    ownerId: wallet.owner_id || wallet.user_id,
    title: wallet.name || wallet.user_id,
    category: "wallet",
    subtype: "cash",
    visibility: "PRIVATE",
    accessLevel: "OWNER_ONLY",
    scopeType: "TENANT",
    scopeTenantId: PAY42_SCOPE,
    scopeModule: "42pay",
    scopeUserId: wallet.user_id,
    status: wallet.status || "ACTIVE",
    currency: wallet.currency || PAY42_WALLET_CURRENCY,
    balance,
    amount: balance,
    sourceSystem: "42pay",
    sourceId: wallet.account_id || wallet.user_id,
    searchText: [
      "wallet",
      "42pay",
      wallet.user_id,
      wallet.currency || PAY42_WALLET_CURRENCY,
      wallet.metadata?.role,
      wallet.name,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    updatedAt: now,
    createdAt: wallet.created_at || options.createdAt || now,
    data: {
      account_id: wallet.account_id || wallet.entity_key || walletEntityKey(wallet.user_id),
      account_type: "wallet",
      ledger_type: "cash",
      payment_domain: "42pay",
      currency: wallet.currency || PAY42_WALLET_CURRENCY,
      balance,
      available_balance:
        wallet.available_balance === undefined || wallet.available_balance === null
          ? balance - lockedBalance
          : asNumber(wallet.available_balance, balance - lockedBalance),
      locked_balance: lockedBalance,
      name: wallet.name || wallet.user_id,
      metadata:
        wallet.metadata && typeof wallet.metadata === "object"
          ? clone(wallet.metadata)
          : {},
    },
  });
  return walletRecordFromEntity(entity);
}

async function resolveWalletForActor(repo, accountsAdapter, actor = {}) {
  const userId = text(actor.user_id);
  const role = isSeller(actor) ? "seller" : "buyer";
  const entity = await repo.getEntity(PAY42_SCOPE, WALLET_TYPE, walletEntityKey(userId));
  if (entity) {
    const wallet = walletRecordFromEntity(entity);
    await ensureWalletIdentity(repo, wallet);
    return wallet;
  }

  const rows = await accountList(accountsAdapter, userId);
  const legacyWallet = legacyWalletAccount(rows, userId);
  const startingBalance = legacyWallet
    ? asNumber(legacyWallet.balance, defaultWalletBalanceForRole(role))
    : defaultWalletBalanceForRole(role);
  const created = await upsertWalletEntity(repo, {
    entity_id: walletEntityId(userId),
    entity_key: walletEntityKey(userId),
    account_id: legacyWallet?.account_id || walletEntityKey(userId),
    user_id: userId,
    owner_id: userId,
    name: legacyWallet?.name || `42Pay ${role === "seller" ? "Seller" : "Buyer"} Wallet`,
    balance: startingBalance,
    available_balance: startingBalance,
    locked_balance: 0,
    currency: PAY42_WALLET_CURRENCY,
    status: legacyWallet?.status || "ACTIVE",
    metadata: {
      ...(legacyWallet?.metadata && typeof legacyWallet.metadata === "object"
        ? clone(legacyWallet.metadata)
        : {}),
      pay42_wallet: true,
      role,
    },
  });
  await ensureWalletIdentity(repo, created);
  if (startingBalance > 0) {
    await appendWalletJournal(repo, created, {
      entryType: "wallet.opening_balance",
      direction: "credit",
      amount: startingBalance,
      data: {
        source: legacyWallet ? "legacy_account_adapter" : "default_seed",
      },
    });
  }
  return created;
}

function walletView(wallet = null, userId = "") {
  if (!wallet) return null;
  return {
    account_id: String(wallet.account_id || ""),
    user_id: String(wallet.user_id || userId),
    name: String(wallet.name || ""),
    balance: asNumber(wallet.balance, 0),
    available_balance: asNumber(wallet.available_balance, asNumber(wallet.balance, 0)),
    locked_balance: asNumber(wallet.locked_balance, 0),
    currency: String(wallet.currency || PAY42_WALLET_CURRENCY),
    status: String(wallet.status || "ACTIVE"),
    metadata:
      wallet.metadata && typeof wallet.metadata === "object"
        ? clone(wallet.metadata)
        : {},
  };
}

function ensureWalletOwnerActor(actor = {}) {
  const userId = text(actor.user_id);
  if (!userId) throw new Error("Wallet owner is required");
  if (isBuyer(actor) || isSeller(actor) || isAdmin(actor)) return;
  throw new Error("Wallet permission is required");
}

function ensureSellerActor(actor = {}) {
  if (!isSeller(actor)) throw new Error("Seller permission is required");
}

function ensureBuyerActor(actor = {}) {
  if (!isBuyer(actor)) throw new Error("Buyer permission is required");
}

function ensureAdminActor(actor = {}) {
  if (!isAdmin(actor)) throw new Error("Admin permission is required");
}

function statusActiveForDate(offer = {}, dateIso = nowIso()) {
  const status = text(offer.status || "DRAFT", "DRAFT").toUpperCase();
  if (status !== "ACTIVE") return false;
  const now = new Date(dateIso).getTime();
  const start = offer.start_at ? new Date(offer.start_at).getTime() : null;
  const end = offer.end_at ? new Date(offer.end_at).getTime() : null;
  if (Number.isFinite(start) && now < start) return false;
  if (Number.isFinite(end) && now > end) return false;
  return true;
}

function matchesQuery(value, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return String(value || "").toLowerCase().includes(q);
}

function sum(rows = [], field) {
  return rows.reduce((total, row) => total + asNumber(row?.[field]), 0);
}

function byCreateDesc(a, b) {
  return String(b?.create_at || b?.created_at || "").localeCompare(
    String(a?.create_at || a?.created_at || ""),
  );
}

async function resolveOfferFromQrCode(repo, input = {}) {
  const payload = parseQrPayload(input.qr_code);
  const offers = await listType(repo, OFFER_TYPE);
  const products = await listType(repo, PRODUCT_TYPE);
  const offer = offers.find((row) => row.sid === payload.offer_sid);
  if (!offer) throw new Error("Offer not found");
  if (!statusActiveForDate(offer)) throw new Error("Offer is no longer active");
  return {
    payload,
    offer,
    products,
    productBySid: Object.fromEntries(products.map((product) => [product.sid, product])),
  };
}

async function settleWalletTransfer(repo, accountsAdapter, { buyer_id, seller_id, amount, order_sid }) {
  const buyerWallet = await resolveWalletForActor(repo, accountsAdapter, {
    user_id: buyer_id,
    roles: ["buyer"],
  });
  const sellerWallet = await resolveWalletForActor(repo, accountsAdapter, {
    user_id: seller_id,
    roles: ["seller"],
  });
  if (!buyerWallet) throw new Error("Buyer wallet account was not found");
  if (!sellerWallet) throw new Error("Seller wallet account was not found");

  const buyerBalance = asNumber(buyerWallet.balance, 0);
  if (buyerBalance < amount) {
    throw new Error("Buyer does not have enough balance");
  }

  const nextBuyerBalance = Number((buyerBalance - amount).toFixed(2));
  const nextSellerBalance = Number((asNumber(sellerWallet.balance, 0) + amount).toFixed(2));

  const nextBuyerWallet = await upsertWalletEntity(repo, {
    ...buyerWallet,
    balance: nextBuyerBalance,
    available_balance: nextBuyerBalance,
    metadata: {
      ...(buyerWallet.metadata && typeof buyerWallet.metadata === "object"
        ? buyerWallet.metadata
        : {}),
      pay42_wallet: true,
      last_pay42_order_sid: order_sid,
    },
  });
  const nextSellerWallet = await upsertWalletEntity(repo, {
    ...sellerWallet,
    balance: nextSellerBalance,
    available_balance: nextSellerBalance,
    metadata: {
      ...(sellerWallet.metadata && typeof sellerWallet.metadata === "object"
        ? sellerWallet.metadata
        : {}),
      pay42_wallet: true,
      last_pay42_order_sid: order_sid,
    },
  });
  await appendWalletJournal(repo, nextBuyerWallet, {
    entryType: "wallet.order_debit",
    direction: "debit",
    amount,
    data: {
      order_sid,
      counterparty_user_id: seller_id,
    },
  });
  await appendWalletJournal(repo, nextSellerWallet, {
    entryType: "wallet.order_credit",
    direction: "credit",
    amount,
    data: {
      order_sid,
      counterparty_user_id: buyer_id,
    },
  });
  return {
    buyer_wallet: {
      account_id: nextBuyerWallet.account_id,
      balance_before: buyerBalance,
      balance_after: nextBuyerBalance,
    },
    seller_wallet: {
      account_id: nextSellerWallet.account_id,
      balance_before: asNumber(sellerWallet.balance, 0),
      balance_after: nextSellerBalance,
    },
  };
}

function create42PayRepo(options = {}) {
  const repo = universalStore(options);
  const accountsAdapter =
    options.accounts && typeof options.accounts === "object" ? options.accounts : null;
  const legacySqlitePath = resolveLegacy42PaySqlitePath(options);
  const legacyJsonDataRoots = resolveLegacy42PayJsonDataRoots(options);

  async function migrateLegacyType(fromRepo, type, seenKeys) {
    const rows = await fromRepo.listObjectsByType(PAY42_SCOPE, type);
    let migrated = 0;
    for (const row of rows) {
      const key = `${row?.user_id || ""}:${row?.type || ""}:${row?.name || ""}`;
      await putType(
        repo,
        type,
        row?.name || row?.object_id || row?.data?.sid || "",
        row && row.data && typeof row.data === "object" ? row.data : {},
      );
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        migrated += 1;
      }
    }
    return migrated;
  }

  async function migrateLegacyTypeFromUniversalStore(fromStore, type, seenKeys) {
    const rows = await fromStore.listEntities({
      tenantId: PAY42_SCOPE,
      entityType: type,
      limit: 10000,
    });
    let migrated = 0;
    for (const row of rows) {
      const key = `${row?.tenant_id || ""}:${row?.entity_type || ""}:${row?.entity_key || ""}`;
      await putType(
        repo,
        type,
        row?.entity_key || row?.entityKey || row?.data?.sid || "",
        row && row.data && typeof row.data === "object" ? row.data : {},
      );
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        migrated += 1;
      }
    }
    return migrated;
  }

  return {
    getStorageInfo() {
      const info = repo.info();
      return {
        provider: info.backend,
        connection_target: info.connectionTarget || null,
        current_store_path: info.connectionTarget || null,
        legacy_sqlite_path: legacySqlitePath,
      };
    },
    async migrateLegacySqliteToProvider() {
      if (repo.info().backend === "sqlite") {
        const seenKeys = new Set();
        const counts = {
          products: 0,
          offers: 0,
          orders: 0,
          topups: 0,
        };
        try {
          const fromRepo = createObjectStoreRepo({
            provider: "postgres",
            ...resolve42PayObjectStoreOptions(options),
            ...(options.cache && typeof options.cache === "object"
              ? { cache: options.cache }
              : {}),
          });
          counts.products += await migrateLegacyType(fromRepo, PRODUCT_TYPE, seenKeys);
          counts.offers += await migrateLegacyType(fromRepo, OFFER_TYPE, seenKeys);
          counts.orders += await migrateLegacyType(fromRepo, ORDER_TYPE, seenKeys);
          counts.topups += await migrateLegacyType(fromRepo, TOPUP_TYPE, seenKeys);
        } catch {
          // Local prototype environments may not have Postgres configured.
        }
        if (fs.existsSync(legacySqlitePath)) {
          try {
            const fromUniversalSqlite = createUniversalStoreFacade({
              provider: "sqlite",
              sqlitePath: legacySqlitePath,
            });
            counts.products += await migrateLegacyTypeFromUniversalStore(
              fromUniversalSqlite,
              PRODUCT_TYPE,
              seenKeys,
            );
            counts.offers += await migrateLegacyTypeFromUniversalStore(
              fromUniversalSqlite,
              OFFER_TYPE,
              seenKeys,
            );
            counts.orders += await migrateLegacyTypeFromUniversalStore(
              fromUniversalSqlite,
              ORDER_TYPE,
              seenKeys,
            );
            counts.topups += await migrateLegacyTypeFromUniversalStore(
              fromUniversalSqlite,
              TOPUP_TYPE,
              seenKeys,
            );
          } catch {
            const fromLegacySqlite = legacySqliteStore({
              ...options,
              legacySqlitePath,
              sqlitePath: legacySqlitePath,
            });
            counts.products += await migrateLegacyType(
              fromLegacySqlite,
              PRODUCT_TYPE,
              seenKeys,
            );
            counts.offers += await migrateLegacyType(
              fromLegacySqlite,
              OFFER_TYPE,
              seenKeys,
            );
            counts.orders += await migrateLegacyType(
              fromLegacySqlite,
              ORDER_TYPE,
              seenKeys,
            );
            counts.topups += await migrateLegacyType(
              fromLegacySqlite,
              TOPUP_TYPE,
              seenKeys,
            );
          }
          for (const suffix of ["", "-shm", "-wal"]) {
            const filePath = `${legacySqlitePath}${suffix}`;
            if (!fs.existsSync(filePath)) continue;
            fs.rmSync(filePath, { force: true });
          }
        }
        const migrated = Object.values(counts).some((count) => Number(count) > 0);
        return {
          ok: true,
          provider: "sqlite",
          migrated,
          reason: migrated
            ? "migrated postgres-backed 42pay records into sqlite"
            : "current provider already sqlite",
          legacy_sqlite_path: legacySqlitePath,
          legacy_json_data_roots: legacyJsonDataRoots,
          counts,
        };
      }
      const seenKeys = new Set();
      const counts = {
        products: 0,
        offers: 0,
        orders: 0,
        topups: 0,
      };
      for (const dataRoot of legacyJsonDataRoots) {
        const scopeDir = path.join(String(dataRoot || "").trim(), PAY42_SCOPE);
        if (!fs.existsSync(scopeDir)) continue;
        const fromRepo = createObjectStoreRepo({
          provider: "json",
          dataRoot,
          ...(options.cache && typeof options.cache === "object"
            ? { cache: options.cache }
            : {}),
        });
        counts.products += await migrateLegacyType(fromRepo, PRODUCT_TYPE, seenKeys);
        counts.offers += await migrateLegacyType(fromRepo, OFFER_TYPE, seenKeys);
        counts.orders += await migrateLegacyType(fromRepo, ORDER_TYPE, seenKeys);
        counts.topups += await migrateLegacyType(fromRepo, TOPUP_TYPE, seenKeys);
        fs.rmSync(scopeDir, { recursive: true, force: true });
      }
      if (fs.existsSync(legacySqlitePath)) {
        try {
          const fromUniversalSqlite = createUniversalStoreFacade({
            provider: "sqlite",
            sqlitePath: legacySqlitePath,
          });
          counts.products += await migrateLegacyTypeFromUniversalStore(
            fromUniversalSqlite,
            PRODUCT_TYPE,
            seenKeys,
          );
          counts.offers += await migrateLegacyTypeFromUniversalStore(
            fromUniversalSqlite,
            OFFER_TYPE,
            seenKeys,
          );
          counts.orders += await migrateLegacyTypeFromUniversalStore(
            fromUniversalSqlite,
            ORDER_TYPE,
            seenKeys,
          );
          counts.topups += await migrateLegacyTypeFromUniversalStore(
            fromUniversalSqlite,
            TOPUP_TYPE,
            seenKeys,
          );
        } catch {
          const fromRepo = legacySqliteStore({
            ...options,
            legacySqlitePath,
            sqlitePath: legacySqlitePath,
          });
          counts.products += await migrateLegacyType(fromRepo, PRODUCT_TYPE, seenKeys);
          counts.offers += await migrateLegacyType(fromRepo, OFFER_TYPE, seenKeys);
          counts.orders += await migrateLegacyType(fromRepo, ORDER_TYPE, seenKeys);
          counts.topups += await migrateLegacyType(fromRepo, TOPUP_TYPE, seenKeys);
        }
        for (const suffix of ["", "-shm", "-wal"]) {
          const filePath = `${legacySqlitePath}${suffix}`;
          if (!fs.existsSync(filePath)) continue;
          fs.rmSync(filePath, { force: true });
        }
      }
      const migrated = Object.values(counts).some((count) => Number(count) > 0);
      return {
        ok: true,
        provider: repo.info().backend,
        migrated,
        legacy_sqlite_path: legacySqlitePath,
        legacy_json_data_roots: legacyJsonDataRoots,
        counts,
      };
    },
    async migrateLegacyActorIds() {
      const existingProducts = await listType(repo, PRODUCT_TYPE);
      const existingOffers = await listType(repo, OFFER_TYPE);
      const existingOrders = await listType(repo, ORDER_TYPE);
      const existingTopups = await listType(repo, TOPUP_TYPE);
      let updated = 0;

      for (const product of existingProducts) {
        const nextCreateSid = migrateLegacyActorId(product.create_sid);
        if (nextCreateSid === text(product.create_sid)) continue;
        await putType(repo, PRODUCT_TYPE, product.sid, {
          ...product,
          create_sid: nextCreateSid,
          updated_at: nowIso(),
        });
        updated += 1;
      }

      for (const offer of existingOffers) {
        const nextSellerId = migrateLegacyActorId(offer.seller_id);
        const nextQrCode = createQrPayload({
          ...offer,
          seller_id: nextSellerId,
        });
        const currentQrCode = text(offer.qr_code);
        if (nextSellerId === text(offer.seller_id) && currentQrCode === nextQrCode) {
          continue;
        }
        await putType(repo, OFFER_TYPE, offer.sid, {
          ...offer,
          seller_id: nextSellerId,
          qr_code: nextQrCode,
          qr_code_image: await generateQrCodeImage(nextQrCode),
          metadata: clone(offer.metadata || {}),
          updated_at: nowIso(),
        });
        updated += 1;
      }

      for (const order of existingOrders) {
        const nextBuyerId = migrateLegacyActorId(order.buyer_id);
        const metadata =
          order.metadata && typeof order.metadata === "object"
            ? clone(order.metadata)
            : {};
        const currentSellerId = text(metadata.seller_id);
        const nextSellerId = migrateLegacyActorId(currentSellerId);
        if (
          nextBuyerId === text(order.buyer_id) &&
          nextSellerId === currentSellerId
        ) {
          continue;
        }
        await putType(repo, ORDER_TYPE, order.sid, {
          ...order,
          buyer_id: nextBuyerId,
          metadata: {
            ...metadata,
            ...(nextSellerId ? { seller_id: nextSellerId } : {}),
          },
          updated_at: nowIso(),
        });
        updated += 1;
      }

      for (const topup of existingTopups) {
        const nextUserId = migrateLegacyActorId(topup.user_id);
        if (nextUserId === text(topup.user_id)) continue;
        await putType(repo, TOPUP_TYPE, topup.sid, {
          ...topup,
          user_id: nextUserId,
          updated_at: nowIso(),
        });
        updated += 1;
      }

      return { ok: true, updated };
    },
    async seedInitialData() {
      const existingProducts = await listType(repo, PRODUCT_TYPE);
      const existingOffers = await listType(repo, OFFER_TYPE);
      const existingOrders = await listType(repo, ORDER_TYPE);
      const existingTopups = await listType(repo, TOPUP_TYPE);

      for (let index = 0; index < SEEDED_PRODUCTS.length; index += 1) {
        const product = SEEDED_PRODUCTS[index];
        const current = existingProducts.find((row) => row.sid === product.sid) || null;
        const createdAt = current?.create_at || nowIso();
        await putType(repo, PRODUCT_TYPE, product.sid, {
          id: current?.id || index + 1,
          sid: product.sid,
          name: product.name,
          image: product.image,
          type: product.type,
          status: product.status,
          metadata: clone(product.metadata),
          create_at: createdAt,
          created_at: current?.created_at || createdAt,
          updated_at: nowIso(),
          create_sid: current?.create_sid || product.create_sid,
        });
      }

      for (let index = 0; index < SEEDED_OFFERS.length; index += 1) {
        const offer = SEEDED_OFFERS[index];
        const current = existingOffers.find((row) => row.sid === offer.sid) || null;
        const qrCode = createQrPayload(offer);
        const createdAt = current?.create_at || nowIso();
        await putType(repo, OFFER_TYPE, offer.sid, {
          id: current?.id || index + 1,
          sid: offer.sid,
          product_id: offer.product_id,
          price: offer.price,
          tax: offer.tax,
          qr_code: qrCode,
          qr_code_image: await generateQrCodeImage(qrCode),
          seller_id: current?.seller_id || offer.seller_id,
          metadata: clone(offer.metadata),
          status: offer.status,
          create_at: createdAt,
          created_at: current?.created_at || createdAt,
          updated_at: nowIso(),
          start_at: offer.start_at,
          end_at: offer.end_at,
        });
      }

      if (existingOrders.length === 0) {
        for (let index = 0; index < SEEDED_ORDERS.length; index += 1) {
          const order = SEEDED_ORDERS[index];
          await putType(repo, ORDER_TYPE, order.sid, {
            id: index + 1,
            sid: order.sid,
            product_offer_id: order.product_offer_id,
            profit: order.profit,
            tax: order.tax,
            buyer_id: order.buyer_id,
            metadata: clone(order.metadata),
            status: order.status,
            start_at: order.start_at,
            close_at: order.close_at,
            create_at: order.create_at,
          });
        }
      }

      await resolveWalletForActor(repo, accountsAdapter, {
        user_id: PAY42_BUYER_ID,
        roles: ["buyer"],
      });
      await resolveWalletForActor(repo, accountsAdapter, {
        user_id: PAY42_SELLER_ID,
        roles: ["seller"],
      });

      return {
        ok: true,
        products: Math.max(existingProducts.length, SEEDED_PRODUCTS.length),
        offers: Math.max(existingOffers.length, SEEDED_OFFERS.length),
        orders: Math.max(existingOrders.length, SEEDED_ORDERS.length),
        topups: existingTopups.length,
      };
    },

    async listProducts({ actor = {}, status = "", query = "", seller_id = "" } = {}) {
      const rows = await listType(repo, PRODUCT_TYPE);
      const offers = await listType(repo, OFFER_TYPE);
      const products = rows
        .map((product) => ({
          ...product,
          offer_count: offers.filter((offer) => offer.product_id === product.sid).length,
        }))
        .filter((product) => {
          if (status && text(product.status).toUpperCase() !== text(status).toUpperCase()) {
            return false;
          }
          if (seller_id && text(product.create_sid) !== text(seller_id)) return false;
          if (isSeller(actor) && !isAdmin(actor) && text(product.create_sid) !== text(actor.user_id)) {
            return false;
          }
          return (
            matchesQuery(product.name, query) ||
            matchesQuery(product.type, query) ||
            matchesQuery(product.metadata?.city, query)
          );
        })
        .sort(byCreateDesc)
        .map(productView);
      return { ok: true, items: products };
    },

    async upsertProduct(input = {}, { actor = {} } = {}) {
      ensureSellerActor(actor);
      const rows = await listType(repo, PRODUCT_TYPE);
      const sid = text(input.sid) || slugId("P42P", input.name);
      const current = rows.find((row) => row.sid === sid) || null;
      if (current && !isAdmin(actor) && text(current.create_sid) !== text(actor.user_id)) {
        throw new Error("You can only update your own products");
      }
      const createdAt = current?.create_at || nowIso();
      const product = {
        id: current?.id || rows.length + 1,
        sid,
        name: text(input.name),
        image: text(input.image),
        type: text(input.type || "hotel", "hotel"),
        status: text(input.status || "ACTIVE", "ACTIVE").toUpperCase(),
        metadata: clone(input.metadata || current?.metadata || {}),
        create_at: createdAt,
        created_at: createdAt,
        updated_at: nowIso(),
        create_sid: current?.create_sid || text(input.create_sid || actor.user_id),
      };
      if (!product.name) throw new Error("Product name is required");
      await putType(repo, PRODUCT_TYPE, sid, product);
      return { ok: true, product: productView(product) };
    },

    async listOffers(
      { actor = {}, status = "", query = "", seller_id = "", product_id = "", include_inactive = false } = {},
    ) {
      const products = await listType(repo, PRODUCT_TYPE);
      const productBySid = Object.fromEntries(products.map((product) => [product.sid, product]));
      const rows = await listType(repo, OFFER_TYPE);
      const filtered = rows
        .filter((offer) => {
          const offerSellerId = text(offer.seller_id);
          if (seller_id && offerSellerId !== text(seller_id)) return false;
          if (product_id && text(offer.product_id) !== text(product_id)) return false;
          if (status && text(offer.status).toUpperCase() !== text(status).toUpperCase()) return false;
          if (isSeller(actor) && !isAdmin(actor) && offerSellerId !== text(actor.user_id)) {
            return false;
          }
          if (!isSeller(actor) && !isAdmin(actor) && !include_inactive && !statusActiveForDate(offer)) {
            return false;
          }
          const product = productBySid[offer.product_id] || {};
          return (
            matchesQuery(product.name, query) ||
            matchesQuery(offer.metadata?.offer_name, query) ||
            matchesQuery(product.metadata?.city, query)
          );
        })
        .sort(byCreateDesc)
        .map((offer) => offerView(offer, productBySid));
      return { ok: true, items: filtered };
    },

    async upsertOffer(input = {}, { actor = {} } = {}) {
      ensureSellerActor(actor);
      const offers = await listType(repo, OFFER_TYPE);
      const products = await listType(repo, PRODUCT_TYPE);
      const sid = text(input.sid) || slugId("P42O", input.product_id || input.metadata?.offer_name);
      const current = offers.find((row) => row.sid === sid) || null;
      const product = products.find((row) => row.sid === text(input.product_id || current?.product_id));
      if (!product) throw new Error("Product not found");
      const sellerId = text(input.seller_id || current?.seller_id || actor.user_id);
      if (current && !isAdmin(actor) && text(current.seller_id) !== text(actor.user_id)) {
        throw new Error("You can only update your own offers");
      }
      if (!isAdmin(actor) && sellerId !== text(actor.user_id)) {
        throw new Error("You can only create offers for your own seller account");
      }
      const baseOffer = {
        id: current?.id || offers.length + 1,
        sid,
        product_id: text(input.product_id || current?.product_id),
        price: asNumber(input.price ?? current?.price),
        tax: asNumber(input.tax ?? current?.tax),
        seller_id: sellerId,
        metadata: clone(input.metadata || current?.metadata || {}),
        status: text(input.status || current?.status || "ACTIVE", "ACTIVE").toUpperCase(),
        create_at: current?.create_at || nowIso(),
        created_at: current?.created_at || current?.create_at || nowIso(),
        updated_at: nowIso(),
        start_at: text(input.start_at || current?.start_at || nowIso()),
        end_at: text(input.end_at || current?.end_at || ""),
      };
      const qrCode = createQrPayload(baseOffer);
      const offer = {
        ...baseOffer,
        qr_code: qrCode,
        qr_code_image: await generateQrCodeImage(qrCode),
      };
      await putType(repo, OFFER_TYPE, sid, offer);
      return {
        ok: true,
        offer: offerView(offer, {
          [product.sid]: product,
        }),
      };
    },

    async listOrders({ actor = {}, status = "", query = "", buyer_id = "", seller_id = "" } = {}) {
      const products = await listType(repo, PRODUCT_TYPE);
      const offers = await listType(repo, OFFER_TYPE);
      const offerBySid = Object.fromEntries(offers.map((offer) => [offer.sid, offer]));
      const productBySid = Object.fromEntries(products.map((product) => [product.sid, product]));
      const rows = await listType(repo, ORDER_TYPE);
      const filtered = rows
        .filter((order) => {
          const buyerId = text(order.buyer_id);
          const offer = offerBySid[order.product_offer_id] || null;
          const derivedSellerId = text(order?.metadata?.seller_id || offer?.seller_id);
          if (status && text(order.status).toUpperCase() !== text(status).toUpperCase()) return false;
          if (buyer_id && buyerId !== text(buyer_id)) return false;
          if (seller_id && derivedSellerId !== text(seller_id)) return false;
          if (isAdmin(actor)) return true;
          if (isSeller(actor)) return derivedSellerId === text(actor.user_id);
          return buyerId === text(actor.user_id);
        })
        .filter((order) => {
          const offer = offerBySid[order.product_offer_id] || {};
          const product = productBySid[offer.product_id] || {};
          return (
            matchesQuery(order.sid, query) ||
            matchesQuery(product.name, query) ||
            matchesQuery(offer.metadata?.offer_name, query)
          );
        })
        .sort(byCreateDesc)
        .map((order) => orderView(order, offerBySid, productBySid));
      return { ok: true, items: filtered };
    },

    async createOrderFromQrCode(input = {}, { actor = {} } = {}) {
      ensureBuyerActor(actor);
      const { offer, products } = await resolveOfferFromQrCode(repo, input);
      const rows = await listType(repo, ORDER_TYPE);
      const sid = slugId("P42R", offer.sid);
      const sellerId = text(offer.seller_id);
      const startedAt = nowIso();
      const totalAmount = Number((asNumber(offer.price) + asNumber(offer.tax)).toFixed(2));
      const settlement = await settleWalletTransfer(repo, accountsAdapter, {
        buyer_id: text(actor.user_id),
        seller_id: sellerId,
        amount: totalAmount,
        order_sid: sid,
      });
      const order = {
        id: rows.length + 1,
        sid,
        product_offer_id: offer.sid,
        profit: asNumber(offer.price),
        tax: asNumber(offer.tax),
        buyer_id: text(actor.user_id),
        metadata: {
          ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
          qr_code: input.qr_code,
          seller_id: sellerId,
          product_id: offer.product_id,
          settlement,
        },
        status: "PAID",
        start_at: startedAt,
        close_at: nowIso(),
        create_at: startedAt,
        created_at: startedAt,
        updated_at: nowIso(),
      };
      await putType(repo, ORDER_TYPE, sid, order);
      const offerBySid = { [offer.sid]: offer };
      const productBySid = Object.fromEntries(products.map((product) => [product.sid, product]));
      return {
        ok: true,
        order: orderView(order, offerBySid, productBySid),
      };
    },

    async previewOrderFromQrCode(input = {}, { actor = {} } = {}) {
      ensureBuyerActor(actor);
      const { offer, productBySid } = await resolveOfferFromQrCode(repo, input);
      const walletOut = await this.getWalletSummary({ actor });
      return {
        ok: true,
        ...paymentPreviewView({
          offer,
          productBySid,
          wallet: walletOut?.wallet || null,
          qr_code: input.qr_code,
        }),
      };
    },

    async getWalletSummary({ actor = {} } = {}) {
      const userId = text(actor.user_id);
      const wallet = await resolveWalletForActor(repo, accountsAdapter, actor);
      const topups = await this.listWalletTopups({ actor, limit: 5 });
      const orders = await this.listOrders({ actor });
      const walletJournal = await repo.listJournal({
        tenantId: PAY42_SCOPE,
        entityType: WALLET_TYPE,
        entityKey: wallet?.entity_key || walletEntityKey(userId),
        userId,
        limit: 1000,
      });
      const totalTopup = walletJournal
        .filter((row) => row.entry_type === "wallet.topup")
        .reduce((sumValue, row) => sumValue + asNumber(row.amount, 0), 0);
      const totalEarned = walletJournal
        .filter((row) => row.entry_type === "wallet.order_credit")
        .reduce((sumValue, row) => sumValue + asNumber(row.amount, 0), 0);
      const totalSpent = walletJournal
        .filter((row) => row.entry_type === "wallet.order_debit")
        .reduce((sumValue, row) => sumValue + asNumber(row.amount, 0), 0);
      return {
        ok: true,
        wallet: walletView(wallet, userId),
        recent_topups: topups.items,
        wallet_totals: {
          total_topup: Number(totalTopup.toFixed(2)),
          total_earned: Number(totalEarned.toFixed(2)),
          total_spent: Number(totalSpent.toFixed(2)),
          total_balance: Number(
            (totalTopup + totalEarned - totalSpent).toFixed(2),
          ),
        },
      };
    },

    async listWalletTopups({ actor = {}, limit = 50 } = {}) {
      ensureWalletOwnerActor(actor);
      const rows = await listType(repo, TOPUP_TYPE);
      const userId = text(actor.user_id);
      return {
        ok: true,
        items: rows
          .filter((row) => {
            if (isAdmin(actor)) return true;
            return text(row.user_id) === userId;
          })
          .sort(byCreateDesc)
          .slice(0, Math.max(1, asNumber(limit, 50)))
          .map(topupView),
      };
    },

    async topupWallet(input = {}, { actor = {} } = {}) {
      ensureBuyerActor(actor);
      const amount = Number(asNumber(input.amount, 0).toFixed(2));
      if (!(amount > 0)) throw new Error("Top up amount must be greater than zero");
      const method = text(input.method || "CARD").toUpperCase();
      const wallet = await resolveWalletForActor(repo, accountsAdapter, actor);
      if (!wallet) throw new Error("Wallet account was not found");
      const nextBalance = Number((asNumber(wallet.balance, 0) + amount).toFixed(2));
      const appliedAt = nowIso();
      const nextWallet = await upsertWalletEntity(repo, {
        ...wallet,
        balance: nextBalance,
        available_balance: nextBalance,
        metadata: {
          ...(wallet.metadata && typeof wallet.metadata === "object"
            ? wallet.metadata
            : {}),
          pay42_wallet: true,
          last_topup_at: appliedAt,
          last_topup_amount: amount,
        },
      });
      await appendWalletJournal(repo, nextWallet, {
        entryType: "wallet.topup",
        direction: "credit",
        amount,
        happenedAt: appliedAt,
        data: {
          method,
          source: "42pay.topup",
        },
      });
      const rows = await listType(repo, TOPUP_TYPE);
      const sid = slugId("P42T", `${method}_${actor.user_id}`);
      const topup = {
        id: rows.length + 1,
        sid,
        account_id: String(nextWallet.account_id || ""),
        user_id: text(actor.user_id),
        amount,
        method,
        status: "COMPLETED",
        create_at: appliedAt,
        created_at: appliedAt,
        updated_at: appliedAt,
        metadata:
          input.metadata && typeof input.metadata === "object"
            ? clone(input.metadata)
            : {},
      };
      await putType(repo, TOPUP_TYPE, sid, topup);
      return {
        ok: true,
        wallet: walletView(nextWallet, actor.user_id),
        topup: topupView(topup),
      };
    },

    async listAdminUsers({ actor = {}, users = [] } = {}) {
      ensureAdminActor(actor);
      const offers = await listType(repo, OFFER_TYPE);
      const orders = await listType(repo, ORDER_TYPE);
      const products = await listType(repo, PRODUCT_TYPE);
      const out = (Array.isArray(users) ? users : [])
        .map((user) => {
          const roles = normalizeRoles(user.roles);
          const userId = text(user.user_id);
          const sellerOffers = offers.filter((offer) => text(offer.seller_id) === userId);
          const buyerOrders = orders.filter((order) => text(order.buyer_id) === userId);
          const sellerOrders = orders.filter((order) => text(order.metadata?.seller_id) === userId);
          return {
            user_id: userId,
            name: text(user.name),
            email: text(user.email),
            roles,
            permissions: Array.isArray(user.permissions) ? clone(user.permissions) : [],
            product_count: products.filter((product) => text(product.create_sid) === userId).length,
            offer_count: sellerOffers.length,
            sales_count: sellerOrders.length,
            buyer_order_count: buyerOrders.length,
          };
        })
        .filter((user) => user.roles.some((roleId) => ["admin", "seller", "buyer"].includes(roleId)));
      return { ok: true, items: out };
    },

    async getDashboardSummary({ actor = {}, users = [] } = {}) {
      const products = await this.listProducts({ actor: isSeller(actor) ? actor : { roles: ["admin"] } });
      const offers = await this.listOffers({ actor });
      const orders = await this.listOrders({ actor });
      const walletSummary = !isAdmin(actor) ? await this.getWalletSummary({ actor }) : null;
      const activeOffers = offers.items.filter((offer) => statusActiveForDate(offer));
      if (isAdmin(actor)) {
        const userRows = Array.isArray(users) ? users : [];
        return {
          ok: true,
          role: "admin",
          cards: [
            { key: "sellers", label: "Sellers", value: userRows.filter((user) => normalizeRoles(user.roles).includes("seller")).length },
            { key: "buyers", label: "Buyers", value: userRows.filter((user) => normalizeRoles(user.roles).includes("buyer")).length },
            { key: "products", label: "Products", value: products.items.length },
            { key: "offers", label: "Offers", value: offers.items.length },
            { key: "orders", label: "Orders", value: orders.items.length },
            { key: "gmv", label: "GMV", value: sum(orders.items, "profit") + sum(orders.items, "tax") },
          ],
          recent_orders: orders.items.slice(0, 8),
        };
      }
      if (isSeller(actor)) {
        return {
          ok: true,
          role: "seller",
          wallet_summary: walletSummary?.wallet_totals || null,
          cards: [
            { key: "products", label: "Products", value: products.items.length },
            { key: "active_offers", label: "Active Offers", value: activeOffers.length },
            { key: "transactions", label: "Transactions", value: orders.items.length },
            { key: "sales_value", label: "Sales Value", value: sum(orders.items, "profit") + sum(orders.items, "tax") },
          ],
          recent_orders: orders.items.slice(0, 8),
        };
      }
      return {
        ok: true,
        role: "buyer",
        wallet_summary: walletSummary?.wallet_totals || null,
        cards: [
          { key: "offers", label: "Available Offers", value: activeOffers.length },
          { key: "orders", label: "My Orders", value: orders.items.length },
          { key: "spend", label: "Total Spend", value: sum(orders.items, "profit") + sum(orders.items, "tax") },
        ],
        recent_orders: orders.items.slice(0, 8),
      };
    },
  };
}

module.exports = {
  PAY42_SCOPE,
  PRODUCT_TYPE,
  OFFER_TYPE,
  ORDER_TYPE,
  TOPUP_TYPE,
  resolve42PayObjectStoreOptions,
  resolve42PayProjectRoot,
  resolveLegacy42PaySqlitePath,
  resolveLegacy42PayJsonDataRoots,
  create42PayRepo,
};
