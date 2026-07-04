import { PROVIDER_IDS } from "../contracts/providerTypes.js";

export class StreamingFacade {
  constructor({ providers = {}, defaultProviderId = PROVIDER_IDS.streaming.socketio } = {}) {
    this.providers = providers;
    this.defaultProviderId = defaultProviderId;
  }

  getProvider(providerId) {
    return this.providers[providerId] || null;
  }

  attach(serverContext) {
    return this.getProvider(PROVIDER_IDS.streaming.socketio)?.attach(serverContext);
  }

  openTopicStream(streamContext) {
    return this.getProvider(PROVIDER_IDS.streaming.sse)?.openTopicStream(
      streamContext,
    );
  }

  getStatus() {
    const socketProvider = this.getProvider(PROVIDER_IDS.streaming.socketio);
    const sseProvider = this.getProvider(PROVIDER_IDS.streaming.sse);
    return {
      defaultProviderId: this.defaultProviderId,
      providers: {
        [PROVIDER_IDS.streaming.socketio]:
          typeof socketProvider?.getStatus === "function"
            ? socketProvider.getStatus()
            : {
                id: PROVIDER_IDS.streaming.socketio,
                ready: Boolean(socketProvider),
              },
        [PROVIDER_IDS.streaming.sse]:
          typeof sseProvider?.getStatus === "function"
            ? sseProvider.getStatus()
            : {
                id: PROVIDER_IDS.streaming.sse,
                ready: Boolean(sseProvider),
              },
      },
    };
  }
}
