# DB Manager Miniapp Design

**Date:** 2026-06-15  
**Status:** Proposed  
**Scope:** Introduce a miniapp platform in `42trade` and onboard `db-manager` as the first miniapp without breaking existing routes or requiring a broad UI rewrite.

---

## Goal

Allow `42trade` to host standalone tools as miniapps, starting with `db-manager`, so they can be developed and deployed independently while still appearing inside the main `42trade` shell with shared auth, theme, navigation, and mobile-aware presentation.

## Non-Goals

- Rewriting current `42trade` pages into miniapps in the first slice
- Converting `db-manager` into a native in-shell React page
- Introducing Module Federation, single-spa, or shared runtime dependency graphs
- Replacing existing DB routes or data APIs during the first rollout

---

## Current Context

### 42trade

- The main shell lives in [`src/admin/src/App.jsx`](/Users/macmini/Projects/moza/42trade/src/admin/src/App.jsx).
- `42trade` already has system/admin routes and mobile-aware page patterns.
- `/system/db` and `/db` currently redirect away instead of rendering a DB page.
- `42trade` already exposes DB-oriented APIs in [`src/admin/src/api.js`](/Users/macmini/Projects/moza/42trade/src/admin/src/api.js) and [`src/api/server.js`](/Users/macmini/Projects/moza/42trade/src/api/server.js).

### db-manager

- `db-manager` is already a standalone HTTP app in [`src/apps/db-manager/server.js`](/Users/macmini/Projects/moza/42trade/src/apps/db-manager/server.js).
- It is currently local-only and launched separately.
- It already discovers DB targets from existing repo config and env conventions.

This makes `db-manager` a strong first miniapp because it already has the main property we want: **independent runtime and independent UI surface**.

---

## Recommended Architecture

Use a **shell + manifest + iframe bridge** architecture.

### Why this approach

- Matches the product constraint that miniapps can be built as standalone JS apps
- Minimizes coupling between `42trade` and miniapps
- Keeps failures isolated
- Avoids frontend build/runtime dependency drift
- Lets `db-manager` ship first with only moderate changes
- Makes later extraction of admin/operator tools much easier

### Rejected alternatives

#### Module Federation

Rejected for phase 1 because it creates tight runtime coupling around bundler versions, routing, shared libraries, and dependency negotiation. It is deeper integration than `42trade` needs right now.

#### Native page migration

Rejected for phase 1 because it would turn `db-manager` into another tightly coupled `42trade` subsystem instead of a reusable miniapp.

#### Raw iframe with no platform contract

Rejected because it becomes ungoverned quickly: no standard auth handoff, no title/theme synchronization, and no reusable path for later miniapps.

---

## Target Model

### Shell

`42trade` remains the host shell and owns:

- main auth gate
- main app navigation
- route registration
- role/permission checks
- theme and global UI framing
- miniapp registry and lifecycle

### Miniapp

Each miniapp is a standalone web app that:

- can run outside `42trade`
- can also run embedded inside `42trade`
- performs a lightweight host handshake
- accepts shell context
- can request limited host actions through a bridge

### Rendering mode

The first supported rendering mode is:

- `iframe`

This is the default and only required mode for phase 1.

---

## Miniapp Manifest

`42trade` should own a registry of miniapps with fields like:

- `id`
- `name`
- `version`
- `route`
- `entryUrl`
- `displayMode`
- `icon`
- `requiredRole`
- `mobileMode`
- `capabilities`
- `permissions`
- `status`

### Example for db-manager

```json
{
  "id": "db-manager",
  "name": "DB Manager",
  "version": "1.0.0",
  "route": "/miniapps/db-manager",
  "entryUrl": "http://127.0.0.1:8088",
  "displayMode": "iframe",
  "requiredRole": "system",
  "mobileMode": "fullpage",
  "capabilities": ["theme", "authContext", "title", "resize", "openExternal"],
  "permissions": ["db-manager:self"],
  "status": "enabled"
}
```

---

## Bridge Contract

Communication between shell and miniapp uses `postMessage`.

### Shell to miniapp

- `miniapp:handshake`
- `miniapp:theme`
- `miniapp:auth-context`
- `miniapp:viewport`
- `miniapp:route-context`

### Miniapp to shell

- `miniapp:ready`
- `miniapp:set-title`
- `miniapp:set-height`
- `miniapp:notify`
- `miniapp:open-external`
- `miniapp:navigate-host`

### Phase 1 principle

The bridge is **context-first**, not API-heavy.

That means the first version should pass:

- current user summary
- role
- theme
- environment label
- mobile/desktop layout hints

It should **not** start with a large RPC surface.

---

## Routing Strategy

Add first-class miniapp routes under:

- `/miniapps`
- `/miniapps/:miniappId`

