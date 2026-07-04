import { resolveRuntimeProviderConfig } from "../config/runtimeConfig.js";
import { AutomationFacade } from "../facades/AutomationFacade.js";
import { CacheFacade } from "../facades/CacheFacade.js";
import { StreamingFacade } from "../facades/StreamingFacade.js";
import { PubSubFacade } from "../facades/PubSubFacade.js";
import { ChartHistoryFacade } from "../facades/ChartHistoryFacade.js";
import { PROVIDER_IDS } from "../contracts/providerTypes.js";
import { BullMQAutomationProvider } from "../providers/automation/BullMQAutomationProvider.js";
import { NodeTimerAutomationProvider } from "../providers/automation/NodeTimerAutomationProvider.js";
import { InMemoryCacheProvider } from "../providers/cache/InMemoryCacheProvider.js";
import { RedisCacheProvider } from "../providers/cache/RedisCacheProvider.js";
import { InMemoryPubSubProvider } from "../providers/pubsub/InMemoryPubSubProvider.js";
import { RedisPubSubProvider } from "../providers/pubsub/RedisPubSubProvider.js";
import { SocketIoStreamingProvider } from "../providers/streaming/SocketIoStreamingProvider.js";
import { SseStreamingProvider } from "../providers/streaming/SseStreamingProvider.js";
import { BufferedChartHistoryProvider } from "../providers/chartHistory/BufferedChartHistoryProvider.js";

function createPubSubProvider({
  providerId = PROVIDER_IDS.pubsub.memory,
  env = process.env,
  redis = {},
} = {}) {
  if (providerId === PROVIDER_IDS.pubsub.redis) {
    return new RedisPubSubProvider({
      url: env?.REDIS_URL,
      ...redis,
    });
  }

  return new InMemoryPubSubProvider();
}

function createStreamingProviders(dependencies) {
  return {
    [PROVIDER_IDS.streaming.socketio]: new SocketIoStreamingProvider(dependencies),
    [PROVIDER_IDS.streaming.sse]: new SseStreamingProvider(dependencies),
  };
}

function createAutomationProvider({
  providerId = PROVIDER_IDS.automation.node_timer,
  bullmqFactory = {},
  bullConnection = null,
} = {}) {
  if (providerId === PROVIDER_IDS.automation.bullmq) {
    return new BullMQAutomationProvider({
      QueueClass: bullmqFactory.queue,
      WorkerClass: bullmqFactory.worker,
      connection: bullConnection,
    });
  }

  return new NodeTimerAutomationProvider();
}

function createCacheProvider({
  providerId = PROVIDER_IDS.cache.memory,
  env = process.env,
  redis = {},
} = {}) {
  if (providerId === PROVIDER_IDS.cache.redis) {
    return new RedisCacheProvider({
      url: env?.REDIS_URL,
      ...redis,
    });
  }

  return new InMemoryCacheProvider();
}

function createChartHistoryProviders({ cache, chartHistory = {} } = {}) {
  return {
    buffered: new BufferedChartHistoryProvider({
      cache,
      loadSnapshot: chartHistory.loadSnapshot,
      refreshHistory: chartHistory.refreshHistory,
      bufferMultiplier: chartHistory.bufferMultiplier,
      defaultBars: chartHistory.defaultBars,
    }),
  };
}

export function createAppRuntime(options = {}) {
  const config = resolveRuntimeProviderConfig(options);
  const automation = new AutomationFacade(
    createAutomationProvider({
      providerId: config.providers.automation,
      bullmqFactory: options.bullmqFactory,
      bullConnection: options.bullConnection,
    }),
  );
  const pubsub = new PubSubFacade(
    createPubSubProvider({
      providerId: config.providers.pubsub,
      env: options.env,
      redis: options.pubsub?.redis,
    }),
  );
  const streamingProviders = createStreamingProviders({ pubsub });
  const streaming = new StreamingFacade(
    {
      providers: streamingProviders,
      defaultProviderId: config.providers.streaming,
    },
  );
  const cache = new CacheFacade(
    createCacheProvider({
      providerId: config.providers.cache,
      env: options.env,
      redis: options.cache?.redis,
    }),
  );
  const chartHistoryProviders = createChartHistoryProviders({
    cache,
    chartHistory: options.chartHistory,
  });
  const chartHistory = new ChartHistoryFacade({
    providers: chartHistoryProviders,
    defaultProviderId: "buffered",
  });

  const runtime = {
    config,
    streaming,
    pubsub,
    automation,
    cache,
    chartHistory,
    getDiagnostics: () => ({
      providers: {
        automation: automation.getStatus(),
        streaming: streaming.getStatus(),
        pubsub: pubsub.getStatus(),
        cache: cache.getStatus(),
        chartHistory: chartHistory.getStatus(),
      },
    }),
    close: async () => {
      await automation.close();
      await pubsub.close();
      await cache.close();
      await chartHistory.close();
    },
  };

  return runtime;
}
