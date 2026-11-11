# Directional strategy variants — v187

Four additional options are available in all five Strategies selectors:

| Option | Parent implementation | Allowed entry direction |
| --- | --- | --- |
| emacross_buy | EmaCrossV1 | BUY |
| emacross_sell | EmaCrossV1 | SELL |
| ichimoku_buy | ichimoku | BUY |
| ichimoku_sell | ichimoku | SELL |

They filter genuine parent strategy signals; they do not reverse opposite signals. Detection, causal market data and indicator calculations reuse the parent implementation. Each variant has its own catalog identity, broker label, trade history and Max Total Win idea (Strategy + Symbol + TF). Existing enum values remain unchanged; the four new values are appended.

Required indicator data and order/confluence parameters come from each variant's config, initialized to its parent's settings. If a variant config is unavailable, strategy-data preparation falls back to the parent's config. Omitted settings retain the existing shared-parameter fallback. Existing indicator caches reuse identical configurations rather than creating independent feeds.

Ichimoku variants preserve the normal Ichimoku cloud-edge Auto SL, selected SL Buffer and Chikou exit. Their exit definitions act only on their own positions; the normal Ichimoku exit does not claim a variant position.

The same side restriction applies to execution detection, reconstructed trade markers and strategy matching, including SEQUENCE_ANY_SIDE and WINDOW_ANY_SIDE prerequisite evidence. An emacross_buy signal can never stand in for a SELL prerequisite. Opposite signals are rejected even if downstream adaptive/reverse settings request the other execution direction. Final broker submission enforces the variant's side from its order label, including split children and queued entries. Closing or reducing an existing position remains allowed.

Source definitions: src/config/strategies/emacross_buy.json, emacross_sell.json, ichimoku_buy.json and ichimoku_sell.json. Native implementation: TVBridge_CTrader.cs with data-profile fallback in TVBridge_CTrader.StrategyData.cs.

Verification uses real parent BUY and SELL detections, filtered variants, geometry parity, causal future mutation, visual and ANY_SIDE evidence filtering, required-data scopes, Ichimoku exit ownership and the actual common broker boundary. Config definitions are schema validated; active native DLL and parameter metadata are checked after full-file sync/build.
