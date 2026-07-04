function normalizeRegistrationHandle(handle) {
  if (typeof handle === "function") {
    if (typeof handle.unsubscribe !== "function") {
      handle.unsubscribe = handle;
    }
    if (!handle.ready || typeof handle.ready.then !== "function") {
      handle.ready = Promise.resolve();
    }
    return handle;
  }

  const unsubscribe =
    typeof handle?.unsubscribe === "function" ? () => handle.unsubscribe() : () => {};
  unsubscribe.unsubscribe = unsubscribe;
  unsubscribe.ready =
    handle?.ready && typeof handle.ready.then === "function"
      ? handle.ready
      : Promise.resolve();
  return unsubscribe;
}

export class PubSubFacade {
  constructor(provider) {
    this.provider = provider;
  }

  publish(topic, envelope) {
    return this.provider.publish(topic, envelope);
  }

  subscribe(topic, listener) {
    return normalizeRegistrationHandle(this.provider.subscribe(topic, listener));
  }

  registerStreamSink(topic, sink) {
    if (typeof this.provider.registerStreamSink !== "function") {
      return normalizeRegistrationHandle(() => {});
    }
    return normalizeRegistrationHandle(this.provider.registerStreamSink(topic, sink));
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
