# DB Manager Miniapp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a miniapp platform to `42trade` and onboard `db-manager` as the first embedded miniapp, rendered inside the shell via iframe and bridge messaging without breaking existing pages or routes.

**Architecture:** `42trade` remains the shell and owns auth, navigation, routing, and miniapp lifecycle. `db-manager` remains a standalone app, but gains an embedded mode plus a `postMessage` bridge handshake so the shell can provide context and frame it inside a `/miniapps/db-manager` route. Existing `/system/db` becomes a redirect into the miniapp route.

**Tech Stack:** React Router in `src/admin`, existing `src/api` auth/runtime APIs, standalone Node app in `src/apps/db-manager`, iframe embedding, `window.postMessage`, Vite frontend build, existing shell/mobile layout.

---

## File Map

**Create**
- `src/admin/src/miniapps/miniappRegistry.js` — static registry for enabled miniapps and route metadata.
- `src/admin/src/miniapps/MiniAppContainer.jsx` — shell page that renders the iframe, loading states, bridge wiring, and mobile mode.
- `src/admin/src/miniapps/miniappBridge.js` — host-side bridge helpers for iframe messaging.
- `src/admin/src/miniapps/useMiniAppFrame.js` — React hook for handshake, theme sync, title sync, and viewport sync.
- `src/admin/src/pages/system/MiniAppsPage.jsx` — optional miniapp directory/launcher page for future expansion.
- `src/apps/db-manager/public/embed-bridge.js` — miniapp-side bridge bootstrap loaded by `db-manager`.
- `tests/miniappRegistry.test.mjs` — registry and route metadata tests.
- `tests/miniappBridge.test.mjs` — bridge message validation tests.
- `tests/miniappContainer.test.mjs` — shell rendering and route behavior tests.

**Modify**
- `src/admin/src/App.jsx` — add `/miniapps/*` routes, nav entry, and `/system/db` redirect behavior.
- `src/admin/src/api.js` — expose current auth/runtime context helpers used by the host container.
- `src/admin/src/components/SiteNavigation.jsx` or `src/admin/src/App.jsx` nav blocks — add miniapp entry point.
- `src/apps/db-manager/server.js` — serve bridge bootstrap, detect embedded mode, and accept host context.
- `src/apps/db-manager/README.md` — document standalone vs embedded mode.
- `src/admin/src/styles.css` — add container/mobile/fullpage miniapp styles.
- `tests/test_remote_ui.sh` — add smoke step once the route is stable.

## Delivery Strategy

1. Add the host registry and container route first.
2. Add the shell bridge contract second.
3. Make `db-manager` embedded-aware without breaking standalone mode.
4. Redirect `/system/db` to the miniapp route only after the container is working.
5. Add mobile/full-page behavior after the desktop happy path is stable.

### Task 1: Define The Miniapp Registry Contract

**Files:**
- Create: `src/admin/src/miniapps/miniappRegistry.js`
- Test: `tests/miniappRegistry.test.mjs`

- [ ] **Step 1: Write the failing registry test**

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  listMiniApps,
  getMiniAppById,
  getMiniAppByRoute,
} from "../src/admin/src/miniapps/miniappRegistry.js";

test("db-manager is registered as the first enabled miniapp", () => {
  const app = getMiniAppById("db-manager");
  assert.equal(app.id, "db-manager");
  assert.equal(app.route, "/miniapps/db-manager");
  assert.equal(app.displayMode, "iframe");
  assert.equal(app.requiredRole, "system");
});

test("registry can resolve miniapp from route", () => {
  const app = getMiniAppByRoute("/miniapps/db-manager");
  assert.equal(app.id, "db-manager");
});

