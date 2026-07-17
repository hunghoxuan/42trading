"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createUniversalStoreFacade,
  seedUniversalStoreDemoData,
} = require("./index");

function tempSqlitePath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `universal-store-${label}-`));
  return path.join(dir, "universal.sqlite");
}

test("universal store facade supports CRUD, filters, links, journal, and processes on sqlite", async () => {
  const facade = createUniversalStoreFacade({
    provider: "sqlite",
    sqlitePath: tempSqlitePath("crud"),
  });

  const account = await facade.upsertEntity({
    tenantId: "tenant_alpha",
    entityType: "user_account",
    entityKey: "wallet:user_alpha",
    userId: "user_alpha",
    ownerId: "user_alpha",
    status: "ACTIVE",
    data: {
      account_type: "wallet",
      currency: "USD",
      balance: 1000,
    },
  });

  const product = await facade.upsertEntity({
    tenantId: "tenant_alpha",
    entityType: "catalog_product",
    entityKey: "product:alpha",
    ownerId: "seller_alpha",
    status: "ACTIVE",
    data: {
      name: "Alpha Product",
      category: "travel",
    },
  });

  await facade.upsertLink({
    tenantId: "tenant_alpha",
    fromEntityId: account.id,
    toEntityId: product.id,
    fromType: account.entityType,
    toType: product.entityType,
    linkType: "favorites",
    userId: "user_alpha",
    status: "ACTIVE",
  });

  await facade.appendJournal({
    tenantId: "tenant_alpha",
    entityId: account.id,
    entityType: account.entityType,
    entityKey: account.entityKey,
    userId: "user_alpha",
    entryType: "wallet.credit",
    direction: "credit",
    amount: 1000,
    currency: "USD",
    data: { reason: "seed" },
  });

  await facade.upsertProcess({
    tenantId: "tenant_alpha",
    processType: "reminder",
    topic: "wallet.review",
    entityId: account.id,
    entityType: account.entityType,
    entityKey: account.entityKey,
    userId: "user_alpha",
    status: "PENDING",
    payload: { level: "info" },
  });

  const entityRows = await facade.listEntities({
    tenantId: "tenant_alpha",
    entityType: "user_account",
    userId: "user_alpha",
  });
  assert.equal(entityRows.length, 1);
  assert.equal(entityRows[0].entityKey, "wallet:user_alpha");

  const searchRows = await facade.listEntities({
    tenantId: "tenant_alpha",
    search: "alpha product",
  });
  assert.equal(searchRows.some((row) => row.entityKey === "product:alpha"), true);

  const userLinks = await facade.getUserLinks("tenant_alpha", "user_alpha");
  assert.equal(userLinks.length, 1);
  assert.equal(userLinks[0].linkType, "favorites");

  const userJournal = await facade.getUserJournal("tenant_alpha", "user_alpha");
  assert.equal(userJournal.length, 1);
  assert.equal(userJournal[0].entryType, "wallet.credit");

  const processes = await facade.listProcesses({
    tenantId: "tenant_alpha",
    processType: "reminder",
  });
  assert.equal(processes.length, 1);
  assert.equal(processes[0].topic, "wallet.review");
});

test("universal store facade preserves scope and visibility fields on entities", async () => {
  const facade = createUniversalStoreFacade({
    provider: "sqlite",
    sqlitePath: tempSqlitePath("entity-v2"),
  });

  const listing = await facade.upsertEntity({
    tenantId: "tenant_scope",
    entityType: "listing",
    entityKey: "listing:bike-1",
    title: "Road Bike",
    category: "marketplace",
    subtype: "goods",
    state: "published",
    visibility: "PUBLIC",
    accessLevel: "TENANT_READ",
    scopeType: "MODULE",
    scopeTenantId: "tenant_scope",
    scopeModule: "marketplace",
    scopeUserId: "seller_1",
    ownerId: "seller_1",
    ownerTeamId: "team_sales",
    currency: "usd",
    price: 799.99,
    balance: 0,
    locale: "en-US",
    countryCode: "us",
    sourceSystem: "internal",
    sourceId: "bike-1",
    scheduledAt: "2026-07-10T12:00:00.000Z",
    data: { brand: "Demo" },
    meta: { featured: true },
  });

  assert.equal(listing.visibility, "PUBLIC");
  assert.equal(listing.scopeType, "MODULE");
  assert.equal(listing.scopeModule, "marketplace");
  assert.equal(listing.currency, "USD");
  assert.equal(listing.countryCode, "US");
  assert.equal(Number(listing.price), 799.99);
  assert.equal(listing.meta.featured, true);

  const rows = await facade.listEntities({
    tenantId: "tenant_scope",
    visibility: "PUBLIC",
    scopeType: "MODULE",
    scopeModule: "marketplace",
    category: "marketplace",
    sourceSystem: "internal",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entityKey, "listing:bike-1");
});

test("seedUniversalStoreDemoData populates a sqlite database with reusable demo rows", async () => {
  const sqlitePath = tempSqlitePath("seed");
  const facade = createUniversalStoreFacade({
    provider: "sqlite",
    sqlitePath,
  });

  const out = await seedUniversalStoreDemoData(facade);

  assert.equal(out.seeded, true);

  const entities = await facade.listEntities({
    tenantId: "demo",
  });
  const journal = await facade.listJournal({
    tenantId: "demo",
  });
  const processes = await facade.listProcesses({
    tenantId: "demo",
  });

  assert.equal(entities.length >= 3, true);
  assert.equal(journal.length >= 2, true);
  assert.equal(processes.length >= 1, true);
  assert.equal(fs.existsSync(sqlitePath), true);
});
