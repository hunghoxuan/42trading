"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handleUniversalEntitiesList,
  handleUniversalEntityUpsert,
  handleUniversalLinksList,
  handleUniversalJournalList,
  handleUniversalProcessesList,
  handleUniversalUserLinks,
  handleUniversalUserJournal,
} = require("./httpHandlers");

function fakeUrl(input) {
  return new URL(input, "http://localhost");
}

test("universal-store HTTP handlers map query params into service filters", async () => {
  const calls = [];
  const service = {
    async listEntities(input) {
      calls.push(["listEntities", input]);
      return [{ id: "ent_1" }];
    },
    async createOrUpdateEntity(input) {
      calls.push(["createOrUpdateEntity", input]);
      return { id: "ent_2", ...input };
    },
    async listLinks(input) {
      calls.push(["listLinks", input]);
      return [{ id: "lnk_1" }];
    },
    async listJournal(input) {
      calls.push(["listJournal", input]);
      return [{ id: "jrnl_1" }];
    },
    async listProcesses(input) {
      calls.push(["listProcesses", input]);
      return [{ id: "prc_1" }];
    },
    async getUserLinks(input) {
      calls.push(["getUserLinks", input]);
      return [{ id: "lnk_user" }];
    },
    async getUserJournal(input) {
      calls.push(["getUserJournal", input]);
      return [{ id: "jrnl_user" }];
    },
  };

  const entitiesOut = await handleUniversalEntitiesList({
    url: fakeUrl("/v2/universal-store/entities?tenant_id=t1&entity_type=wallet&user_id=u1&search=demo&sort_by=updated_at&sort_direction=desc&limit=10&offset=5"),
    service,
  });
  const upsertOut = await handleUniversalEntityUpsert({
    payload: { status: "ACTIVE" },
    route: { tenantId: "t1", entityType: "wallet", entityKey: "wallet:u1" },
    service,
  });
  const linksOut = await handleUniversalLinksList({
    url: fakeUrl("/v2/universal-store/links?tenant_id=t1&link_type=owns&limit=2"),
    service,
  });
  const journalOut = await handleUniversalJournalList({
    url: fakeUrl("/v2/universal-store/journal?tenant_id=t1&entry_type=wallet.credit&limit=3"),
    service,
  });
  const processesOut = await handleUniversalProcessesList({
    url: fakeUrl("/v2/universal-store/processes?tenant_id=t1&process_type=reminder&due_only=true"),
    service,
  });
  const userLinksOut = await handleUniversalUserLinks({
    url: fakeUrl("/v2/universal-store/users/u1/links?tenant_id=t1&link_type=owns"),
    route: { userId: "u1" },
    service,
  });
  const userJournalOut = await handleUniversalUserJournal({
    url: fakeUrl("/v2/universal-store/users/u1/journal?tenant_id=t1&entry_type=wallet.credit"),
    route: { userId: "u1" },
    service,
  });

  assert.equal(entitiesOut.items.length, 1);
  assert.equal(upsertOut.item.entityKey, "wallet:u1");
  assert.equal(linksOut.items.length, 1);
  assert.equal(journalOut.items.length, 1);
  assert.equal(processesOut.items.length, 1);
  assert.equal(userLinksOut.items.length, 1);
  assert.equal(userJournalOut.items.length, 1);

  assert.deepEqual(calls[0][1], {
    tenantId: "t1",
    entityType: "wallet",
    userId: "u1",
    ownerId: "",
    parentId: "",
    state: "",
    category: "",
    subtype: "",
    status: "",
    visibility: "",
    accessLevel: "",
    scopeType: "",
    scopeTenantId: "",
    scopeModule: "",
    scopeUserId: "",
    lang: null,
    locale: null,
    countryCode: "",
    currency: "",
    sourceSystem: "",
    sourceId: "",
    search: "demo",
    sortBy: "updated_at",
    sortDirection: "desc",
    limit: 10,
    offset: 5,
  });
  assert.equal(calls[1][1].tenantId, "t1");
  assert.equal(calls[2][1].linkType, "owns");
  assert.equal(calls[3][1].entryType, "wallet.credit");
  assert.equal(calls[4][1].processType, "reminder");
  assert.equal(calls[5][1].userId, "u1");
  assert.equal(calls[6][1].userId, "u1");
});
