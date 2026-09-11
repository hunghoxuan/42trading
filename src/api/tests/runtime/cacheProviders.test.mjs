import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import { createAppRuntime } from "../../shared/runtime/bootstrap/createAppRuntime.js";
import { InMemoryCacheProvider } from "../../shared/runtime/providers/cache/InMemoryCacheProvider.js";
import { RedisCacheProvider } from "../../shared/runtime/providers/cache/RedisCacheProvider.js";

const require = createRequire(import.meta.url);
const { createObjectStoreRepo } = require("../../shared/objects/objectStoreRepo.js");
const { createConfigStore } = require("../../shared/config/configStore.js");
const { createStrategyConfigService } = require("../../modules/42trade/strategies/strategyConfigService.js");

function createFakeRedisClientFactory() {
  const state = {
    values: new Map(),
    ttlMs: new Map(),
    connectCalls: 0,
    quitCalls: 0,
    disconnectCalls: 0,
  };

  return {
    state,
    createClient() {
      return {
        async connect() {
          state.connectCalls += 1;
        },
        async get(key) {
          return state.values.get(key) ?? null;
        },
        async set(key, value) {
          state.values.set(key, value);
          state.ttlMs.delete(key);
          return "OK";
        },
        async pSetEx(key, ttlMs, value) {
          state.values.set(key, value);
          state.ttlMs.set(key, ttlMs);
          return "OK";
        },
        async del(key) {
          const keys = Array.isArray(key) ? key : [key];
          let deleted = 0;
          for (const item of keys) {
            const existed = state.values.delete(item);
            state.ttlMs.delete(item);
            if (existed) deleted += 1;
          }
          return deleted;
        },
        async pTTL(key) {
          return state.ttlMs.has(key) ? state.ttlMs.get(key) : -1;
        },
        async scan(cursor, options = {}) {
          const pattern = String(options.MATCH || "");
          const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
          const keys = [...state.values.keys()].filter((key) =>
            String(key).startsWith(prefix),
          );
          return { cursor: 0, keys };
        },
        async quit() {
          state.quitCalls += 1;
        },
        async disconnect() {
          state.disconnectCalls += 1;
        },
      };
    },
  };
}

test("InMemoryCacheProvider stores values with TTL support", async () => {
  const provider = new InMemoryCacheProvider();

  provider.set("demo", { ok: true }, { ttlMs: 1000 });
  provider.set("demo:1", { ok: 1 });
  provider.set("demo:2", { ok: 2 });

  assert.deepEqual(provider.get("demo"), { ok: true });
  assert.ok(provider.ttl("demo") > 0);
  assert.equal(provider.deletePrefix("demo:"), 2);
  assert.equal(provider.delete("demo"), true);
  assert.equal(provider.get("demo"), null);

  await provider.close();
});

test("RedisCacheProvider reads and writes serialized values", async () => {
  const redis = createFakeRedisClientFactory();
  const provider = new RedisCacheProvider({
    createClient: redis.createClient,
  });

  await provider.set("chart:BTCUSD:1m", { close: 100 }, { ttlMs: 5000 });
  await provider.set("chart:BTCUSD:5m", { close: 101 }, { ttlMs: 5000 });
  await provider.set("other:key", { close: 102 }, { ttlMs: 5000 });

  assert.deepEqual(await provider.get("chart:BTCUSD:1m"), { close: 100 });
  assert.equal(await provider.ttl("chart:BTCUSD:1m"), 5000);
  assert.equal(await provider.deletePrefix("chart:BTCUSD:"), 2);
  assert.equal(await provider.delete("chart:BTCUSD:1m"), false);
  assert.equal(await provider.get("chart:BTCUSD:1m"), null);

  await provider.close();
  assert.equal(redis.state.quitCalls, 1);
});

test("createAppRuntime selects the Redis cache provider when configured", () => {
  const runtime = createAppRuntime({
    env: {
      CACHE_PROVIDER: "redis",
    },
  });

  assert.equal(runtime.config.providers.cache, "redis");
  assert.ok(runtime.cache.provider instanceof RedisCacheProvider);
});

