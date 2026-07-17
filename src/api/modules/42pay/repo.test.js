"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  create42PayRepo,
  PAY42_SCOPE,
} = require("./repo");
const { createUniversalStoreFacade } = require("../../shared/universal-store");

function tempSqlitePath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `42pay-${label}-`));
  return path.join(dir, "42pay.sqlite");
}

function tempProjectRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `42pay-project-${label}-`));
}

function createSqliteRepoOptions(label, accounts) {
  return {
    sqlitePath: tempSqlitePath(label),
    objectStore: { provider: "sqlite" },
    accounts,
  };
}

function createJsonRepoOptions(label, accounts) {
  const projectRoot = tempProjectRoot(label);
  return {
    projectRoot,
    objectStore: {
      provider: "json",
      dataRoot: path.join(projectRoot, "data", "users"),
    },
    accounts,
  };
}

async function openUniversalStore(sqlitePath) {
  const facade = createUniversalStoreFacade({
    provider: "sqlite",
    sqlitePath,
  });
  await facade.init();
  return facade;
}

function createAccountAdapter(initialAccounts = []) {
  const accounts = new Map();
  for (const account of Array.isArray(initialAccounts) ? initialAccounts : []) {
    accounts.set(String(account.account_id), {
      ...account,
      metadata:
        account.metadata && typeof account.metadata === "object"
          ? JSON.parse(JSON.stringify(account.metadata))
          : {},
    });
  }
  return {
    async listUserAccounts(userId) {
      return [...accounts.values()].filter(
        (account) => String(account.user_id || "") === String(userId || ""),
      );
    },
    async ensureWalletAccount(config = {}) {
      const existing = [...accounts.values()].find(
        (account) =>
          String(account.user_id || "") === String(config.user_id || "") &&
          account?.metadata?.pay42_wallet === true,
      );
      if (existing) return { ...existing };
      const account_id = `42pay_wallet_${String(config.user_id || "user").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      const created = {
        account_id,
        user_id: String(config.user_id || ""),
        name: String(config.name || account_id),
        balance: Number(config.default_balance || 0),
        status: "ACTIVE",
        metadata: {
          pay42_wallet: true,
          role: String(config.role || ""),
        },
      };
      accounts.set(account_id, created);
      return { ...created };
    },
    async updateAccountBalance(accountId, patch = {}) {
      const current = accounts.get(String(accountId || ""));
      if (!current) throw new Error("account not found");
      const next = {
        ...current,
        balance:
          patch.balance === null || patch.balance === undefined
            ? current.balance
            : Number(patch.balance),
        metadata:
          patch.metadata && typeof patch.metadata === "object"
            ? JSON.parse(JSON.stringify(patch.metadata))
            : current.metadata,
      };
      accounts.set(String(accountId || ""), next);
      return { ok: true, item: { ...next } };
    },
    snapshot() {
      return [...accounts.values()].map((account) => ({ ...account }));
    },
  };
}

test("seedInitialData writes realistic products and offers, with buyer history empty by default", async () => {
  const accounts = createAccountAdapter();
  const repo = create42PayRepo(createSqliteRepoOptions("seed", accounts));

  const seeded = await repo.seedInitialData();

  assert.equal(seeded.ok, true);
  assert.equal(seeded.products >= 4, true);
  assert.equal(seeded.offers >= 4, true);
  assert.equal(seeded.orders, 0);

  const products = await repo.listProducts({ actor: { user_id: "admin", roles: ["admin"] } });
  const offers = await repo.listOffers({ actor: { user_id: "user", roles: ["buyer"] } });
  const orders = await repo.listOrders({ actor: { user_id: "admin", roles: ["admin"] } });

  assert.equal(products.items.some((item) => /hotel/i.test(item.type)), true);
  assert.equal(offers.items.every((item) => item.qr_code), true);
  assert.equal(orders.items.length, 0);
  assert.equal(PAY42_SCOPE, "__42pay__");
});

test("create42PayRepo defaults to postgres object storage", async () => {
  const repo = create42PayRepo({
    accounts: createAccountAdapter(),
  });

  assert.equal(repo.getStorageInfo().provider, "postgres");
});

test("createOffer generates a QR code token and buyer can create an order from it", async () => {
  const accounts = createAccountAdapter([
    {
      account_id: "42pay_wallet_user",
      user_id: "user",
      name: "Buyer Wallet",
      balance: 2500,
      status: "ACTIVE",
      metadata: { pay42_wallet: true, role: "buyer" },
    },
    {
      account_id: "42pay_wallet_seller",
      user_id: "seller",
      name: "Seller Wallet",
      balance: 100,
      status: "ACTIVE",
      metadata: { pay42_wallet: true, role: "seller" },
    },
  ]);
  const repo = create42PayRepo(createSqliteRepoOptions("qr", accounts));
  await repo.seedInitialData();

  const createdProduct = await repo.upsertProduct(
    {
      name: "Riverfront Boutique Stay",
      image: "https://images.example.test/riverfront-boutique-stay.jpg",
      type: "hotel",
      status: "ACTIVE",
      metadata: {
        city: "Bangkok",
        nights: 2,
      },
    },
    {
      actor: {
        user_id: "seller",
        roles: ["seller"],
      },
    },
  );

  const createdOffer = await repo.upsertOffer(
    {
      product_id: createdProduct.product.sid,
      price: 249.5,
      tax: 17.47,
      seller_id: "seller",
      status: "ACTIVE",
      start_at: "2026-07-01T00:00:00.000Z",
      end_at: "2026-12-31T23:59:59.999Z",
      metadata: {
        room_type: "Deluxe King",
      },
    },
    {
      actor: {
        user_id: "seller",
        roles: ["seller"],
      },
    },
  );

  assert.match(String(createdOffer.offer.qr_code || ""), /^42pay:/);
  assert.match(String(createdOffer.offer.qr_code_image || ""), /^data:image\/png;base64,/);

  const createdOrder = await repo.createOrderFromQrCode(
    {
      qr_code: createdOffer.offer.qr_code,
      metadata: {
        payment_method: "PROMPTPAY",
      },
    },
    {
      actor: {
        user_id: "user",
        roles: ["buyer"],
      },
    },
  );

  assert.equal(createdOrder.ok, true);
  assert.equal(createdOrder.order.buyer_id, "user");
  assert.equal(createdOrder.order.product_offer_id, createdOffer.offer.sid);
  assert.equal(Number(createdOrder.order.tax) > 0, true);
  assert.equal(createdOrder.order.status, "PAID");
  const store = await openUniversalStore(repo.getStorageInfo().current_store_path);
  const buyerWalletEntity = await store.getEntity(PAY42_SCOPE, "user_account", "wallet:usd:user");
  const sellerWalletEntity = await store.getEntity(PAY42_SCOPE, "user_account", "wallet:usd:seller");
  const buyerJournal = await store.getUserJournal(PAY42_SCOPE, "user", {
    entityKey: "wallet:usd:user",
    limit: 20,
  });
  const sellerJournal = await store.getUserJournal(PAY42_SCOPE, "seller", {
    entityKey: "wallet:usd:seller",
    limit: 20,
  });
  assert.equal(Number(buyerWalletEntity.data.balance) < 2500, true);
  assert.equal(Number(sellerWalletEntity.data.balance) > 100, true);
  assert.equal(buyerJournal.some((entry) => entry.entryType === "wallet.order_debit"), true);
  assert.equal(sellerJournal.some((entry) => entry.entryType === "wallet.order_credit"), true);
});

test("previewOrderFromQrCode returns offer and wallet impact before payment", async () => {
  const accounts = createAccountAdapter([
    {
      account_id: "42pay_wallet_user",
      user_id: "user",
      name: "Buyer Wallet",
      balance: 500,
      status: "ACTIVE",
      metadata: { pay42_wallet: true, role: "buyer" },
    },
  ]);
  const repo = create42PayRepo(createSqliteRepoOptions("preview", accounts));
  await repo.seedInitialData();

  const offers = await repo.listOffers({
    actor: { user_id: "user", roles: ["buyer"] },
  });
  const targetOffer = offers.items.find((item) => item.sid === "P42O_HANOI_HERITAGE_2N");

  const preview = await repo.previewOrderFromQrCode(
    {
      qr_code: targetOffer.qr_code,
    },
    {
      actor: {
        user_id: "user",
        roles: ["buyer"],
      },
    },
  );

  assert.equal(preview.ok, true);
  assert.equal(preview.offer.sid, "P42O_HANOI_HERITAGE_2N");
  assert.equal(preview.payment.total_amount, 139.32);
  assert.equal(preview.payment.can_pay, true);
  assert.equal(preview.wallet.user_id, "user");
  assert.equal(preview.payment.balance_after < preview.payment.balance_before, true);
});

test("getDashboardSummary adapts counts by role", async () => {
  const accounts = createAccountAdapter();
  const repo = create42PayRepo(createSqliteRepoOptions("dashboard", accounts));
  await repo.seedInitialData();

  const adminSummary = await repo.getDashboardSummary({
    actor: { user_id: "admin", roles: ["admin"] },
    users: [
      { user_id: "admin", roles: ["admin"] },
      { user_id: "seller", roles: ["seller"] },
      { user_id: "user", roles: ["buyer"] },
    ],
  });
  const sellerSummary = await repo.getDashboardSummary({
    actor: { user_id: "seller", roles: ["seller"] },
  });
  const buyerSummary = await repo.getDashboardSummary({
    actor: { user_id: "user", roles: ["buyer"] },
  });

  assert.equal(adminSummary.cards.some((card) => card.key === "sellers"), true);
  assert.equal(sellerSummary.cards.some((card) => card.key === "products"), true);
  assert.equal(buyerSummary.cards.some((card) => card.key === "orders"), true);
});

test("getWalletSummary returns buyer wallet information", async () => {
  const accounts = createAccountAdapter();
  const repo = create42PayRepo(createSqliteRepoOptions("wallet", accounts));
  await repo.seedInitialData();

  const out = await repo.getWalletSummary({
    actor: { user_id: "user", roles: ["buyer"] },
  });
  const store = await openUniversalStore(repo.getStorageInfo().current_store_path);
  const walletEntity = await store.getEntity(PAY42_SCOPE, "user_account", "wallet:usd:user");
  const walletLinks = await store.getUserLinks(PAY42_SCOPE, "user", {
    linkType: "owns",
    limit: 20,
  });

  assert.equal(out.ok, true);
  assert.equal(out.wallet.user_id, "user");
  assert.equal(Number(out.wallet.balance), 0);
  assert.equal(walletEntity.data.account_type, "wallet");
  assert.equal(walletLinks.some((link) => link.toEntityId === walletEntity.id), true);
});

test("migrateLegacySqliteToProvider moves 42pay sqlite objects into the configured provider", async () => {
  const legacySqlitePath = tempSqlitePath("migrate-legacy");
  const projectRoot = tempProjectRoot("migrate");
  const legacyRepo = create42PayRepo({
    projectRoot,
    sqlitePath: legacySqlitePath,
    objectStore: {
      provider: "sqlite",
    },
    accounts: createAccountAdapter(),
  });
  await legacyRepo.seedInitialData();

  const migratedRepo = create42PayRepo({
    projectRoot,
    sqlitePath: tempSqlitePath("migrate-target"),
    legacySqlitePath,
    objectStore: {
      provider: "sqlite",
    },
    accounts: createAccountAdapter(),
  });
  const result = await migratedRepo.migrateLegacySqliteToProvider();
  const products = await migratedRepo.listProducts({
    actor: { user_id: "admin", roles: ["admin"] },
  });

  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.counts.products >= 4, true);
  assert.equal(products.items.length >= 4, true);
  assert.equal(fs.existsSync(legacySqlitePath), false);
});

test("migrateLegacyActorIds remaps legacy 42pay seller and buyer ids in existing objects", async () => {
  const accounts = createAccountAdapter([
    {
      account_id: "42pay_wallet_42pay_buyer",
      user_id: "42pay.buyer",
      name: "Legacy Buyer Wallet",
      balance: 500,
      status: "ACTIVE",
      metadata: { pay42_wallet: true, role: "buyer" },
    },
  ]);
  const repo = create42PayRepo(createJsonRepoOptions("actor-migrate", accounts));
  await repo.seedInitialData();

  await repo.upsertProduct(
    {
      sid: "LEGACY_PRODUCT",
      name: "Legacy Product",
      image: "",
      type: "hotel",
      status: "ACTIVE",
      metadata: {},
      create_sid: "42pay.seller",
    },
    {
      actor: { user_id: "admin", roles: ["admin"] },
    },
  );
  await repo.upsertOffer(
    {
      sid: "LEGACY_OFFER",
      product_id: "LEGACY_PRODUCT",
      price: 100,
      tax: 7,
      seller_id: "42pay.seller",
      status: "ACTIVE",
      start_at: "2026-07-01T00:00:00.000Z",
      end_at: "2026-12-31T23:59:59.999Z",
      metadata: {},
    },
    {
      actor: { user_id: "admin", roles: ["admin"] },
    },
  );
  const offersBefore = await repo.listOffers({
    actor: { user_id: "admin", roles: ["admin"] },
  });
  const legacyOffer = offersBefore.items.find((item) => item.sid === "LEGACY_OFFER");

  await repo.createOrderFromQrCode(
    { qr_code: legacyOffer.qr_code },
    { actor: { user_id: "42pay.buyer", roles: ["buyer"] } },
  );

  const result = await repo.migrateLegacyActorIds();
  const sellerProducts = await repo.listProducts({
    actor: { user_id: "seller", roles: ["seller"] },
  });
  const sellerOffers = await repo.listOffers({
    actor: { user_id: "seller", roles: ["seller"] },
  });
  const buyerOrders = await repo.listOrders({
    actor: { user_id: "user", roles: ["buyer"] },
  });

  assert.equal(result.ok, true);
  assert.equal(result.updated > 0, true);
  assert.equal(sellerProducts.items.some((item) => item.sid === "LEGACY_PRODUCT"), true);
  assert.equal(sellerOffers.items.some((item) => item.sid === "LEGACY_OFFER"), true);
  assert.equal(buyerOrders.items.some((item) => item.metadata?.seller_id === "seller"), true);
});
