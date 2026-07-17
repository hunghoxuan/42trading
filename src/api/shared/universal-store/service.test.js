"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createUniversalStoreService } = require("./service");

function tempSqlitePath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `universal-store-service-${label}-`));
  return path.join(dir, "service.sqlite");
}

test("universal store service supports user link and journal lookups with filters", async () => {
  const service = createUniversalStoreService({
    provider: "sqlite",
    sqlitePath: tempSqlitePath("service"),
  });

  const wallet = await service.createOrUpdateEntity({
    tenantId: "tenant_beta",
    entityType: "user_account",
    entityKey: "wallet:user_beta",
    userId: "user_beta",
    ownerId: "user_beta",
    status: "ACTIVE",
    data: {
      account_type: "wallet",
      balance: 240,
    },
  });

  const reminder = await service.createOrUpdateEntity({
    tenantId: "tenant_beta",
    entityType: "reminder_rule",
    entityKey: "reminder:wallet:user_beta",
    userId: "user_beta",
    ownerId: "user_beta",
    status: "ACTIVE",
    data: {
      threshold: 50,
    },
  });

  await service.createOrUpdateLink({
    tenantId: "tenant_beta",
    fromEntityId: wallet.id,
    toEntityId: reminder.id,
    fromType: wallet.entityType,
    toType: reminder.entityType,
    linkType: "has_reminder",
    userId: "user_beta",
    status: "ACTIVE",
  });

  await service.appendJournal({
    tenantId: "tenant_beta",
    entityId: wallet.id,
    entityType: wallet.entityType,
    entityKey: wallet.entityKey,
    userId: "user_beta",
    entryType: "wallet.debit",
    direction: "debit",
    amount: 10,
    currency: "USD",
    data: {
      reason: "demo purchase",
    },
  });

  const links = await service.getUserLinks({
    tenantId: "tenant_beta",
    userId: "user_beta",
    linkType: "has_reminder",
  });
  const journal = await service.getUserJournal({
    tenantId: "tenant_beta",
    userId: "user_beta",
    entryType: "wallet.debit",
  });

  assert.equal(links.length, 1);
  assert.equal(links[0].linkType, "has_reminder");
  assert.equal(journal.length, 1);
  assert.equal(journal[0].amount, 10);
});
