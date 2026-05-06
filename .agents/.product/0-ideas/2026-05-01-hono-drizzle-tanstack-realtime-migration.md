# Idea: Hono + Drizzle + TanStack + Realtime Migration

Date: 2026-05-01
Owner: AI (proposal)
Status: IDEA

## Why
- Reduce backend complexity and route sprawl.
- Add typed contracts end-to-end.
- Improve realtime UX (lower polling lag).
- Keep MT5/webhook execution reliability while modernizing UI/API incrementally.

## Proposed Stack
- API runtime: Hono (Node)
- DB access/migrations: Drizzle ORM + drizzle-kit
- Frontend server-state: TanStack Query
- UI primitives: shadcn/ui (adapt to existing dense trading layout)
- Realtime: WebSocket gateway + Redis pub/sub (or Postgres LISTEN/NOTIFY bridge)

## Non-Goals (Phase 1)
- No big-bang rewrite.
- No replacement of execution-critical webhook logic in one shot.
- No schema-breaking migration without compatibility layer.

## Migration Plan
1. Foundation
- Add Hono app scaffold under `webhook/hono/`.
- Add Drizzle schema mirror for current Postgres tables.
- Add shared API types package/module.

2. Parallel API (Strangler)
- Re-implement low-risk read routes first in Hono.
- Keep legacy routes active; route by prefix (`/v3/...`) during transition.
- Add parity tests for legacy vs new response shape.

3. Realtime Channel
- Add `GET /v3/stream` websocket endpoint.
- Publish signal/trade/account events from existing write path.
- Consume events in UI and patch TanStack cache.

4. UI Data Layer
- Introduce TanStack Query for AI/Signals/Trades pages.
- Move polling pages to query invalidation + websocket patching.
- Keep current UI look-and-feel; use shadcn components selectively.

5. Progressive Cutover
- Switch UI routes from legacy endpoints to `/v3` per module.
- Add metrics: p95 route latency, ws event lag, error rate.
- Remove legacy routes only after parity + soak period.

## Risks
- Dual-write/dual-read complexity during transition.
- Realtime backpressure if event volume spikes.
- Hidden coupling in current monolith route handlers.

## Guardrails
- Feature flags for each migrated module.
- Backward-compatible IDs (`id`, `sid`, legacy IDs).
- Keep deploy/version rule unchanged while migration is active.

## First Tickets To Create (if approved)
- `P0`: scaffold Hono + health route + auth middleware parity.
- `P1`: Drizzle schema and migration baseline for read modules.
- `P1`: websocket stream for signal/trade updates + UI subscriber.
- `P2`: migrate AI chart context read APIs to `/v3`.