### db-manager rollout

- Add `/miniapps/db-manager`
- Change `/system/db` to either:
  - redirect to `/miniapps/db-manager`, or
  - render a small launcher/summary page with “Open DB Manager”

Recommended first move:

- `/system/db` redirects to `/miniapps/db-manager`

This preserves discoverability and avoids breaking users who expect a DB page.

---

## Mobile Behavior

This architecture is mobile-friendly if the shell owns layout behavior.

### Desktop

- render miniapp in normal shell content area
- keep shell nav/header visible
- use a framed embedded presentation

### Mobile

- use full-page miniapp mode inside the shell content area
- reduce extra chrome
- provide an “Open standalone” fallback
- use host bridge updates for viewport and safe-area changes

### Constraint

The architecture does not make `db-manager` responsive automatically. `db-manager` still needs responsive treatment for:

- wide tables
- query results
- toolbar density
- schema/detail panes

So mobile support is feasible, but it needs:

- moderate shell work
- targeted miniapp UI polish

---

## Impact On Current 42trade Pages

Impact should be low to moderate and mostly additive.

### What changes

- add a miniapp registry
- add miniapp container route(s)
- add a shell bridge
- add nav entry for `db-manager`
- update `/system/db`

### What does not need to change

- existing dashboard/trade/settings pages
- existing shell auth flow
- most current routes
- current native DB API endpoints

The miniapp platform should coexist beside today’s app, not replace it.

---

## Impact On db-manager

### Phase 1

Required changes should be small:

- add host-detection logic
- add postMessage handshake support
- accept theme/auth/layout context from host
- suppress duplicate chrome when embedded if needed

### Phase 2

Polish changes are moderate:

- improve responsive layout
- add shell-aware breadcrumbs/title behavior
- optionally align API calls or proxying with `42trade`

### Important boundary

`db-manager` should remain runnable standalone. Embedded mode is an enhancement, not a replacement.

---

## API Model

For `db-manager` phase 1, keep backend ownership local to the miniapp.

### Phase 1 recommendation

- `db-manager` frontend talks to `db-manager` backend
- `42trade` shell provides context and framing only

### Why

- fastest adoption path
- least intrusive
- no need to refactor existing DB-manager server immediately

### Phase 2 option

Move toward same-origin hosting or host-mediated proxying if needed for:

- auth hardening
- production deployment simplicity
- API governance
- tighter audit/control requirements

---

## Miniapp Candidate Rules For Future Extractions

Good future miniapps are tool-shaped surfaces with clear boundaries:

- DB manager
- logs explorer
- storage browser
- backtest lab
- strategy builder
- admin consoles

Poor early miniapp candidates are deeply stateful shell pages:

- dashboard
- auth/login
- highly coupled trade workflows

This design intentionally optimizes for extracting **operator tools first**.

---

## Phased Rollout

### Phase 1: Platform seed + db-manager embed

- Add a miniapp registry in `42trade`
- Add `/miniapps/:id` route and container page
- Add shell-to-miniapp bridge handshake
- Register `db-manager`
- Redirect `/system/db` to `/miniapps/db-manager`
- Keep `db-manager` backend standalone

### Phase 2: Mobile and embedded UX polish

- Make `db-manager` embedded mode cleaner
- Improve table responsiveness and narrow-screen behavior
- Add full-page mobile miniapp mode
- Add “open standalone” action

### Phase 3: Platform hardening

- Same-origin reverse proxy support
- role-aware visibility and enable/disable controls
- standardized host notifications and error presentation
- optional host-mediated API access

---

## Testing Strategy

### Shell tests

- route access based on role
- manifest loading
- iframe container rendering
- loading/error/offline states
- mobile full-page miniapp behavior

### Bridge tests

- handshake success
- title updates
- theme propagation
- resize messages

### db-manager tests

- standalone boot still works
- embedded boot still works
- shell context is consumed correctly
- core DB workflows still function when embedded

---

## Recommendation

Proceed with an **iframe-based miniapp platform** and onboard `db-manager` first.

This gives `42trade`:

- the lowest-risk path to microfrontend-style extensibility
- minimal disruption to current routes and pages
- an easy migration path for future operator-focused tools
- a mobile-capable architecture without forcing an immediate full rewrite

For `db-manager`, this approach requires only modest integration changes up front and preserves the option to harden the platform later.

---

## Open Decisions Resolved In This Spec

- **Miniapp runtime model:** standalone app embedded in shell
- **Initial render mode:** iframe
- **Initial backend model:** miniapp-owned backend
- **Route strategy:** new `/miniapps/*` routes with `/system/db` redirect
- **Mobile strategy:** shell full-page mode on small screens
- **Future extraction strategy:** operator/admin tools first
