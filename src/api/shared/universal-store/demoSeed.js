"use strict";

async function seedUniversalStoreDemoData(facade) {
  await facade.init();
  const tenantId = "demo";

  const buyer = await facade.upsertEntity({
    tenantId,
    entityType: "user_account",
    entityKey: "wallet:buyer_demo",
    userId: "buyer_demo",
    ownerId: "buyer_demo",
    status: "ACTIVE",
    data: {
      account_id: "wallet:buyer_demo",
      account_type: "wallet",
      currency: "USD",
      balance: 1500,
      payment_domain: "42pay",
    },
  });

  const seller = await facade.upsertEntity({
    tenantId,
    entityType: "user_account",
    entityKey: "wallet:seller_demo",
    userId: "seller_demo",
    ownerId: "seller_demo",
    status: "ACTIVE",
    data: {
      account_id: "wallet:seller_demo",
      account_type: "wallet",
      currency: "USD",
      balance: 900,
      payment_domain: "42pay",
    },
  });

  const product = await facade.upsertEntity({
    tenantId,
    entityType: "catalog_product",
    entityKey: "product:city_break",
    ownerId: "seller_demo",
    status: "ACTIVE",
    data: {
      sid: "DEMO_PRODUCT_CITY_BREAK",
      name: "City Break Package",
      category: "travel",
    },
  });

  await facade.upsertLink({
    tenantId,
    fromEntityId: seller.id,
    toEntityId: product.id,
    fromType: seller.entityType,
    toType: product.entityType,
    linkType: "owns",
    userId: "seller_demo",
    status: "ACTIVE",
  });

  await facade.appendJournal({
    tenantId,
    entityId: buyer.id,
    entityType: buyer.entityType,
    entityKey: buyer.entityKey,
    userId: "buyer_demo",
    entryType: "wallet.credit",
    direction: "credit",
    amount: 1500,
    currency: "USD",
    data: {
      reason: "demo topup",
    },
  });

  await facade.appendJournal({
    tenantId,
    entityId: seller.id,
    entityType: seller.entityType,
    entityKey: seller.entityKey,
    userId: "seller_demo",
    entryType: "wallet.credit",
    direction: "credit",
    amount: 900,
    currency: "USD",
    data: {
      reason: "opening balance",
    },
  });

  await facade.upsertProcess({
    tenantId,
    processType: "reminder",
    topic: "wallet.low_balance",
    entityId: buyer.id,
    entityType: buyer.entityType,
    entityKey: buyer.entityKey,
    userId: "buyer_demo",
    status: "PENDING",
    priority: 5,
    payload: {
      threshold: 250,
    },
  });

  return {
    tenantId,
    seeded: true,
  };
}

module.exports = {
  seedUniversalStoreDemoData,
};
