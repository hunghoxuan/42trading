"use strict";

const { CACHE_PROVIDER_IDS } = require("../providerTypes");

class NoopCacheProvider {
  constructor() {
    this.id = CACHE_PROVIDER_IDS.noop;
  }

  async get() {
    return null;
  }

  async set() {
    return false;
  }

  async delete() {
    return false;
  }

  async ttl() {
    return null;
  }

  async deletePrefix() {
    return 0;
  }

  async close() {}

  getStatus() {
    return {
      id: this.id,
      ready: true,
    };
  }
}

module.exports = {
  NoopCacheProvider,
};
