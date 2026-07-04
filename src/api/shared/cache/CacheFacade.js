"use strict";

class CacheFacade {
  constructor(provider) {
    this.provider = provider;
  }

  async get(key) {
    return this.provider.get(key);
  }

  async set(key, value, options) {
    return this.provider.set(key, value, options);
  }

  async delete(key) {
    return this.provider.delete(key);
  }

  async ttl(key) {
    return this.provider.ttl(key);
  }

  async deletePrefix(prefix) {
    if (typeof this.provider.deletePrefix !== "function") return 0;
    return this.provider.deletePrefix(prefix);
  }

  getStatus() {
    if (typeof this.provider.getStatus !== "function") {
      return {
        id: this.provider?.id || "unknown",
        ready: true,
      };
    }
    return this.provider.getStatus();
  }

  async close() {
    if (typeof this.provider.close !== "function") return;
    await this.provider.close();
  }
}

module.exports = {
  CacheFacade,
};
