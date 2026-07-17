"use strict";

const { createUniversalStoreFacade } = require("./facade");

function text(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function boolFlag(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeListFilters(filters = {}) {
  return {
    tenantId: text(filters.tenantId || filters.tenant_id || "default", "default"),
    entityType: text(filters.entityType || filters.entity_type),
    userId: text(filters.userId || filters.user_id),
    ownerId: text(filters.ownerId || filters.owner_id),
    parentId: text(filters.parentId || filters.parent_id),
    state: text(filters.state),
    category: text(filters.category),
    subtype: text(filters.subtype),
    status: text(filters.status),
    visibility: text(filters.visibility),
    accessLevel: text(filters.accessLevel || filters.access_level),
    scopeType: text(filters.scopeType || filters.scope_type),
    scopeTenantId: text(filters.scopeTenantId || filters.scope_tenant_id),
    scopeModule: text(filters.scopeModule || filters.scope_module),
    scopeUserId: text(filters.scopeUserId || filters.scope_user_id),
    lang:
      filters.lang === undefined || filters.lang === null
        ? undefined
        : String(filters.lang),
    locale:
      filters.locale === undefined || filters.locale === null
        ? undefined
        : String(filters.locale),
    countryCode: text(filters.countryCode || filters.country_code),
    currency: text(filters.currency),
    sourceSystem: text(filters.sourceSystem || filters.source_system),
    sourceId: text(filters.sourceId || filters.source_id),
    search: text(filters.search || filters.q),
    sortBy: text(filters.sortBy || filters.sort_by),
    sortDirection: text(filters.sortDirection || filters.sort_direction),
    limit: Number(filters.limit) || 200,
    offset: Number(filters.offset) || 0,
    dueOnly: boolFlag(filters.dueOnly || filters.due_only),
    now: text(filters.now),
    topic: text(filters.topic),
    processType: text(filters.processType || filters.process_type),
    linkType: text(filters.linkType || filters.link_type),
    fromEntityId: text(filters.fromEntityId || filters.from_entity_id),
    toEntityId: text(filters.toEntityId || filters.to_entity_id),
    entityId: text(filters.entityId || filters.entity_id),
    entityKey: text(filters.entityKey || filters.entity_key),
    entryType: text(filters.entryType || filters.entry_type),
  };
}

class UniversalStoreService {
  constructor(options = {}) {
    this.facade =
      options.facade && typeof options.facade.init === "function"
        ? options.facade
        : createUniversalStoreFacade(options);
  }

  async init() {
    await this.facade.init();
    return this;
  }

  info() {
    return this.facade.info();
  }

  async createOrUpdateEntity(input = {}) {
    return this.facade.upsertEntity(input);
  }

  async getEntity({ tenantId = "default", entityType = "", entityKey = "", lang = "" } = {}) {
    return this.facade.getEntity(tenantId, entityType, entityKey, { lang });
  }

  async listEntities(filters = {}) {
    return this.facade.listEntities(normalizeListFilters(filters));
  }

  async deleteEntity({ tenantId = "default", entityType = "", entityKey = "", lang = "" } = {}) {
    await this.facade.deleteEntity(tenantId, entityType, entityKey, { lang });
    return { ok: true };
  }

  async createOrUpdateLink(input = {}) {
    return this.facade.upsertLink(input);
  }

  async listLinks(filters = {}) {
    return this.facade.listLinks(normalizeListFilters(filters));
  }

  async getUserLinks({ tenantId = "default", userId = "", ...filters } = {}) {
    return this.facade.getUserLinks(tenantId, userId, normalizeListFilters(filters));
  }

  async deleteLink({ id = "" } = {}) {
    await this.facade.deleteLink(id);
    return { ok: true };
  }

  async appendJournal(input = {}) {
    return this.facade.appendJournal(input);
  }

  async listJournal(filters = {}) {
    return this.facade.listJournal(normalizeListFilters(filters));
  }

  async getUserJournal({ tenantId = "default", userId = "", ...filters } = {}) {
    return this.facade.getUserJournal(tenantId, userId, normalizeListFilters(filters));
  }

  async createOrUpdateProcess(input = {}) {
    return this.facade.upsertProcess(input);
  }

  async listProcesses(filters = {}) {
    return this.facade.listProcesses(normalizeListFilters(filters));
  }
}

function createUniversalStoreService(options = {}) {
  return new UniversalStoreService(options);
}

module.exports = {
  UniversalStoreService,
  createUniversalStoreService,
  normalizeListFilters,
};