test("createObjectStoreRepo caches object reads via the shared cache layer", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "object-store-cache-"));
  const repo = createObjectStoreRepo({
    provider: "json",
    dataRoot: path.join(rootDir, "data", "users"),
    cache: {
      provider: "memory",
    },
  });

  await repo.upsertObject("user_1", "demo", "sample", { value: 1 });
  assert.deepEqual(await repo.getObjectData("user_1", "demo", "sample"), {
    value: 1,
  });

  const objectPath = repo.objectDataPath("user_1", "demo", "sample");
  fs.writeFileSync(objectPath, `${JSON.stringify({ value: 2 }, null, 2)}\n`);

  assert.deepEqual(await repo.getObjectData("user_1", "demo", "sample"), {
    value: 1,
  });

  await repo.upsertObject("user_1", "demo", "sample", { value: 3 });
  assert.deepEqual(await repo.getObjectData("user_1", "demo", "sample"), {
    value: 3,
  });
});

test("createConfigStore reads src/config JSON through cached object-store access", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-store-cache-"));
  const configDir = path.join(rootDir, "src", "config");
  fs.mkdirSync(path.join(configDir, "schema"), { recursive: true });
  fs.mkdirSync(path.join(configDir, "strategies"), { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    `${JSON.stringify({ watchlist: ["EURUSD"] }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(configDir, "schema", "trade.json"),
    `${JSON.stringify({ title: "Trade" }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(configDir, "strategies", "alpha.json"),
    `${JSON.stringify({ key: "alpha", name: "Alpha" }, null, 2)}\n`,
  );

  const store = createConfigStore({
    projectRoot: rootDir,
    objectStore: {
      provider: "json",
      dataRoot: path.join(rootDir, "data", "users"),
      cache: {
        provider: "memory",
      },
    },
  });

  assert.deepEqual(await store.getConfig(), {
    watchlist: ["EURUSD"],
  });

  fs.writeFileSync(
    path.join(configDir, "config.json"),
    `${JSON.stringify({ watchlist: ["BTCUSD"] }, null, 2)}\n`,
  );

  assert.deepEqual(await store.getConfig(), {
    watchlist: ["EURUSD"],
  });
  assert.deepEqual(await store.getConfig({ refresh: true }), {
    watchlist: ["BTCUSD"],
  });
  assert.deepEqual(await store.getStrategy("alpha"), {
    key: "alpha",
    name: "Alpha",
  });
});

test("createStrategyConfigService loads schema and strategy functions through configStore", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-config-service-"));
  const configDir = path.join(rootDir, "src", "config");
  fs.mkdirSync(path.join(configDir, "schema"), { recursive: true });
  fs.mkdirSync(path.join(configDir, "strategies"), { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "schema", "strategy.json"),
    `${JSON.stringify({ $id: "test.strategy.schema" }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(configDir, "strategyFunctions.json"),
    `${JSON.stringify({
      operators: [{ value: "var" }, { value: "and" }, { value: ">" }],
      functions: [{ value: "crosses_above" }],
    }, null, 2)}\n`,
  );

  const service = createStrategyConfigService({
    configStore: createConfigStore({
      projectRoot: rootDir,
      objectStore: {
        provider: "json",
        dataRoot: path.join(rootDir, "data", "users"),
        cache: {
          provider: "memory",
        },
      },
    }),
  });

  const schema = await service.readSchema();
  assert.equal(schema.$id, "test.strategy.schema");

  const validation = await service.validateStrategyPayload({
    id: "demo",
    name: "Demo",
    engine_version: "42trade.strategy.v2",
    kind: "custom",
    status: "draft",
    params: {},
    indicators: [],
    rules: [
      {
        id: "rule_1",
        name: "Buy",
        when: { ">": [{ var: "indicators.fast" }, 1] },
        actions: [
          {
            id: "action_1",
            action: "trade",
            trade_plan: { direction: "buy", type: "market" },
          },
        ],
      },
    ],
    risk: {},
  });

  assert.equal(validation.ok, true);

  const saved = await service.saveStrategy("ignored-user", {
    ...validation.strategy,
    engine_version: "42trade.strategy.v3",
    settings: {
      trade_config: { entry: "L0" },
      confluences: { minimum_count: "_2" },
    },
  });
  assert.equal(saved.settings.trade_config.entry, "L0");
  assert.deepEqual((await service.listStrategies("other-user")).map((item) => item.id), ["demo"]);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(configDir, "strategies", "demo.json"), "utf8"))
      .settings.confluences.minimum_count,
    "_2",
  );
});
