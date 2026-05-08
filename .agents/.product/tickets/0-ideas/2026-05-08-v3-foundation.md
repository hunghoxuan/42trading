# V3 Phase 1: Desktop App (Tauri + React)

> 2026-05-08 | In Progress

Connect to current v2 webhook. Zero backend changes.

## Tasks
- [ ] Scaffold `app/ui/` — Vite + React + TypeScript
- [ ] Tauri v2 shell — Mac + Windows + Linux
- [ ] Configurable API root URL (local/VPS switch)
- [ ] Reuse v2 design tokens + components
- [ ] TanStack Query for data fetching
- [ ] SSE stream for realtime
- [ ] Build + verify on macOS

## NOT in Phase 1
- No Hono, Drizzle, or backend migration
- v2 webhook stays as-is

## Phase 2 (later)
- Migrate webhook to Hono + Drizzle if/when needed