test("listMiniApps returns only enabled miniapps by default", () => {
  const rows = listMiniApps();
  assert.equal(rows.some((row) => row.id === "db-manager"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/miniappRegistry.test.mjs`
Expected: FAIL with module not found.

- [ ] **Step 3: Write the minimal registry implementation**

```js
const MINIAPPS = [
  {
    id: "db-manager",
    name: "DB Manager",
    version: "1.0.0",
    route: "/miniapps/db-manager",
    entryUrl: "http://127.0.0.1:8088",
    displayMode: "iframe",
    requiredRole: "system",
    mobileMode: "fullpage",
    capabilities: ["theme", "authContext", "title", "resize", "openExternal"],
    permissions: ["db-manager:self"],
    status: "enabled",
  },
];

function listMiniApps({ includeDisabled = false } = {}) {
  return MINIAPPS.filter((app) => includeDisabled || app.status === "enabled").map((app) => ({ ...app }));
}

function getMiniAppById(id) {
  return listMiniApps({ includeDisabled: true }).find((app) => app.id === String(id || "").trim()) || null;
}

function getMiniAppByRoute(route) {
  return listMiniApps({ includeDisabled: true }).find((app) => app.route === String(route || "").trim()) || null;
}

module.exports = {
  listMiniApps,
  getMiniAppById,
  getMiniAppByRoute,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/miniappRegistry.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/src/miniapps/miniappRegistry.js tests/miniappRegistry.test.mjs
git commit -m "feat: add miniapp registry for shell-managed tools"
```

### Task 2: Build The Shell Miniapp Container

**Files:**
- Create: `src/admin/src/miniapps/MiniAppContainer.jsx`
- Create: `src/admin/src/pages/system/MiniAppsPage.jsx`
- Modify: `src/admin/src/App.jsx`
- Modify: `src/admin/src/styles.css`
- Test: `tests/miniappContainer.test.mjs`

- [ ] **Step 1: Write the failing container test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import MiniAppContainer from "../src/admin/src/miniapps/MiniAppContainer.jsx";

test("container renders iframe for db-manager route", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/miniapps/db-manager"]}>
      <Routes>
        <Route path="/miniapps/:miniappId" element={<MiniAppContainer authUser={{ role: "system" }} />} />
      </Routes>
    </MemoryRouter>,
  );
  assert.match(html, /iframe/);
  assert.match(html, /db-manager/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/miniappContainer.test.mjs`
Expected: FAIL with module or component not found.

- [ ] **Step 3: Add the shell route and redirect behavior**

`src/admin/src/App.jsx` route additions:

```jsx
<Route
  path="/miniapps"
  element={
    canAccessSystemPages ? (
      <MiniAppsPage />
    ) : (
      <Navigate to="/dashboard" replace />
    )
  }
/>
<Route
  path="/miniapps/:miniappId"
  element={
    canAccessSystemPages ? (
      <MiniAppContainer authUser={authUser} />
    ) : (
      <Navigate to="/dashboard" replace />
    )
  }
/>
<Route
  path="/system/db"
  element={<Navigate to="/miniapps/db-manager" replace />}
/>
<Route
  path="/db"
  element={<Navigate to="/miniapps/db-manager" replace />}
/>
```

- [ ] **Step 4: Implement the minimal container**

```jsx
import { useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";
import { getMiniAppById } from "./miniappRegistry";

export default function MiniAppContainer({ authUser }) {
  const { miniappId } = useParams();
  const app = useMemo(() => getMiniAppById(miniappId), [miniappId]);

  if (!app) return <Navigate to="/dashboard" replace />;
  if (String(authUser?.role || "").toLowerCase() !== String(app.requiredRole || "").toLowerCase()) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <section className="miniapp-page">
      <header className="miniapp-page__header">
        <h1>{app.name}</h1>
        <a href={app.entryUrl} target="_blank" rel="noreferrer">Open standalone</a>
      </header>
      <div className="miniapp-frame-shell">
        <iframe
          title={app.name}
          src={`${app.entryUrl}?embedded=1`}
          className="miniapp-frame"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/miniappContainer.test.mjs tests/miniappRegistry.test.mjs`
Expected: PASS.

Commit:

```bash
git add src/admin/src/miniapps/MiniAppContainer.jsx src/admin/src/pages/system/MiniAppsPage.jsx src/admin/src/App.jsx src/admin/src/styles.css tests/miniappContainer.test.mjs
git commit -m "feat: add shell miniapp routes and container"
```

### Task 3: Add The Host Bridge In 42trade

**Files:**
- Create: `src/admin/src/miniapps/miniappBridge.js`
- Create: `src/admin/src/miniapps/useMiniAppFrame.js`
- Modify: `src/admin/src/miniapps/MiniAppContainer.jsx`
- Modify: `src/admin/src/api.js`
- Test: `tests/miniappBridge.test.mjs`

- [ ] **Step 1: Write the failing bridge validation test**

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  isMiniAppMessage,
  buildHandshakePayload,
} from "../src/admin/src/miniapps/miniappBridge.js";

test("isMiniAppMessage accepts namespaced bridge messages", () => {
  assert.equal(
    isMiniAppMessage({ data: { type: "miniapp:ready", miniappId: "db-manager" } }),
    true,
  );
});

test("buildHandshakePayload includes shell context", () => {
  const payload = buildHandshakePayload({
    app: { id: "db-manager" },
    authUser: { id: "u1", role: "system" },
    theme: "dark",
    mobile: true,
  });
  assert.equal(payload.type, "miniapp:handshake");
  assert.equal(payload.context.authUser.role, "system");
  assert.equal(payload.context.theme, "dark");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/miniappBridge.test.mjs`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement bridge helpers**

```js
function isMiniAppMessage(event) {
  const type = String(event?.data?.type || "");
  return type.startsWith("miniapp:");
}

function buildHandshakePayload({ app, authUser, theme, mobile }) {
  return {
    type: "miniapp:handshake",
    miniappId: app.id,
    context: {
      authUser: authUser
        ? { id: authUser.id || null, role: authUser.role || null }
        : null,
      theme: String(theme || "dark"),
      mobile: Boolean(mobile),
      embedded: true,
    },
  };
}

module.exports = {
  isMiniAppMessage,
  buildHandshakePayload,
};
```

- [ ] **Step 4: Wire the bridge into the container**

```jsx
useEffect(() => {
  if (!frameRef.current?.contentWindow || !app) return;
  frameRef.current.contentWindow.postMessage(
    buildHandshakePayload({
      app,
      authUser,
      theme: document.documentElement.getAttribute("data-theme") || "dark",
      mobile: window.matchMedia("(max-width: 768px)").matches,
    }),
    "*",
  );
}, [app, authUser]);
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/miniappBridge.test.mjs tests/miniappContainer.test.mjs`
Expected: PASS.

Commit:

```bash
git add src/admin/src/miniapps/miniappBridge.js src/admin/src/miniapps/useMiniAppFrame.js src/admin/src/miniapps/MiniAppContainer.jsx src/admin/src/api.js tests/miniappBridge.test.mjs
git commit -m "feat: add host bridge for embedded miniapps"
```

### Task 4: Make db-manager Embedded-Aware

**Files:**
- Create: `src/apps/db-manager/public/embed-bridge.js`
- Modify: `src/apps/db-manager/server.js`
- Modify: `src/apps/db-manager/README.md`
- Test: `tests/miniappBridge.test.mjs`

- [ ] **Step 1: Write the failing embedded boot test**

```js
test("db-manager embedded bootstrap applies shell context", async () => {
  const state = createEmbeddedShellState();
  state.applyHandshake({
    type: "miniapp:handshake",
    context: {
      authUser: { id: "u1", role: "system" },
      theme: "dark",
      mobile: true,
      embedded: true,
    },
  });
  assert.equal(state.embedded, true);
  assert.equal(state.theme, "dark");
  assert.equal(state.authUser.role, "system");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/miniappBridge.test.mjs`
Expected: FAIL with missing embedded bootstrap export.

- [ ] **Step 3: Add the miniapp-side bootstrap**

```js
function createEmbeddedShellState() {
  return {
    embedded: false,
    theme: "dark",
    authUser: null,
    mobile: false,
    applyHandshake(message = {}) {
      const context = message.context || {};
      this.embedded = Boolean(context.embedded);
      this.theme = String(context.theme || "dark");
      this.authUser = context.authUser || null;
      this.mobile = Boolean(context.mobile);
    },
  };
}

window.addEventListener("message", (event) => {
  if (event?.data?.type !== "miniapp:handshake") return;
  window.__DB_MANAGER_SHELL__ = window.__DB_MANAGER_SHELL__ || createEmbeddedShellState();
  window.__DB_MANAGER_SHELL__.applyHandshake(event.data);
  document.documentElement.setAttribute("data-host-theme", window.__DB_MANAGER_SHELL__.theme);
});
```

- [ ] **Step 4: Serve the bootstrap and embed-specific HTML hooks**

Add to `server.js`:

```js
if (req.method === "GET" && url.pathname === "/embed-bridge.js") {
  res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
  res.end(fs.readFileSync(path.join(APP_DIR, "public", "embed-bridge.js"), "utf8"));
  return;
}
```

And inject:

```html
<script src="/embed-bridge.js"></script>
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/miniappBridge.test.mjs`
Expected: PASS.

Commit:

```bash
git add src/apps/db-manager/public/embed-bridge.js src/apps/db-manager/server.js src/apps/db-manager/README.md tests/miniappBridge.test.mjs
git commit -m "feat: add embedded mode support to db-manager"
```

### Task 5: Add Mobile-Friendly Miniapp Presentation

**Files:**
- Modify: `src/admin/src/miniapps/MiniAppContainer.jsx`
- Modify: `src/admin/src/styles.css`
- Test: `tests/miniappContainer.test.mjs`

- [ ] **Step 1: Write the failing mobile container test**

```js
test("container uses fullpage class when miniapp mobile mode is fullpage", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/miniapps/db-manager"]}>
      <Routes>
        <Route path="/miniapps/:miniappId" element={<MiniAppContainer authUser={{ role: "system" }} forceMobile={true} />} />
      </Routes>
    </MemoryRouter>,
  );
  assert.match(html, /miniapp-page--mobile-full/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/miniappContainer.test.mjs`
Expected: FAIL with class not found.

- [ ] **Step 3: Implement mobile full-page mode**

```jsx
const isMobile = forceMobile ?? window.matchMedia("(max-width: 768px)").matches;
const pageClassName = [
  "miniapp-page",
  isMobile && app.mobileMode === "fullpage" ? "miniapp-page--mobile-full" : "",
].filter(Boolean).join(" ");
```

CSS snippet:

```css
.miniapp-page--mobile-full .miniapp-frame-shell {
  min-height: calc(100vh - 96px);
  border-radius: 0;
}

.miniapp-frame {
  width: 100%;
  min-height: 70vh;
  border: 0;
}
```

- [ ] **Step 4: Run tests to verify it passes**

Run: `node --test tests/miniappContainer.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/src/miniapps/MiniAppContainer.jsx src/admin/src/styles.css tests/miniappContainer.test.mjs
git commit -m "feat: add mobile-friendly miniapp presentation"
```

### Task 6: Add Shell Navigation And Smoke Coverage

**Files:**
- Modify: `src/admin/src/App.jsx`
- Modify: `tests/test_remote_ui.sh`
- Modify: `src/apps/db-manager/README.md`

- [ ] **Step 1: Write the failing navigation smoke expectation**

```bash
curl -fsS http://127.0.0.1:3000/miniapps/db-manager >/dev/null
```

Add Playwright or shell smoke expectation that the route loads and the iframe exists.

- [ ] **Step 2: Run smoke test to verify it fails or is incomplete**

Run: `bash tests/test_remote_ui.sh`
Expected: FAIL or missing miniapp coverage.

- [ ] **Step 3: Add nav entry and launcher discoverability**

Recommended nav addition in the System dropdown:

```jsx
<Link to="/miniapps/db-manager" onClick={closeMobileNav}>
  DB Manager
</Link>
```

- [ ] **Step 4: Extend smoke coverage**

Add a route-open check for `/miniapps/db-manager` and verify the page contains:

- heading `DB Manager`
- an `iframe`
- optional “Open standalone” action

- [ ] **Step 5: Commit**

```bash
git add src/admin/src/App.jsx tests/test_remote_ui.sh src/apps/db-manager/README.md
git commit -m "feat: expose db-manager miniapp in shell navigation"
```

## Acceptance Criteria

- `42trade` exposes `/miniapps/db-manager`.
- `/system/db` and `/db` redirect to the miniapp route.
- Access remains gated by the existing system-role check.
- `db-manager` still runs standalone on `http://127.0.0.1:8088`.
- When embedded, `db-manager` receives shell context through `postMessage`.
- The miniapp route is mobile-friendly via shell-managed full-page mode.
- Current `42trade` routes outside the DB entry point remain unaffected.

## Recommended Execution Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6

Reason: registry and container must exist before bridge work, and the shell route should be stable before redirecting current DB entry points.

## Risks To Watch

- `db-manager` currently serves its own HTML directly from Node, so embed bootstrap injection should be done surgically to avoid breaking standalone behavior.
- Cross-origin iframe behavior may limit future deep integration if production hosting differs by origin; keep the bridge narrow and origin-aware.
- Existing `/system/db` redirects currently go to dashboard, so any shell assumptions around inactive DB pages should be rechecked after route activation.
- Mobile friendliness depends more on `db-manager` table layouts than on the shell route alone.

## Self-Review

- Spec coverage: route strategy, iframe model, bridge, mobile mode, and db-manager-first rollout are all covered.
- Placeholder scan: no `TODO` or `TBD` markers remain.
- Type consistency: `db-manager` uses the same route, ID, and display mode across registry, container, and bridge tasks.

## Recommended First Slice

If you want the smallest useful milestone, execute **Task 1 + Task 2 + Task 4** first. That gets `db-manager` embedded in `42trade` fast, before adding richer bridge behavior and mobile polish.

Plan complete and saved to `docs/superpowers/plans/2026-06-15-db-manager-miniapp-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
