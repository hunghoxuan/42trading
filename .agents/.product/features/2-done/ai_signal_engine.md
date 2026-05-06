# Feature: AI Signal Engine

## User Flow
The heart of the system. It transforms raw market data into actionable trade plans using Large Language Models (LLMs).

## Key Capabilities
- **Multi-Model Support**: Integration with Google Gemini, Anthropic Claude, and OpenAI.
- **Context Injection**: Automatically attaches relevant chart data, indicators, and recent price action to the prompt.
- **Signal Templates**: Pre-defined prompts for different strategies (e.g., SMC, ICT, Price Action).
- **Consensus Mode**: Option to require multiple AI models to agree before generating a signal.
- **Automatic Fanout**: Once a signal is generated, it is automatically fanned out to all active user accounts.

## Technical Details
- **Endpoints**: `/v2/ai/generate`, `/v2/ai/multi-generate`, `/v2/ai/templates`.
- **Logic**: Prompt engineering via `signal_generator.prompt`, context gathering from TwelveData/Binance.
- **Audit**: Every AI request and response is logged in the `logs` table for review.
- **Schema Source of Truth**: Backend prompt-building and frontend AI schema display both consume `/Users/macmini/Trade/Bot/trading/shared/ai_response_schema.json`.
- **Compatibility**: Frontend analysis parsing supports the current `ai_full_analysis` wrapper and legacy flat payloads so stored AI outputs render consistently.
