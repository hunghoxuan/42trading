# 42Trade POS implementation

The POS is a React/TypeScript PWA at `/pos/` in the existing 42Trade monorepo. It uses the same API, configured database, universal-store tables, login, permissions, and canonical `42pay_products` records. There is no separate POS database or full-admin PWA migration.

## Launch configuration

- One store (`STORE_1`) and one register (`REG_1`), Vietnam, VND.
- Retail prices exclude VAT; product VAT is added at checkout. New products default to 0% until edited.
- Cash is the supported tender. A paired device can make cash sales offline for eight hours after provisioning, within its reserved stock allocation.
- Offline receipts are marked pending sync. The register shows pending and rejected local sales. A device must sync or reconcile them before refreshing its catalog.

## Run and build

With the normal API and login running, use `pnpm --dir src/pos dev` to serve the POS at `http://localhost:3002/pos/`. The development proxy targets `http://127.0.0.1:3001` by default; set `VITE_API_PROXY_TARGET` to point elsewhere. Sign in to 42Trade first. For an isolated sample store, run `pnpm --dir src/pos dev:demo`; it serves `http://127.0.0.1:3002/pos/` with sample data in `.local/pos-demo-system.sqlite`. Use `pnpm --dir src/admin build` to build admin and POS together; the POS files are copied to `src/admin/dist/pos/`. The Docker UI build and Nginx configuration also serve `/pos/` on the same origin as `/api/pos/*`.

Local POS and the MT5 Python bridge both use port 3002. When POS is running, `start_dev.sh` leaves it running and skips the bridge. Stop POS before starting the bridge on that port. If a browser still shows an old demo after switching to the live dev server, open `/pos-reset` on the same host as the POS page (for example, `http://127.0.0.1:3002/pos-reset`) once to remove only the POS service worker and its cached assets; local sales in IndexedDB are preserved.

For offline sales, sign in while connected, create products and retail prices, receive stock, pair the register, allocate quantities to the device, then refresh its offline catalog. Test the actual register browser's persistent-storage behavior before using it with customers. The signing key is stored at `data/system/pos-grant-key.json` unless `POS_GRANT_KEY_PATH` is set; keep that file across API restarts and backups. Demo 42Pay seeding is disabled by default; set `PAY42_SEED_DEMO=true` only in a demo environment.

## Delivered workflow

- Search products by name, number, or barcode; scan QR/barcodes with the camera or a keyboard scanner. Scanning in Inventory opens the product or prepares a new-product draft.
- Create/edit/archive products, set prices and product VAT, adjust stock with a reason, and reserve stock for an offline device.
- Build a cart, add VAT, collect cash, print a receipt, and sync offline sales in sequence with a stable idempotency key. The server commits sale, stock, and journal changes in one transaction.
- Record partial/full cash returns against synced sales, enforce remaining refundable quantities, optionally restock, and audit each refund. Open and close a register cash shift with expected and counted cash; local pending sales block closing in the PWA.
- Create a stock count, enter physical quantities, review variances, and post adjustments with a reason. Draft and reviewed counts can be reopened after page reload. Posting rejects stale counts and counts that would consume stock allocated to offline devices.
- Import products, prices, barcodes, VAT, and opening stock from CSV with preview and row validation. Export products and sales CSV. View daily sales, low stock, and sales by day/cashier/product.
- Import the Vietnamese product export as XLSX and export the POS catalog as XLSX. Import preserves product numbers, barcodes, categories, units, VND retail and cost prices, minimum stock, and whole-number on-hand stock. Shared barcodes and fractional/negative stock values are shown as warnings; unsupported stock quantities remain in source-stock metadata for review.
- Switch the interface between Vietnamese (default) and English; the choice is saved on this register.
- Upload a photo to decode a visible QR/barcode first, then use server OCR to rank products by printed code/name. The cashier confirms a candidate and the shown price comes from the catalog.

## Requirements still open

This is a functional cash POS release for one store. Shift totals use synced sales/refunds within the shift's time window; a disconnected device unknown to this register can still send earlier sales later, so the shift needs manual review. Connected payment providers, image-only visual matching without readable packaging text, server-side report pagination, XLSX import, and dedicated hardware/printer integration are not implemented. Barcode/QR scanning uses the camera or keyboard/USB scanners; receipts use browser printing. Do not enable connected payment tender until its provider confirmation and reconciliation flow is built.

Offline sales exist only in that browser's IndexedDB until acknowledged by the API. Losing or clearing a device before sync loses those local records. If sync rejects a sale, leave it visible in **Needs attention** and reconcile its cash and stock before reusing the device. The signed grant limits which store, device, and cashier can sync; the browser clock supplies the offline sale timestamp, so a manager must investigate a suspect device clock. The current app requires persistent browser storage before completing an offline sale.

## Cash photos and change suggestions

The sale cart supports photographing or uploading VND notes. Spread the notes apart and keep every note inside the frame. `POST /api/pos/cash/recognize` requires `apis.pos.sales.write`, validates the image and denomination counts, and computes the total from those counts. It never applies tender or completes checkout. The cashier reviews the photo, corrects denominations/counts, then chooses **Use this amount**. Unclear or hidden notes are flagged; no identifiable cash produces no suggested amount. This is a counting aid, not banknote authentication.

Recognition uses the existing server-side AI gateway and the signed-in user's configured vision provider (first available OpenAI, Claude, OpenRouter or Gemini key). Set `POS_CASH_AI_PROVIDER` and optionally `POS_CASH_AI_MODEL` to select a specific provider/model; without a configured cloud key it uses the existing Ollama default. The selected model must support images. No provider credentials are sent to the browser. Photos are processed for this request and are not saved as POS entities. Recognition requires connectivity; manual tender entry remains available offline.

Change is split into every unique exact denomination combination, lazily paginated five per page with larger denominations first. Common denominations from 1,000 to 500,000 VND are enabled initially; 500, 200 and 100 VND can be enabled under **Available denominations**. Disable denominations the drawer does not have. These are mathematical alternatives with unlimited quantities, not a physical drawer inventory. The app reports when exact change cannot be made with the selected denominations; it never silently rounds the amount. Change calculation works offline.

Cash-specific verification: `node --test src/api/modules/pos/cashVision.test.js src/pos/src/cashChange.test.mjs` (Node with TypeScript stripping support).

## Verification commands

`node --test src/api/modules/pos/*.test.js src/api/modules/42pay/repo.test.js` covers VAT, missing prices, offline allocation, idempotent sync, stock reservation/counts, cash returns, shift totals, CSV import, and OCR ranking. `pnpm --dir src/pos build` checks TypeScript and PWA output. Test one register end-to-end on its actual browser, including network loss, reload, reconnect, storage denial, and receipt printing, before taking live sales.
