"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { create42PayService } = require("./service");

function tempSqlitePath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `42pay-service-${label}-`));
  return path.join(dir, "42pay.sqlite");
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
  };
}

test("42Pay service exposes the facade-backed storage behavior through a stable module boundary", async () => {
  const service = create42PayService({
    sqlitePath: tempSqlitePath("service"),
    objectStore: { provider: "sqlite" },
    accounts: createAccountAdapter(),
  });

  const storage = service.getStorageInfo();
  assert.equal(storage.provider, "sqlite");

  await service.seedInitialData();

  const products = await service.listProducts({
    actor: { user_id: "admin", roles: ["admin"] },
  });
  const offers = await service.listOffers({
    actor: { user_id: "user", roles: ["buyer"] },
  });
  const wallet = await service.getWalletSummary({
    actor: { user_id: "user", roles: ["buyer"] },
  });

  assert.equal(products.ok, true);
  assert.equal(products.items.length >= 4, true);
  assert.equal(offers.items.length >= 4, true);
  assert.equal(wallet.ok, true);
  assert.equal(wallet.wallet.user_id, "user");
});

test("42Pay service supports preview and purchase flows on sqlite through the service boundary", async () => {
  const service = create42PayService({
    sqlitePath: tempSqlitePath("purchase-flow"),
    objectStore: { provider: "sqlite" },
    accounts: createAccountAdapter([
      {
        account_id: "42pay_wallet_user",
        user_id: "user",
        name: "Buyer Wallet",
        balance: 600,
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
    ]),
  });

  await service.seedInitialData();
  const offers = await service.listOffers({
    actor: { user_id: "user", roles: ["buyer"] },
  });
  const offer = offers.items.find((item) => item.sid === "P42O_HANOI_HERITAGE_2N");

  const preview = await service.previewOrderFromQrCode(
    { qr_code: offer.qr_code },
    { actor: { user_id: "user", roles: ["buyer"] } },
  );
  const order = await service.createOrderFromQrCode(
    { qr_code: offer.qr_code },
    { actor: { user_id: "user", roles: ["buyer"] } },
  );

  assert.equal(preview.ok, true);
  assert.equal(preview.payment.total_amount, 139.32);
  assert.equal(order.ok, true);
  assert.equal(order.order.status, "PAID");
});
