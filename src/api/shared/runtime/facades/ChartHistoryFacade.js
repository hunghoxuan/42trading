export class ChartHistoryFacade {
  constructor({ providers = {}, defaultProviderId = "buffered" } = {}) {
    this.providers = providers;
    this.defaultProviderId = defaultProviderId;
  }

  getProvider(providerId = this.defaultProviderId) {
    return this.providers[providerId] || null;
  }

  resolveRange(request = {}, providerId = this.defaultProviderId) {
    const provider = this.getProvider(providerId);
    if (!provider || typeof provider.resolveRange !== "function") {
      throw new Error(`Chart history provider unavailable: ${providerId}`);
    }
    return provider.resolveRange(request);
  }

  getStatus() {
    const provider = this.getProvider(this.defaultProviderId);
    if (typeof provider?.getStatus === "function") {
      return provider.getStatus();
    }
    return {
      id: this.defaultProviderId,
      ready: Boolean(provider),
    };
  }

  async close() {
    const provider = this.getProvider(this.defaultProviderId);
    if (typeof provider?.close !== "function") return;
    await provider.close();
  }
}
