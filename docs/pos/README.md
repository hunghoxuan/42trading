# 42Trade POS implementation

The POS is a React/TypeScript PWA at `/pos/` in the existing 42Trade monorepo. It uses the same API, configured database, universal-store tables, login, permissions, and canonical `42pay_products` records. There is no separate POS database or full-admin PWA migration.

## Launch configuration

- One store (`STORE_1`) and one register (`REG_1`), Vietnam, VND.
- Retail prices exclude VAT; product VAT is added at checkout. New products default to 0% until edited.
- Cash is the supported tender. A paired device can make cash sales offline for eight hours after provisioning, within its reserved stock allocation.
- Offline receipts are marked pending sync. The register shows pending and rejected local sales. A device must sync or reconcile them before refreshing its catalog.

## Run and build

With the normal API and login running, use `pnpm --dir src/pos dev` to serve the POS at `http://localhost:3002/pos/`. The development proxy targets `http://127.0.0.1:3001` by default; set `VITE_API_PROXY_TARGET` to point elsewhere. Sign in to 42Trade first. Use `pnpm --dir src/admin build` to build admin and POS together; the POS files are copied to `src/admin/dist/pos/`. The Docker UI build and Nginx configuration also serve `/pos/` on the same origin as `/api/pos/*`.

For offline sales, sign in while connected, create products and retail prices, receive stock, pair the register, allocate quantities to the device, then refresh its offline catalog. Test the actual register browser's persistent-storage behavior before using it with customers. The signing key is stored at `data/system/pos-grant-key.json` unless `POS_GRANT_KEY_PATH` is set; keep that file across API restarts and backups. Demo 42Pay seeding is disabled by default; set `PAY42_SEED_DEMO=true` only in a demo environment.

## Delivered workflow

- Search products by name, number, or barcode; scan QR/barcodes with the camera or a keyboard scanner. Scanning in Inventory opens the product or prepares a new-product draft.
- Create/edit/archive products, set prices and product VAT, adjust stock with a reason, and reserve stock for an offline device.
- Build a cart, add VAT, collect cash, print a receipt, and sync offline sales in sequence with a stable idempotency key. The server commits sale, stock, and journal changes in one transaction.
- Record partial/full cash returns against synced sales, enforce remaining refundable quantities, optionally restock, and audit each refund. Open and close a register cash shift with expected and counted cash; local pending sales block closing in the PWA.
- Import products, prices, barcodes, VAT, and opening stock from CSV with preview and row validation. Export products and sales CSV. View daily sales, low stock, and sales by day/cashier/product.
- Upload a photo to decode a visible QR/barcode first, then use server OCR to rank products by printed code/name. The cashier confirms a candidate and the shown price comes from the catalog.

## Requirements still open

This is a functional cash POS foundation, not the complete release described in [spec.md](spec.md). The refund API supports full voids, but the PWA currently exposes returns only. Shift totals use synced sales/refunds within the shift's time window; a disconnected device unknown to this register can still send earlier sales later, so the shift needs manual review. Stock-count workflow, connected payment providers, image-only visual matching without readable packaging text, server-side report pagination, XLSX import, and dedicated hardware/printer integration are not implemented. Do not enable connected payment tender until its provider confirmation and reconciliation flow is built.

Offline sales exist only in that browser's IndexedDB until acknowledged by the API. Losing or clearing a device before sync loses those local records. If sync rejects a sale, leave it visible in **Needs attention** and reconcile its cash and stock before reusing the device. The signed grant limits which store, device, and cashier can sync; the browser clock supplies the offline sale timestamp, so a manager must investigate a suspect device clock. The current app requires persistent browser storage before completing an offline sale.

## Verification

`node --test src/api/modules/pos/*.test.js src/api/modules/42pay/repo.test.js` covers VAT, missing prices, offline allocation, idempotent sync, stock reservation, cash returns, shift totals, CSV import, and OCR ranking. `pnpm --dir src/pos build` checks TypeScript and PWA output. Test one register end-to-end on its actual browser, including network loss, reload, reconnect, storage denial, and receipt printing, before taking live sales.
