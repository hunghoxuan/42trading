# 42Trade POS Module Specification

| Field | Value |
|---|---|
| Status | Proposed, not implemented |
| Date | 2026-10-16 |
| Owner | 42Trade monorepo |

## 1. Purpose and decisions

Build an installable point-of-sale (POS) PWA inside the existing 42Trade repository. POS is a separate frontend package and API domain module, not a nested Git repository and not a migration of the whole admin app. It reuses the configured 42Trade database, the four universal-store tables, the current user and permission system, the 42Pay product business object, and the established UI design language.

The first release serves **one store** and must complete **cash sales while offline**. Its product catalog, price book, available stock allocation, cart, checkout, and receipts remain usable without a server response after the register has been provisioned online. Card, QR payment, and 42Pay wallet tender require online confirmation. The object model retains store identifiers so another store can be added later; multi-merchant isolation is a later design and migration task.

Success means a cashier can identify a product by code or image, verify its current store price, add it to a cart, complete a safe sale, issue a receipt, and see inventory and reports update. A manager can maintain the catalog and stock, import/export data, and review activity by store and cashier.

## 2. Boundaries and architecture

~~~text
Installed POS PWA / browser at /pos/
  React + TypeScript + Vite + vite-plugin-pwa
  camera or scanner input, local catalog, cart, offline cash sales
  IndexedDB snapshot + pending-sale outbox
                  |
        foreground sync / HTTPS /api/pos/*
                  |
  POS domain service in the existing Node API
  auth + device grants; catalog; stock allocations; checkout; reports
                  |
  existing configured 42Trade DB and universal-store tables
  object_entities | object_links | object_journal | object_processes
                  |
  optional 42Pay wallet adapter and pluggable payment/vision providers
~~~

- Keep one Git repository. Add src/pos as a pnpm workspace package and src/api/modules/pos as a domain module. Use the existing API process and deployment. POS should not start its own database or API server.
- Deploy the POS frontend at /pos/ on the same HTTPS origin as /api/pos/*. Configure SPA route fallback only for /pos/* and keep the existing admin routes intact.
- Set the PWA manifest start URL and scope to /pos/. Place the service worker under /pos/ and scope it to /pos/, so it does not control the existing admin app.
- Use vite-plugin-pwa for manifest, asset precache, and update registration. Cache versioned UI assets. Store the downloaded catalog, prices, device stock allocations, and sale outbox explicitly in IndexedDB, with schema versions and transactional updates. Do not treat cached API responses as the offline system of record. Reports and image recognition use the network; barcode/product-number lookup uses the local catalog offline.
- Before offline selling, pair a device with its register, download a complete approved snapshot and stock allocation, verify that IndexedDB writes work, and obtain an offline authorization grant scoped to the store/register/cashier with a defined expiry. An expired grant blocks new offline sales until online reauthorization. Never keep payment-card data locally.
- Request persistent browser storage and monitor usage/quota. If persistence is denied, storage is near full, or a write preflight fails, show a clear warning and block new offline checkouts until the device can safely store a sale. Browser-managed storage may still be cleared or lost; document device recovery and reconcile every synced sale with the server. Acceptance testing must cover storage eviction and device loss.
- Sync queued sales in the foreground on app launch and reconnection. Background Sync is only an optional accelerator because browsers may delay or omit it. Keep a visible count of pending and failed operations.
- Show an update prompt when a new app version is ready; do not replace an active cart or scan session without the cashier choosing to reload. IndexedDB migrations must preserve and verify unsynced sales before the new version can sell.
- Treat the client as untrusted. Online, the API resolves identity, role, store, price, tax, discounts, stock, and payment state. For an offline cash sale, it verifies the signed grant, approved snapshot/version, reserved stock allocation, sale sequence, tender, and calculation when syncing. The server honors the approved price snapshot for a valid offline sale rather than silently repricing cash already collected.
- POS checkout uses a new transaction-aware POS repository. The existing 42Pay QR order method is not the POS checkout engine.

### Repository placement

~~~text
src/pos/                         React PWA, routes, scanner, cart, IndexedDB, sync, UI, tests
src/api/modules/pos/             HTTP handlers, services, repositories, tests
src/api/modules/42pay/           existing product and optional wallet logic
src/api/shared/universal-store/  existing facade/adapters, extended for atomic POS writes
src/config/schema/pos/           JSON contracts for POS objects and import rows
src/db/                          existing provider, schema, and configured DB file
docs/pos/                        this specification and later workflow notes
~~~

## 3. Reuse of current database and business objects

### Physical storage

- Use the existing MT5_STORAGE selection. SQLite writes to the same configured MT5_SQLITE_PATH file used by the API; PostgreSQL uses the configured database and shared pool where practical. Do not create a separate POS DB file or a second migration stack for the first release.
- Reuse object_entities for current state, object_links for relationships, object_journal for append-only business events, and object_processes for imports, recognition, exports, and retries. The existing unique key on (tenant_id, entity_type, entity_key, lang) remains the identity constraint.
- Reuse existing users and sessions. Add POS permissions to the current permission system rather than a second login database.
- Keep the 42Pay product object as the canonical catalog identity. Extend its validated metadata with POS fields: SKU/product number, barcodes, unit, category, tax class, image references, and active/archive status. Existing 42Pay offers remain marketplace offers; POS store prices and stock are separate objects.
- Existing 42Pay products are currently stored under the fixed __42pay__ tenant scope. Reuse that catalog in the one-store release, while recording one explicit store SID on POS objects and enforcing store access in the API. Before adding another merchant, migrate product access to tenant-aware keys with a compatibility path for legacy rows; the fixed scope must never expose one merchant's data to another.
- Change the existing 42Pay demo seeding so startup cannot overwrite a merchant-edited product or offer. Seed records must be opt-in for demo environments and never become the source of truth for POS prices or stock.
- Reuse 42Pay wallet accounts only as an optional tender after its top-up and transfer paths have confirmed funding, atomic writes, and idempotency. Cash and external card payments must use their own confirmed payment states.
- Do not use the current 42pay_product_orders shape for POS sales: it represents one offer and one buyer, while a POS sale contains multiple lines, quantities, discounts, and potentially several payments.

### Logical objects in the existing four tables

| Entity type in object_entities | Purpose and required keys |
|---|---|
| 42pay_products | Canonical product identity; tenant, SID, SKU/product number, barcode aliases, name, category, unit, tax class, images, status. |
| pos_store | The launch store identity, address, currency, timezone, tax and receipt settings. |
| pos_register | Till/terminal identity, store, paired devices and status. |
| pos_device | Paired device identity, register, sync cursor, grant policy and status; no raw offline PIN. |
| pos_price | Product + store + price-list scope; currency, unit price in minor units, effective dates. |
| pos_stock | Product + store on-hand and allocated/reserved quantities, version, and optional reorder threshold. |
| pos_stock_allocation | Product + store + device/register quantity reserved for offline sales, issued/consumed counts, version and reconciliation state. |
| pos_sale | Sale SID, store/register/device/cashier, state, totals in minor units, currency, timestamps, receipt number, checkout request ID and offline origin. |
| pos_sale_line | Sale and product SID, quantity, price/tax/discount snapshots, line total, refund quantity. |
| pos_payment | Sale, tender type, requested/confirmed/refunded amount, provider reference and state. Never store card numbers. |
| pos_shift | Register/cashier opening and closing times, opening cash, cash movements, expected and counted cash. |
| pos_import_run | Source file, mapping, dry-run preview, counts, errors, actor and outcome. |
| pos_product_media | Product image reference, recognition metadata and provenance. |

Use object_links to connect store/register/device, product/price/stock/media/allocation, sale/lines/payments, and shift/sales. Use object_journal for stock movements, allocation movements, price changes, sale transitions, payment events, returns/refunds, cash movements, and important edits. Use object_processes for long-running import, image analysis, report export, and reconciliation jobs. A deleted product is archived, not removed from historical sale snapshots.

Amounts in POS business payloads and calculations are **integer minor units** for the store currency. The current SQLite universal-store monetary columns are REAL, so they are optional search/display projections, never the authoritative amount or an input to settlement. The authoritative value lives in validated object data and journal data as an integer minor-unit field. A later physical-money migration can be considered separately.

### Atomic write requirement

Before enabling checkout, extend the universal-store adapter or a POS-specific repository with a unit-of-work transaction for both SQLite and PostgreSQL. For **online cash**, one database commit claims a unique checkout request ID, validates current price and stock, creates sale/line/payment objects, reduces stock, appends journals, and marks the sale PAID. For **offline cash**, the device first commits the paid sale to IndexedDB as described below; the server later commits that same sale and consumes its preallocated stock in one database transaction. PostgreSQL should use one checked-out connection and row locks; SQLite should use one write transaction. On database failure, roll back all server writes and leave the local sale queued.

For external payment, do not hold a database transaction open during the provider call. First atomically create a PAYMENT_PENDING sale and reserve stock. Call the provider using an idempotent payment request. On verified provider confirmation, atomically record the payment, reduce stock, release the reservation, and mark the sale PAID. On failure or expiry, release the reservation and record the failed state. Reconcile unknown provider outcomes before retrying or releasing stock.

The client sends a generated idempotency key for each checkout attempt. A retry with the same key returns the original result; it cannot create a second sale or payment. Server allocation of the last item must succeed for only one device; each device's offline sales cannot exceed its allocation. Reconciliation detects incomplete external payment states and never silently marks them paid.

Stock invariant: available for online sales or new device allocations equals on-hand minus active allocations and other reservations. An offline sync reduces on-hand and the matching allocation by the same quantity in one transaction, so availability does not change again at sync. A disputed or missing device allocation stays reserved until manager reconciliation, even if its grant expires.

### Offline sale and sync contract

1. While online, provision one device/register and issue an approved product and price snapshot, tax rules, a bounded offline authorization grant, and per-product stock allocations. The snapshot has a version and expiry; stale or incomplete snapshots block new offline sales. Stock that is not tracked may be sold offline only when explicitly configured. Do not automatically expire an allocation while its device may be offline; release it through an acknowledged sync or manager reconciliation.
2. Resolve scanned codes and calculate cash totals locally from the approved snapshot. At checkout, one IndexedDB transaction writes the immutable sale and lines, cash tender, device-scoped monotonic sequence, receipt ID, stock-allocation consumption, and outbox operation. The cashier sees success only after that transaction commits. Receipt IDs include store/register/device/sequence so they are unique without a server round trip; print the offline and pending-sync state on the receipt.
3. On reconnection or app restart, upload outbox operations in sequence with their stable idempotency keys. The server validates the grant and snapshot policy, rechecks allocation ownership and consumption, and atomically creates the sale, cash payment and stock movement. A duplicate request returns the original acknowledgment. Remove an outbox item only after durable server acknowledgment; a timeout or unknown response triggers the same-key retry.
4. Expose PENDING_SYNC, SYNCED, and NEEDS_ATTENTION in the register UI. A rejected sale remains locally readable and is escalated for manager reconciliation; cash already collected is never silently discarded, duplicated, or repriced. Reconciliation can record a compensating adjustment/refund with an audit trail. Server reports distinguish synced totals from pending local totals.
5. Closing a shift with pending sales records the pending count and estimated cash, and requires a later reconciliation before final close. Provide a manager-visible device recovery process; local data loss before sync cannot be reconstructed from the server and is an explicit operational risk.

## 4. UI and PWA design

- Reuse the dark/light design tokens and compact visual language from src/admin/app/styles/base.css, docs/design.md, and agents/rules/ui-rules.md. POS can give the sale/cart area more room, but uses the same typography, status colors, spacing, form controls, and responsive conventions.
- Reuse or extract the existing PageHeader, ResponsivePanel, DataTable, CrudContainer, SearchFilterBar, KpiCard, ConfirmDialog, and toast patterns into one shared UI source. Avoid copying components into src/pos. Keep admin imports working while moving shared code.
- Tablet/desktop: product/search pane, persistent cart pane, clear total and checkout action. Phone: single-column product list with a fixed cart summary/action, full-width controls, and camera scanner entry. Scanner input must remain focused when using a USB/Bluetooth keyboard-wedge scanner.
- Give every destructive action a clear confirmation and permission check. Show who last changed product, stock, price, and sale state. Indicate offline, pending sync, sync failure, snapshot expiry, insufficient allocation, and pending payment in text as well as color.
- Support keyboard and touch workflows, readable scan feedback, camera-permission fallback, and receipt print/share through browser-supported actions.

## 5. Functional requirements

### 5.1 Catalog and inventory

1. Create, view, edit, search, and archive products; manage SKU/product number, multiple barcode aliases, name, description, category, unit, tax class, cost, images, supplier reference, and active state. SKU/barcode collisions within the store catalog require resolution before save.
2. Maintain retail prices for the launch store, effective dates, and an audit trail. The product detail screen shows the current price source and effective time. Only authorized staff can change price. Publish a versioned offline price snapshot; honor its approved validity window for offline cash sales.
3. Track on-hand stock through receiving, adjustment, sale, and return movements. Require a reason and actor for manual adjustments. Show low-stock and out-of-stock status. Reserve bounded quantity to each offline device; prevent negative unallocated stock and prevent a device from selling more than its allocation.
4. Support stock counts with draft, review, and posted states. A posted count creates adjustment movements; historical movements are append-only.
5. Keep product images in the existing object/media storage pattern and store only references in the universal-store row. Image deletion must not break historical sales.

Catalog edits, receiving, counts, adjustments, and price changes require connectivity in the first release. Offline catalog access is read-only except for sales and their local stock-allocation consumption.

### 5.2 Code scanning and product number

1. Accept camera scanning, uploaded images, manually typed codes, and keyboard-wedge scanners. Support QR plus common retail barcode formats selected from the actual product mix.
2. Normalize and validate the scanned code, search barcode aliases first, then SKU/product number. Use the downloaded catalog while offline. If exactly one product matches, open its detail or add it to the cart based on the screen's current action.
3. If no product matches, show a create-product draft with the scanned code prefilled. If several match, require selection and flag the duplicate data for a manager.
4. Product detail supports view, edit, archive, and authorized stock/price actions. “Delete” in the UI means archive when the product has been used in sales.
5. Reuse the existing 42Pay camera and QR patterns where practical, but keep a decoder fallback because the browser BarcodeDetector API is not universal. A camera requires HTTPS or localhost.

### 5.3 Image recognition and retail price lookup

1. The cashier can take/upload a product photo. The server first looks for a visible QR/barcode and OCR text, then uses a pluggable visual matcher against the store catalog images and metadata.
2. Return ranked product candidates with SID, name, image, match explanation, and confidence. A cashier confirms the candidate; the system never creates an order or changes a product solely from an AI guess.
3. After confirmation, fetch the **current retail price from pos_price for the store**. Do not infer a price from the image, a model response, or packaging text. During offline checkout, use only the approved local price snapshot and display its effective time.
4. If the product is unknown, offer a draft product with extracted suggestions. A manager must approve identifiers and price before the product is saleable.
5. Handle no camera, permission denial, blurry/multiple products, unknown packaging, and duplicate-looking variants. The recognition provider is server-side so credentials and model choice remain outside the PWA. Image recognition requires connectivity in the first release; barcode, product-number search, and the local catalog remain available offline.

### 5.4 Sales, payment, receipts, and returns

1. Cart supports multiple products, quantities, unit price snapshots, line discounts, tax calculation, and optional customer association. The API recalculates online totals. Offline checkout uses the approved local snapshot and the server validates it at sync.
2. Online sale lifecycle: DRAFT → READY → PAYMENT_PENDING → PAID, with VOIDED/FAILED/REFUNDED/PARTIALLY_REFUNDED transitions and timestamped journal entries. An offline cash sale is locally PAID_PENDING_SYNC after cash is collected and its local transaction commits; it becomes server PAID after sync acknowledgment. The UI always distinguishes those states.
3. Initial offline tender is cash, including cash received and change. An external card/payment provider may be enabled for connected sales only. 42Pay wallet can be enabled only after the hardening in section 3, and only while connected. The sale model allows later split tender, but do not accept an offline split with a tender needing online confirmation.
4. Generate a stable device-scoped receipt ID and printable/shareable receipt with store, cashier, item snapshots, taxes, discounts, tender summary, sync state, and return reference. Reprints are logged locally and synced.
5. Returns reference an original sale line, enforce refundable quantity/amount limits, create a refund payment event, and optionally restock according to item condition. Voids and refunds require reason and role permission.
6. A register shift records opening float, cash sales, payouts, expected cash, counted cash, variance, pending offline sales, and manager review. A final close requires pending cash sales to sync or explicit manager reconciliation.

### 5.5 Import, export, dashboard, and reports

1. Import products, barcode aliases, store prices, and opening stock from CSV first. Accept XLSX only after a tested parser is chosen. Show column mapping, dry-run preview, duplicate policy, row errors, and final counts before commit.
2. Imports are idempotent by store + source file/import key. Large imports run through object_processes, expose progress, and produce a downloadable error file. No partial inventory adjustments without an explicit result report.
3. Export filtered products, stock, movements, sales, refunds, shifts, and report summaries to CSV; include store, timezone, currency, filter values, and generation time. Limit exports by permission and protect spreadsheet output from formula injection.
4. Dashboard: today's synced gross/net sales, order count, average basket, refunds, tender mix, low-stock products, current shifts, and recent sync exceptions. On each device, show its pending local sales separately from server totals; the server cannot see another disconnected device's pending sales.
5. Reports: sales by day/cashier/product/category; tax and discount totals; payment reconciliation; inventory valuation/movements; low stock; shrinkage from counts; returns. Keep store as a filter field for future expansion. Define whether cost/margin data is available before showing profit.
6. Use server-side filtering/pagination and report jobs. The current 42Pay list method reads up to 10,000 objects and filters in memory; POS reports must not inherit that limit.

### 5.6 Roles and audit

- Owner: merchant setup and all POS permissions.
- Manager: prices, inventory posting, void/refund approval, imports, reports, shift review.
- Cashier: scan, cart, checkout, receipts, own shift.
- Stock clerk: product and stock operations without payment access.
- Auditor: read-only reports and journal.

Map these to existing user roles/permissions with names such as apis.pos.sales.write, apis.pos.inventory.write, and pages.pos.reports. The API checks store membership on every read and write. Offline grants are signed, time-bounded, and scoped to paired device/register/cashier; the PWA validates the grant before local checkout and the server validates it again during sync. Audit records include actor, timestamp, source device/register, before/after values where relevant, and a reason for sensitive changes.

## 6. API surface

The POS frontend calls domain endpoints, not unrestricted universal-store write endpoints:

| Area | Example endpoints |
|---|---|
| Catalog | GET/POST /api/pos/products; GET/PATCH /api/pos/products/:sid; POST /api/pos/products/:sid/archive |
| Search/scan | POST /api/pos/scan/resolve; POST /api/pos/images/recognize |
| Price/stock | GET/PUT /api/pos/prices; GET /api/pos/stock; POST /api/pos/stock/movements; POST /api/pos/stock/counts |
| Sales | POST /api/pos/sales/quote; POST /api/pos/sales/checkout; GET /api/pos/sales/:sid; POST /api/pos/sales/:sid/void; POST /api/pos/sales/:sid/returns |
| Offline | POST /api/pos/devices/pair; GET /api/pos/offline/bootstrap; POST /api/pos/offline/sales/sync; GET /api/pos/offline/sync-status; POST /api/pos/offline/allocations/reconcile |
| Shifts | POST /api/pos/shifts/open; POST /api/pos/shifts/:sid/close; GET /api/pos/shifts |
| Data | POST /api/pos/imports/preview; POST /api/pos/imports; GET /api/pos/exports/:sid |
| Reporting | GET /api/pos/dashboard; GET /api/pos/reports/* |

Write requests include store context, a request ID, and validated payloads. The server determines whether the actor may use that context. Checkout, offline sync, and refund endpoints are idempotent. An offline sync batch acknowledges each sale separately and durably, so partial network failure does not cause duplicate commits. Image uploads are size/type constrained and processed asynchronously when needed.

## 7. Delivery phases and acceptance

### Phase A — foundation

Create the scoped POS PWA, shared UI extraction, one-store/register/device context, permissions, catalog adapter, product number/barcode lookup, store price and stock objects, IndexedDB snapshot/outbox, grant policy, and stock allocation. Acceptance: POS installs independently; admin remains unchanged; a provisioned device can find products and calculate approved prices in airplane mode; a device without a valid snapshot or grant cannot start an offline sale.

### Phase B — safe sales

Implement the transaction-aware repository, multi-line sales, inventory movements, cash tender, local offline commit, receipt, sync, refunds/voids, and shifts. Acceptance: an airplane-mode cash sale commits locally and prints a pending-sync receipt; restart preserves it; reconnect uploads it once; a timeout after server commit retries to the same sale; two devices cannot allocate or sell the same last item; a failed server transaction rolls back all server writes; storage denial/full quota blocks new offline checkout; an expired offline grant blocks new checkout.

### Phase C — operations

Add import/export, dashboard and reports, product-photo recognition, low-stock alerts, connected external payments, and payment reconciliation. Acceptance: imports preview errors before writing; reports reconcile with sale and refund journals and identify pending local totals; photo results require confirmation and show only the current inventory price; a failed external payment releases its stock reservation and cannot mark a sale PAID.

### Later, only if required

Dedicated printer/drawer integrations, local image recognition, loyalty, procurement, additional stores/merchants, and native app-store packages. These are outside the first release.

## 8. Decisions to confirm before implementation

Confirmed: offline cash sales are required in the first release; launch with one store.

1. Country, currency, tax rules, and any connected payment provider.
2. Scanner and receipt-printer models, if hardware integration is required.
3. Offline grant duration, maximum time since catalog/price refresh, and per-device stock-allocation policy.
4. Whether the canonical 42Pay catalog is shared with POS immediately or exposed through a staged import/mapping.
5. Required recovery procedure if a device is lost before its sales sync; browser storage cannot guarantee recovery of unsynced data.

## 9. Source references

- Repository: docs/architecture.md; docs/design.md; docs/ui.md; docs/42pay/spec.md; docs/42pay/db-design.md; docs/universal-store-design.md; agents/rules/db.md; agents/rules/ui-rules.md.
- Current implementation: src/api/modules/42pay/repo.js; src/api/shared/universal-store/facade.js; src/db/migrations/sqlite/0002_universal_store.sql; src/db/migrations/postgres/0002_universal_store.sql; src/admin/modules/42pay/pages/Pay42ScanPage.jsx.
- PWA tooling: https://vite-pwa-org.netlify.app/guide/
- Service-worker scope: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register
- Camera secure context: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- BarcodeDetector support: https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
- IndexedDB transactions: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
- Persistent storage and quota: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- PWA background sync limitations: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
- WebKit storage policy: https://webkit.org/blog/14403/updates-to-storage-policy/
