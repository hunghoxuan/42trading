"use strict";

function num(value, fallback) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function queryValue(url, ...names) {
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value !== null && value !== undefined) return value;
  }
  return "";
}

function sidFromRoute(route = {}) {
  return String(route.sid || "").trim();
}

async function handle42PayDashboard({ service, actor = {}, users = [] }) {
  return service.getDashboardSummary({
    actor,
    users,
  });
}

async function handle42PayProductsList({ url, service, actor = {} }) {
  return service.listProducts({
    actor,
    status: queryValue(url, "status"),
    query: queryValue(url, "query", "q"),
    seller_id: queryValue(url, "seller_id", "sellerId"),
  });
}

async function handle42PayProductUpsert({ payload, service, actor = {}, route = {} }) {
  return service.upsertProduct(
    {
      ...(payload || {}),
      ...(sidFromRoute(route) ? { sid: sidFromRoute(route) } : {}),
    },
    { actor },
  );
}

async function handle42PayOffersList({ url, service, actor = {} }) {
  return service.listOffers({
    actor,
    status: queryValue(url, "status"),
    query: queryValue(url, "query", "q"),
    seller_id: queryValue(url, "seller_id", "sellerId"),
    product_id: queryValue(url, "product_id", "productId"),
    include_inactive:
      String(queryValue(url, "include_inactive", "includeInactive"))
        .trim()
        .toLowerCase() === "true",
  });
}

async function handle42PayOfferUpsert({ payload, service, actor = {}, route = {} }) {
  return service.upsertOffer(
    {
      ...(payload || {}),
      ...(sidFromRoute(route) ? { sid: sidFromRoute(route) } : {}),
    },
    { actor },
  );
}

async function handle42PayOrdersList({ url, service, actor = {} }) {
  return service.listOrders({
    actor,
    status: queryValue(url, "status"),
    query: queryValue(url, "query", "q"),
    buyer_id: queryValue(url, "buyer_id", "buyerId"),
    seller_id: queryValue(url, "seller_id", "sellerId"),
  });
}

async function handle42PayWalletSummary({ service, actor = {} }) {
  return service.getWalletSummary({
    actor,
  });
}

async function handle42PayWalletTopupsList({ url, service, actor = {} }) {
  return service.listWalletTopups({
    actor,
    limit: num(queryValue(url, "limit"), 50),
  });
}

async function handle42PayWalletTopup({ payload, service, actor = {} }) {
  return service.topupWallet(payload || {}, {
    actor,
  });
}

async function handle42PayOrderCreate({ payload, service, actor = {} }) {
  return service.createOrderFromQrCode(payload || {}, {
    actor,
  });
}

async function handle42PayScanPreview({ payload, service, actor = {} }) {
  return service.previewOrderFromQrCode(payload || {}, {
    actor,
  });
}

async function handle42PayAdminUsers({ service, actor = {}, users = [] }) {
  return service.listAdminUsers({
    actor,
    users,
  });
}

module.exports = {
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
};
