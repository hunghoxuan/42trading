import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RUNTIME_PROVIDER_IDS,
  resolveRuntimeProviderConfig,
} from "../../shared/runtime/config/runtimeConfig.js";
import { createAppRuntime } from "../../shared/runtime/bootstrap/createAppRuntime.js";
import { AutomationFacade } from "../../shared/runtime/facades/AutomationFacade.js";
import { PubSubFacade } from "../../shared/runtime/facades/PubSubFacade.js";
import { StreamingFacade } from "../../shared/runtime/facades/StreamingFacade.js";

test("resolveRuntimeProviderConfig returns explicit provider ids from env", () => {
  const config = resolveRuntimeProviderConfig({
    env: {
      AUTOMATION_PROVIDER: "bullmq",
      STREAMING_PROVIDER: "socketio",
      PUBSUB_PROVIDER: "redis",
      CACHE_PROVIDER: "redis",
    },
  });

  assert.deepEqual(config.providers, {
    automation: "bullmq",
    streaming: "socketio",
    pubsub: "redis",
    cache: "redis",
  });
});

test("resolveRuntimeProviderConfig falls back to defaults when env is unset", () => {
  const config = resolveRuntimeProviderConfig({ env: {} });
  assert.deepEqual(config.providers, DEFAULT_RUNTIME_PROVIDER_IDS);
});

test("resolveRuntimeProviderConfig falls back to defaults for unknown provider ids", () => {
  const config = resolveRuntimeProviderConfig({
    env: {
      AUTOMATION_PROVIDER: "invalid-automation",
      STREAMING_PROVIDER: "invalid-streaming",
      PUBSUB_PROVIDER: "invalid-pubsub",
      CACHE_PROVIDER: "invalid-cache",
    },
  });

  assert.deepEqual(config.providers, DEFAULT_RUNTIME_PROVIDER_IDS);
});

test("createAppRuntime returns the composed runtime shape", () => {
  const config = resolveRuntimeProviderConfig({
    env: {
      AUTOMATION_PROVIDER: "bullmq",
      STREAMING_PROVIDER: "socketio",
      PUBSUB_PROVIDER: "redis",
      CACHE_PROVIDER: "redis",
    },
  });

  const runtime = createAppRuntime({
    env: {
      AUTOMATION_PROVIDER: "bullmq",
      STREAMING_PROVIDER: "socketio",
      PUBSUB_PROVIDER: "redis",
      CACHE_PROVIDER: "redis",
    },
  });

  assert.deepEqual(runtime.config, config);
  assert.ok(runtime.automation instanceof AutomationFacade);
  assert.ok(runtime.streaming instanceof StreamingFacade);
  assert.ok(runtime.pubsub instanceof PubSubFacade);
  assert.equal(typeof runtime.automation.scheduleRecurring, "function");
  assert.ok(runtime.cache);
  assert.equal(typeof runtime.cache.get, "function");
  assert.equal(typeof runtime.getDiagnostics, "function");
  assert.equal(typeof runtime.close, "function");
});
