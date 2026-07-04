# Runtime, Realtime, And Bars Updates

## Runtime Provider Model

| Runtime concern | Facade | Provider options in code | Default |
|---|---|---|---|
| Automation | `AutomationFacade` | `NodeTimerAutomationProvider`, `BullMQAutomationProvider` | `node_timer` |
| Cache | `CacheFacade` | In-memory, Redis | in-memory |
| Pub/sub | `PubSubFacade` | In-memory, Redis | in-memory |
| Streaming | `StreamingFacade` | Socket.IO, SSE | Socket.IO |
| Chart history | `ChartHistoryFacade` | Buffered chart-history provider | `buffered` |

## Why This Layer Exists

| Need | Current answer |
|---|---|
| Local dev should work with no Redis/BullMQ | Memory + node timer providers |
| Production can scale or coordinate across processes | Redis pub/sub and Redis cache providers |
| UI may need different realtime transports | Socket.IO and SSE are both first-class |
| Runtime diagnostics should be inspectable | `createAppRuntime()` exposes provider status via diagnostics |

## Realtime Topic Model

| Topic kind | Builder | Example |
|---|---|---|
| Chart | `buildChartTopic(symbol)` | `chart:EURUSD` |
| Replay | `buildReplayTopic(sessionId)` | `replay:session_123` |
| Notifications | `buildNotificationTopic(userId)` | `notifications:default` |
| MT5 / broker | `buildMt5Topic(userId)` | `mt5:default` |
| Trade | `buildTradeTopic(tradeSid)` | `trade:TFEHBAHP1` |
| News | `buildNewsTopic(scope)` | `news:today` |
| Logs | `buildLogTopic(source, objectId, file)` | `logs:objects:trade123:runtime.log` |

## Socket.IO Flow

| Step | File | Responsibility |
|---|---|---|
| Attach transport | `src/api/shared/runtime/providers/streaming/SocketIoStreamingProvider.js` | Wires Socket.IO server into runtime |
| Create server | `src/api/modules/42trade/realtime/realtimeSocketServer.js` | Handles auth, subscribe/unsubscribe, chart history requests |
| Parse topics | `src/api/modules/42trade/realtime/realtimeCore.js` | Validates and normalizes topic names |
| Fanout | `src/api/modules/42trade/realtime/realtimeTopicHub.js` and pub/sub sink | Pushes envelopes to listeners and sinks |
| Client state | `src/admin/realtime/stores/ChartStreamStore.js` | Tracks chart topic readiness, connectivity, last updates |

## SSE Role

| Area | Current role |
|---|---|
| Topic streaming | Alternate streaming provider in runtime |
| Envelope format | Same topic-oriented event model as Socket.IO |
| Simpler consumers | Useful when one-way stream semantics are enough |

## Realtime Bars Update Flow

| Stage | File(s) | What happens |
|---|---|---|
| Ingestion | `src/api/modules/42trade/marketData/forexLiveIngestorService.js` | Pulls live market data and batches symbol updates |
| Storage | `src/api/modules/42trade/marketData/marketDataRepo.js`, `marketDataCore.js` | Merges or overwrites canonical bar files |
| Snapshot load | `src/api/modules/42trade/realtime/chartStreamService.js` | Reads latest bars for a symbol/timeframe snapshot |
| Diffing | `diffChartSnapshots()` in `chartStreamService.js` | Emits either snapshot, `bar_update`, or `price_tick` |
| Fanout | `emitRealtimeTopic()` | Publishes topic envelopes to runtime streaming |

## Bars Storage Model

| Concern | Current behavior |
|---|---|
| Storage provider | Selected by `BARS_STORAGE_PROVIDER` |
| Supported providers | `csv`, `parquet_duckdb`, `postgres` |
| Canonical tf chain | `1`, `5`, `15`, `60`, `240`, `1440` |
| Derived timeframe rebuilds | Higher TFs can be rebuilt from canonical lower TF source |
| Read limits | Normalized and capped in market-data core |
| Repair flow | Suspicious duplicate/frozen-sequence repair helpers exist in market-data core |

## Multi-Timeframe Runtime Normalization

| Input forms | Normalized output |
|---|---|
| `1`, `1m`, `m1` | `1m` |
| `5`, `5m`, `m5` | `5m` |
| `15`, `15m`, `m15` | `15m` |
| `60`, `1h`, `h1` | `1h` |
| `240`, `4h`, `h4` | `4h` |
| `d`, `1d`, `day` | `d` |

## Operational Notes

| Setting | Meaning |
|---|---|
| `STREAMING_PROVIDER` | Chooses default runtime streaming transport |
| `PUBSUB_PROVIDER` | Chooses memory vs Redis topic propagation |
| `CACHE_PROVIDER` | Chooses memory vs Redis cache |
| `AUTOMATION_PROVIDER` | Chooses local timers vs BullMQ |
| `APP_ROLE` and runtime leader settings | Help separate web/API nodes from runtime workers |

## Cross-Reference

| Need | Read next |
|---|---|
| Trading and backtests | [trading-backtests.md](./trading-backtests.md) |
| Storage and integrations | [integrations-storage.md](./integrations-storage.md) |
| Schemas and timeframe contracts | [schema-reference.md](./schema-reference.md) |

