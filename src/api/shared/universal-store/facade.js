"use strict";

const {
  createUniversalStoreAdapter,
  normalizeEntity,
  normalizeLink,
  normalizeJournal,
  normalizeProcess,
  defaultEntitySearchText,
} = require("./adapterFactory");

class UniversalStoreFacade {
  constructor(options = {}) {
    this.adapter =
      options.adapter && typeof options.adapter.init === "function"
        ? options.adapter
        : createUniversalStoreAdapter(options);
    this.ready = false;
  }

  async init() {
    if (this.ready) return this;
    await this.adapter.init();
    this.ready = true;
    return this;
  }

  info() {
    return this.adapter.getInfo();
  }

  async upsertEntity(input = {}) {
    await this.init();
    const normalized = normalizeEntity({
      ...input,
      searchText: input.searchText || defaultEntitySearchText(input),
    });
    return this.adapter.upsertEntity(normalized);
  }

  async getEntity(tenantId, entityType, entityKey, options = {}) {
    await this.init();
    return this.adapter.getEntity(tenantId, entityType, entityKey, options);
  }

  async listEntities(filters = {}) {
    await this.init();
    return this.adapter.listEntities(filters);
  }

  async deleteEntity(tenantId, entityType, entityKey, options = {}) {
    await this.init();
    return this.adapter.deleteEntity(tenantId, entityType, entityKey, options);
  }

  async upsertLink(input = {}) {
    await this.init();
    return this.adapter.upsertLink(normalizeLink(input));
  }

  async listLinks(filters = {}) {
    await this.init();
    return this.adapter.listLinks(filters);
  }

  async getUserLinks(tenantId, userId, filters = {}) {
    await this.init();
    return this.adapter.listLinks({
      ...filters,
      tenantId,
      userId,
    });
  }

  async deleteLink(id) {
    await this.init();
    return this.adapter.deleteLink(id);
  }

  async appendJournal(input = {}) {
    await this.init();
    return this.adapter.appendJournal(normalizeJournal(input));
  }

  async listJournal(filters = {}) {
    await this.init();
    return this.adapter.listJournal(filters);
  }

  async getUserJournal(tenantId, userId, filters = {}) {
    await this.init();
    return this.adapter.listJournal({
      ...filters,
      tenantId,
      userId,
    });
  }

  async upsertProcess(input = {}) {
    await this.init();
    return this.adapter.upsertProcess(normalizeProcess(input));
  }

  async listProcesses(filters = {}) {
    await this.init();
    return this.adapter.listProcesses(filters);
  }
}

function createUniversalStoreFacade(options = {}) {
  return new UniversalStoreFacade(options);
}

module.exports = {
  UniversalStoreFacade,
  createUniversalStoreFacade,
};
