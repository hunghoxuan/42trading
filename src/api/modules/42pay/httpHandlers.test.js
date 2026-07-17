"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handle42PayDashboard,
  handle42PayProductsList,
  handle42PayProductUpsert,
  handle42PayOffersList,
  handle42PayOfferUpsert,
  handle42PayOrdersList,
  handle42PayWalletSummary,
  handle42PayWalletTopupsList,
  handle42PayWalletTopup,
  handle42PayOrderCreate,
  handle42PayScanPreview,
  handle42PayAdminUsers,
} = require("./httpHandlers");

function fakeUrl(input) {
  return new URL(input, "http://localhost");
}

test("42Pay HTTP handlers map route/query/body inputs into service calls", async () => {
  const calls = [];
  const actor = { user_id: "seller_1", roles: ["seller"] };
  const users = [{ user_id: "seller_1" }];
  const service = {
    async getDashboardSummary(input) {
      calls.push(["getDashboardSummary", input]);
      return { ok: true, cards: [] };
    },
    async listProducts(input) {
      calls.push(["listProducts", input]);
      return { ok: true, items: [] };
    },
    async upsertProduct(input, options) {
      calls.push(["upsertProduct", input, options]);
      return { ok: true, item: input };
    },
    async listOffers(input) {
      calls.push(["listOffers", input]);
      return { ok: true, items: [] };
    },
    async upsertOffer(input, options) {
      calls.push(["upsertOffer", input, options]);
      return { ok: true, item: input };
    },
    async listOrders(input) {
      calls.push(["listOrders", input]);
      return { ok: true, items: [] };
    },
    async getWalletSummary(input) {
      calls.push(["getWalletSummary", input]);
      return { ok: true, wallet: null };
    },
    async listWalletTopups(input) {
      calls.push(["listWalletTopups", input]);
      return { ok: true, items: [] };
    },
    async topupWallet(input, options) {
      calls.push(["topupWallet", input, options]);
      return { ok: true, item: input };
    },
    async createOrderFromQrCode(input, options) {
      calls.push(["createOrderFromQrCode", input, options]);
      return { ok: true, order: input };
    },
    async previewOrderFromQrCode(input, options) {
      calls.push(["previewOrderFromQrCode", input, options]);
      return { ok: true, preview: input };
    },
    async listAdminUsers(input) {
      calls.push(["listAdminUsers", input]);
      return { ok: true, items: input.users };
    },
  };

  await handle42PayDashboard({ service, actor, users });
  await handle42PayProductsList({
    url: fakeUrl("/42pay/products?status=ACTIVE&query=robot&seller_id=seller_2"),
    service,
    actor,
  });
  const upsertProductOut = await handle42PayProductUpsert({
    payload: { title: "Starter Pack" },
    service,
    actor,
    route: { sid: "PROD_1" },
  });
  await handle42PayOffersList({
    url: fakeUrl("/42pay/offers?status=ACTIVE&product_id=PROD_1&include_inactive=true"),
    service,
    actor,
  });
  const upsertOfferOut = await handle42PayOfferUpsert({
    payload: { price: 49.99 },
    service,
    actor,
    route: { sid: "OFF_1" },
  });
  await handle42PayOrdersList({
    url: fakeUrl("/42pay/orders?status=PAID&buyer_id=buyer_1&seller_id=seller_2"),
    service,
    actor,
  });
  await handle42PayWalletSummary({ service, actor });
  await handle42PayWalletTopupsList({
    url: fakeUrl("/42pay/wallet/topups?limit=7"),
    service,
    actor,
  });
  await handle42PayWalletTopup({
    payload: { amount: 100, method: "manual" },
    service,
    actor,
  });
  await handle42PayOrderCreate({
    payload: { qr_code: "42pay:{...}" },
    service,
    actor,
  });
  await handle42PayScanPreview({
    payload: { qr_code: "42pay:{...}" },
    service,
    actor,
  });
  const adminUsersOut = await handle42PayAdminUsers({ service, actor, users });

  assert.equal(upsertProductOut.item.sid, "PROD_1");
  assert.equal(upsertOfferOut.item.sid, "OFF_1");
  assert.equal(adminUsersOut.items.length, 1);

  assert.deepEqual(calls[0][1], {
    actor,
    users,
  });
  assert.deepEqual(calls[1][1], {
    actor,
    status: "ACTIVE",
    query: "robot",
    seller_id: "seller_2",
  });
  assert.equal(calls[2][1].sid, "PROD_1");
  assert.equal(calls[2][2].actor.user_id, "seller_1");
  assert.equal(calls[3][1].include_inactive, true);
  assert.equal(calls[4][1].sid, "OFF_1");
  assert.equal(calls[5][1].buyer_id, "buyer_1");
  assert.equal(calls[6][1].actor.user_id, "seller_1");
  assert.equal(calls[7][1].limit, 7);
  assert.equal(calls[8][1].amount, 100);
  assert.equal(calls[9][0], "createOrderFromQrCode");
  assert.equal(calls[10][0], "previewOrderFromQrCode");
  assert.equal(calls[11][0], "listAdminUsers");
});
