"use strict";

const path = require("path");
const { create42PayService } = require("./service");
const { createUniversalStoreFacade } = require("../../shared/universal-store");

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

async function main() {
  const sqlitePath = path.join(process.cwd(), ".local", "42pay-selftest.sqlite");
  const accounts = createAccountAdapter([
    {
      account_id: "42pay_wallet_user",
      user_id: "user",
      name: "Buyer Wallet",
      balance: 1000,
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

  const service = create42PayService({
    sqlitePath,
    objectStore: { provider: "sqlite" },
    accounts,
  });

  await service.seedInitialData();

  const offers = await service.listOffers({
    actor: { user_id: "user", roles: ["buyer"] },
  });
  const offer = offers.items.find((item) => item.sid === "P42O_HANOI_HERITAGE_2N");
  if (!offer) throw new Error("Expected seeded offer P42O_HANOI_HERITAGE_2N");

  const preview = await service.previewOrderFromQrCode(
    { qr_code: offer.qr_code },
    { actor: { user_id: "user", roles: ["buyer"] } },
  );
  const order = await service.createOrderFromQrCode(
    { qr_code: offer.qr_code },
    { actor: { user_id: "user", roles: ["buyer"] } },
  );
  const wallet = await service.getWalletSummary({
    actor: { user_id: "user", roles: ["buyer"] },
  });
  const store = createUniversalStoreFacade({
    provider: "sqlite",
    sqlitePath,
  });
  await store.init();
  const buyerWalletEntity = await store.getEntity("__42pay__", "user_account", "wallet:usd:user");
  const buyerWalletJournal = await store.getUserJournal("__42pay__", "user", {
    entityKey: "wallet:usd:user",
    limit: 20,
  });

  const summary = {
    sqlitePath,
    storage: service.getStorageInfo(),
    preview_total: preview.payment.total_amount,
    order_sid: order.order.sid,
    wallet_balance_reported: wallet.wallet?.balance ?? null,
    wallet_balance_stored: buyerWalletEntity?.data?.balance ?? null,
    wallet_journal_entries: buyerWalletJournal.length,
  };

  if (
    !order?.ok ||
    !preview?.ok ||
    !wallet?.ok ||
    !buyerWalletEntity ||
    !buyerWalletJournal.some((entry) => entry.entryType === "wallet.order_debit")
  ) {
    throw new Error(`42Pay self-test failed: ${JSON.stringify(summary)}`);
  }

  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
