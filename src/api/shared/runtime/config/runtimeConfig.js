import { PROVIDER_IDS } from "../contracts/providerTypes.js";

export const DEFAULT_RUNTIME_PROVIDER_IDS = Object.freeze({
  automation: PROVIDER_IDS.automation.node_timer,
  streaming: PROVIDER_IDS.streaming.socketio,
  pubsub: PROVIDER_IDS.pubsub.memory,
  cache: PROVIDER_IDS.cache.memory,
});

function normalizeProviderId(value = "", fallback = "") {
  const raw = String(value || "").trim().toLowerCase();
  return raw || fallback;
}

function resolveProviderId(value, allowedProviders, fallback) {
  const normalized = normalizeProviderId(value, fallback);
  return Object.values(allowedProviders).includes(normalized)
    ? normalized
    : fallback;
}

export function resolveRuntimeProviderConfig({ env = process.env } = {}) {
  return {
    providers: {
      automation: resolveProviderId(
        env.AUTOMATION_PROVIDER,
        PROVIDER_IDS.automation,
        DEFAULT_RUNTIME_PROVIDER_IDS.automation,
      ),
      streaming: resolveProviderId(
        env.STREAMING_PROVIDER,
        PROVIDER_IDS.streaming,
        DEFAULT_RUNTIME_PROVIDER_IDS.streaming,
      ),
      pubsub: resolveProviderId(
        env.PUBSUB_PROVIDER,
        PROVIDER_IDS.pubsub,
        DEFAULT_RUNTIME_PROVIDER_IDS.pubsub,
      ),
      cache: resolveProviderId(
        env.CACHE_PROVIDER,
        PROVIDER_IDS.cache,
        DEFAULT_RUNTIME_PROVIDER_IDS.cache,
      ),
    },
  };
}
