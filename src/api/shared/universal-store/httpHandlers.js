"use strict";

function text(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

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

async function handleUniversalEntitiesList({ url, service }) {
  const items = await service.listEntities({
    tenantId: queryValue(url, "tenant_id", "tenantId") || "default",
    entityType: queryValue(url, "entity_type", "entityType"),
    userId: queryValue(url, "user_id", "userId"),
    ownerId: queryValue(url, "owner_id", "ownerId"),
    parentId: queryValue(url, "parent_id", "parentId"),
    state: queryValue(url, "state"),
    category: queryValue(url, "category"),
    subtype: queryValue(url, "subtype"),
    status: queryValue(url, "status"),
    visibility: queryValue(url, "visibility"),
    accessLevel: queryValue(url, "access_level", "accessLevel"),
    scopeType: queryValue(url, "scope_type", "scopeType"),
    scopeTenantId: queryValue(url, "scope_tenant_id", "scopeTenantId"),
    scopeModule: queryValue(url, "scope_module", "scopeModule"),
    scopeUserId: queryValue(url, "scope_user_id", "scopeUserId"),
    lang: url.searchParams.get("lang"),
    locale: url.searchParams.get("locale"),
    countryCode: queryValue(url, "country_code", "countryCode"),
    currency: queryValue(url, "currency"),
    sourceSystem: queryValue(url, "source_system", "sourceSystem"),
    sourceId: queryValue(url, "source_id", "sourceId"),
    search: queryValue(url, "search", "q"),
    sortBy: queryValue(url, "sort_by", "sortBy"),
    sortDirection: queryValue(url, "sort_direction", "sortDirection"),
    limit: num(queryValue(url, "limit"), 200),
    offset: num(queryValue(url, "offset"), 0),
  });
  return { ok: true, items };
}

async function handleUniversalEntityUpsert({ payload, service, route = {} }) {
  const item = await service.createOrUpdateEntity({
    ...(payload || {}),
    ...(route.tenantId ? { tenantId: route.tenantId } : {}),
    ...(route.entityType ? { entityType: route.entityType } : {}),
    ...(route.entityKey ? { entityKey: route.entityKey } : {}),
  });
  return { ok: true, item };
}

async function handleUniversalEntityGet({ url, service, route = {} }) {
  const item = await service.getEntity({
    tenantId: route.tenantId || "default",
    entityType: route.entityType || "",
    entityKey: route.entityKey || "",
    lang: queryValue(url, "lang"),
  });
  return { ok: true, item };
}

async function handleUniversalEntityDelete({ url, service, route = {} }) {
  return service.deleteEntity({
    tenantId: route.tenantId || "default",
    entityType: route.entityType || "",
    entityKey: route.entityKey || "",
    lang: queryValue(url, "lang"),
  });
}

async function handleUniversalLinksList({ url, service }) {
  const items = await service.listLinks({
    tenantId: queryValue(url, "tenant_id", "tenantId") || "default",
    fromEntityId: queryValue(url, "from_entity_id", "fromEntityId"),
    toEntityId: queryValue(url, "to_entity_id", "toEntityId"),
    linkType: queryValue(url, "link_type", "linkType"),
    userId: queryValue(url, "user_id", "userId"),
    status: queryValue(url, "status"),
    sortBy: queryValue(url, "sort_by", "sortBy"),
    sortDirection: queryValue(url, "sort_direction", "sortDirection"),
    limit: num(queryValue(url, "limit"), 200),
    offset: num(queryValue(url, "offset"), 0),
  });
  return { ok: true, items };
}

async function handleUniversalLinkUpsert({ payload, service }) {
  const item = await service.createOrUpdateLink(payload || {});
  return { ok: true, item };
}

async function handleUniversalLinkDelete({ service, route = {} }) {
  return service.deleteLink({ id: route.id || "" });
}

async function handleUniversalJournalList({ url, service }) {
  const items = await service.listJournal({
    tenantId: queryValue(url, "tenant_id", "tenantId") || "default",
    entityId: queryValue(url, "entity_id", "entityId"),
    entityType: queryValue(url, "entity_type", "entityType"),
    entityKey: queryValue(url, "entity_key", "entityKey"),
    userId: queryValue(url, "user_id", "userId"),
    entryType: queryValue(url, "entry_type", "entryType"),
    search: queryValue(url, "search", "q"),
    sortBy: queryValue(url, "sort_by", "sortBy"),
    sortDirection: queryValue(url, "sort_direction", "sortDirection"),
    limit: num(queryValue(url, "limit"), 200),
    offset: num(queryValue(url, "offset"), 0),
  });
  return { ok: true, items };
}

async function handleUniversalJournalAppend({ payload, service }) {
  const item = await service.appendJournal(payload || {});
  return { ok: true, item };
}

async function handleUniversalProcessesList({ url, service }) {
  const items = await service.listProcesses({
    tenantId: queryValue(url, "tenant_id", "tenantId") || "default",
    processType: queryValue(url, "process_type", "processType"),
    topic: queryValue(url, "topic"),
    entityId: queryValue(url, "entity_id", "entityId"),
    userId: queryValue(url, "user_id", "userId"),
    status: queryValue(url, "status"),
    dueOnly: queryValue(url, "due_only", "dueOnly"),
    now: queryValue(url, "now"),
    sortBy: queryValue(url, "sort_by", "sortBy"),
    sortDirection: queryValue(url, "sort_direction", "sortDirection"),
    limit: num(queryValue(url, "limit"), 200),
    offset: num(queryValue(url, "offset"), 0),
  });
  return { ok: true, items };
}

async function handleUniversalProcessUpsert({ payload, service }) {
  const item = await service.createOrUpdateProcess(payload || {});
  return { ok: true, item };
}

async function handleUniversalUserLinks({ url, service, route = {} }) {
  const items = await service.getUserLinks({
    tenantId: queryValue(url, "tenant_id", "tenantId") || "default",
    userId: route.userId || "",
    linkType: queryValue(url, "link_type", "linkType"),
    status: queryValue(url, "status"),
    limit: num(queryValue(url, "limit"), 200),
    offset: num(queryValue(url, "offset"), 0),
  });
  return { ok: true, items };
}

async function handleUniversalUserJournal({ url, service, route = {} }) {
  const items = await service.getUserJournal({
    tenantId: queryValue(url, "tenant_id", "tenantId") || "default",
    userId: route.userId || "",
    entityType: queryValue(url, "entity_type", "entityType"),
    entityKey: queryValue(url, "entity_key", "entityKey"),
    entryType: queryValue(url, "entry_type", "entryType"),
    limit: num(queryValue(url, "limit"), 200),
    offset: num(queryValue(url, "offset"), 0),
  });
  return { ok: true, items };
}

module.exports = {
  handleUniversalEntitiesList,
  handleUniversalEntityUpsert,
  handleUniversalEntityGet,
  handleUniversalEntityDelete,
  handleUniversalLinksList,
  handleUniversalLinkUpsert,
  handleUniversalLinkDelete,
  handleUniversalJournalList,
  handleUniversalJournalAppend,
  handleUniversalProcessesList,
  handleUniversalProcessUpsert,
  handleUniversalUserLinks,
  handleUniversalUserJournal,
};
