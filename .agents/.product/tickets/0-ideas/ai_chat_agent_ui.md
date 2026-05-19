# AI Chat Agent UI (React Streaming Chat + TradePlan Widgets)

## Status: Idea

## Goal
Replace the current single-shot "Analyze" button with an interactive AI chat interface that supports streaming responses, multi-turn conversation, custom trade plan widgets, and cross-model verification.

## Recommended Stack

### Primary: Vercel AI SDK (`ai` + `@ai-sdk/*`)
**Why:** Best-in-class React streaming chat with provider-agnostic architecture.

| Feature | Vercel AI SDK |
|---|---|
| Streaming | Built-in SSE via `useChat` hook |
| Multi-provider | OpenAI, Anthropic, Google, Ollama, OpenRouter via unified provider interface |
| Custom widgets | `useChat` returns `data` array for structured content rendering |
| Tool calling | Native `tools` API — AI can call backend functions |
| Local models | Ollama adapter (`@ai-sdk/ollama`) |
| Bundle size | ~5KB gzipped |

### Alternatives Considered

| Option | Pros | Cons |
|---|---|---|
| **CopilotKit** | Prebuilt copilot UI, action system | Less mature, opinionated styling |
| **LangChain.js** | Agent framework, memory management | Overkill for chat UI, heavy bundle |
| **Custom SSE + React** | Full control | Rewrite state management, streaming parser, tool system |

## Architecture

```
Frontend (React)                    Backend (Node.js)
┌──────────────────────┐           ┌──────────────────────────┐
│  useChat({           │           │  POST /v2/ai/chat        │
│    api: "/v2/ai/chat"│  stream   │                          │
│  })                  │◄──────────│  Route to provider:      │
│                      │  SSE      │  • Claude → Anthropic    │
│  Messages[]          │           │  • OpenAI → OpenAI       │
│  │                   │           │  • DeepSeek → DeepSeek   │
│  ├─ Text blocks      │           │  • Llama → Ollama        │
│  ├─ TradePlan widget │           │  • OpenRouter → OpenRouter│
│  ├─ Chart widget     │           │                          │
│  └─ Action buttons   │           │  Tool calls:             │
│                      │           │  • fetch_trades          │
│  Widgets use `data`  │           │  • fetch_signals         │
│  array from useChat  │           │  • verify_with_model     │
│  for structured      │           │  • add_trade             │
│  content             │           │  • get_market_data       │
└──────────────────────┘           └──────────────────────────┘
```

## Key Features

### 1. Streaming chat (SSE)
- Messages appear token-by-token as AI generates
- User can interrupt, retry, or edit messages
- Supports multi-turn conversation (not just single-shot)

### 2. Custom Widgets via `data` array
The Vercel AI SDK's `useChat` hook returns a `data` array alongside `messages`. The backend can push structured JSON events that the frontend renders as custom React components:

```
Backend sends structured data events → Frontend renders:
  <TradePlanWidget tradePlan={...} onAddTrade={...} />
  <MarketAnalysisWidget pdArrays={...} keyLevels={...} />
  <ChartWidget symbol={...} interval={...} />
  <VerificationResultWidget modelA={...} modelB={...} />
```

Widget types:
- **TradePlanWidget** — Entry/SL/TP/RR/partials with Add Trade, Add Signal, Verify buttons
- **MarketAnalysisWidget** — HTF/execution/confirmation analysis with PD arrays
- **ChartWidget** — Embedded lightweight-charts
- **VerificationResultWidget** — Cross-model comparison results

### 3. Multi-model support
Users can:
- Select provider/model via dropdown (same as current UI)
- Send current conversation to another model for verification
- Compare responses side-by-side

### 4. Tool/Function calling
AI can call backend functions to fetch context:
- `get_active_trades()` — fetch user's current trades
- `get_pending_signals()` — fetch pending signals
- `get_market_data(symbol, timeframe)` — fetch bars
- `add_trade(trade_plan)` — execute trade from chat
- `verify_with(provider, model, prompt)` — ask another model

### 5. Local model integration
Via Ollama adapter (`@ai-sdk/ollama`):
- Run Llama, Mistral, etc. locally
- Privacy-sensitive analysis stays on-device
- Fallback to cloud providers for complex tasks

## Integration with Current System

### Phase 1: Chat alongside existing Analyze
- Add chat panel to AI browser page (right sidebar or bottom sheet)
- "Send to Chat" button on existing analyze result
- Chat uses same provider/model selection

### Phase 2: Replace Analyze with Chat
- Analyze button sends initial prompt to chat
- Result appears as first message with TradePlanWidget
- User can follow up naturally

### Phase 3: Agent mode
- Chat has access to tool calls
- "Show my open trades" → AI fetches trades via tool
- "Verify with DeepSeek" → AI calls another model
- "Add this trade" → AI creates trade via tool

## Packages Required

```json
{
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "@ai-sdk/google": "^1.0.0",
    "@ai-sdk/ollama": "^1.0.0"
  }
}
```

Total added bundle size: ~15KB gzipped

## Estimated Effort
- Phase 1 (chat panel + streaming): 2-3 days
- Phase 2 (widgets + trade plan integration): 1-2 days
- Phase 3 (tool calling + agent mode): 2-3 days
