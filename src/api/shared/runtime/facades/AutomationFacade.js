export class AutomationFacade {
  constructor(provider) {
    this.provider = provider;
  }

  scheduleRecurring(name, options) {
    return this.provider.scheduleRecurring(name, options);
  }

  enqueueNow(name, payload) {
    return this.provider.enqueueNow(name, payload);
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
