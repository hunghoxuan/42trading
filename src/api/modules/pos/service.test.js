"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPosService, calculateLines } = require("./service");

test("VAT is added to the retail price in integer VND", () => {
  const result = calculateLines([{ product_sid: "P1", quantity: 2 }], new Map([
    ["P1", { name: "Coffee", status: "ACTIVE", price_minor: 25000, vat_rate_bps: 1000 }],
  ]));
  assert.equal(result.total_minor, 55000);
  assert.equal(result.lines[0].vat_minor, 5000);
});

test("a product without a retail price cannot be sold for zero", () => {
  assert.throws(() => calculateLines([{ product_sid: "P1", quantity: 1 }], new Map([
    ["P1", { name: "Coffee", status: "ACTIVE", price_minor: null, vat_rate_bps: 0 }],
  ])), /Retail price is required/);
});

function fixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "42trade-pos-"));
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const service = createPosService({
    provider: "sqlite", sqlitePath: path.join(dir, "system.db"),
    ...options,
    keys: {
      privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
    },
  });
  return { service, actor: { user_id: "cashier-1" } };
}

test("product image recognition forwards the authenticated user to AI and returns only matching inventory", async () => {
  let userId;
  const { service, actor } = fixture({ productVision: async (request) => {
    userId = request.userId;
    return JSON.stringify({ product_count: 1, identity_clear: true, object_name: "bottle", product_name: "Sữa tắm Lifebuoy",
      brand: "Lifebuoy", variant: "", size: "350g", barcode: "", texts: ["Lifebuoy Sữa tắm 350g"], colors: ["white"], visible_price: null });
  } });
  await service.upsertProduct({ sid: "LIFE", name: "Sữa tắm Lifebuoy 350g", sku: "LIFE350" }, actor);
  await service.upsertProduct({ sid: "CHOC", name: "choco bar", sku: "CHOC1" }, actor);
  const result = await service.recognizeImage({ image: "data:image/png;base64," + Buffer.from("image").toString("base64") }, actor);
  assert.equal(userId, actor.user_id);
  assert.deepEqual(result.candidates.map(item => item.product_sid), ["LIFE"]);
});

test("automatic photo save changes only the image and supports restoring the previous photo", async () => {
  const { service, actor } = fixture();
  await service.upsertProduct({ sid: "PHOTO1", name: "Coffee", sku: "PHOTO-1", barcodes: ["893001"],
    category: "Coffee", supplier: "Supplier A", unit: "bag", vat_rate_bps: 700,
    cost_minor: 16000, min_stock: 3, status: "ARCHIVED", image: "https://example.test/coffee.jpg" }, actor);
  await service.setPrice({ product_sid: "PHOTO1", price_minor: 25000 }, actor);
  const before = (await service.catalog("", true))[0];
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/tQAAAAASUVORK5CYII=";
  await service.setProductImage({ sid: "PHOTO1", image });
  const after = (await service.catalog("", true))[0];
  assert.equal(after.image, image);
  assert.deepEqual({ ...after, image: before.image }, before);
  await service.setProductImage({ sid: "PHOTO1", image: before.image });
  assert.deepEqual((await service.catalog("", true))[0], before);
  await service.setProductImage({ sid: "PHOTO1", image: "" });
  assert.equal((await service.catalog("", true))[0].image, "");
  await assert.rejects(service.setProductImage({ sid: "PHOTO1", image: "not-an-image" }), /PNG|JPEG|WebP/);
  await assert.rejects(service.setProductImage({ sid: "PHOTO1" }), /Product image is required/);
  await assert.rejects(service.setProductImage({ sid: "MISSING", image }), /Product not found/);
});

test("offline cash sale uses allocated stock and survives idempotent retry", async () => {
  const { service, actor } = fixture();
  await service.upsertProduct({ sid: "P1", name: "Coffee", sku: "COF-1", barcodes: ["1234"] }, actor);
  await service.setPrice({ product_sid: "P1", price_minor: 25000 }, actor);
  await service.adjustStock({ product_sid: "P1", delta: 2, reason: "received" }, actor);
  await service.pairDevice({ device_id: "device-001" }, actor);
  await service.allocateStock({ device_id: "device-001", product_sid: "P1", quantity: 1 }, actor);
  const bootstrap = await service.bootstrap("device-001", actor);
  assert.equal(bootstrap.snapshot.products[0].offline_available, 1);
  const soldAt = new Date(Date.parse(bootstrap.snapshot.issued_at) + 1000).toISOString();
  const request = { device_id: "device-001", grant: bootstrap.grant,
    sale: { idempotency_key: "sale-1", receipt_id: "STORE_1-REG_1-device-001-1", sequence: 1,
      sold_at: soldAt, lines: [{ product_sid: "P1", quantity: 1 }],
      total_minor: 25000, cash_received_minor: 30000, tender: "CASH" } };
  const first = await service.syncSale(request, actor);
  const retry = await service.syncSale(request, actor);
  assert.equal(first.sale.total_minor, 25000);
  assert.equal(first.sale.change_minor, 5000);
  assert.equal(retry.duplicate, true);
  await assert.rejects(service.syncSale({ ...request, sale: { ...request.sale, cash_received_minor: 99999 } }, actor),
    /Idempotency key was already used/);
  assert.equal((await service.catalog("device-001"))[0].on_hand, 1);
  assert.equal((await service.catalog("device-001"))[0].offline_available, 0);
  await assert.rejects(service.syncSale({ ...request, sale: { ...request.sale, idempotency_key: "sale-2",
    receipt_id: "STORE_1-REG_1-device-001-2", sequence: 2 } }, actor), /allocation exhausted/);
  assert.equal((await service.sales()).length, 1);
});

test("online sale cannot use stock reserved for an offline device", async () => {
  const { service, actor } = fixture();
  await service.upsertProduct({ sid: "P1", name: "Coffee", sku: "COF-1" }, actor);
  await service.setPrice({ product_sid: "P1", price_minor: 25000 }, actor);
  await service.adjustStock({ product_sid: "P1", delta: 1, reason: "received" }, actor);
  await service.pairDevice({ device_id: "device-001" }, actor);
  await service.allocateStock({ device_id: "device-001", product_sid: "P1", quantity: 1 }, actor);
  await assert.rejects(service.checkout({ idempotency_key: "online-1",
    lines: [{ product_sid: "P1", quantity: 1 }], cash_received_minor: 25000 }, actor), /Out of stock/);
  assert.equal((await service.catalog())[0].on_hand, 1);
  assert.equal((await service.sales()).length, 0);
});

test("online sale from zero stock is allowed and never reduces inventory below zero", async () => {
  const { service, actor } = fixture();
  await service.upsertProduct({ sid: "PZERO", name: "Zero stock item", sku: "ZERO-1" }, actor);
  await service.setPrice({ product_sid: "PZERO", price_minor: 12000 }, actor);
  await service.adjustStock({ product_sid: "PZERO", delta: 1, reason: "test receipt" }, actor);
  await service.adjustStock({ product_sid: "PZERO", delta: -1, reason: "test sold out" }, actor);
  const sale = await service.checkout({ idempotency_key: "zero-stock-sale-1",
    lines: [{ product_sid: "PZERO", quantity: 2 }], cash_received_minor: 24000 }, actor);
  assert.equal(sale.sale.lines[0].quantity, 2);
  assert.equal((await service.catalog()).find((product) => product.sid === "PZERO").on_hand, 0);
  const next = await service.checkout({ idempotency_key: "zero-stock-sale-2",
    lines: [{ product_sid: "PZERO", quantity: 1 }], cash_received_minor: 12000 }, actor);
  assert.equal(next.sale.lines[0].quantity, 1);
  assert.equal((await service.catalog()).find((product) => product.sid === "PZERO").on_hand, 0);
});

test("CSV import previews errors, commits once, and exports catalog", async () => {
  const { service, actor } = fixture();
  const csv = "sku,name,barcodes,category,supplier,price_minor,vat_rate_bps,opening_stock\n" +
    "COF-1,Coffee,1234,Beverage,Acme,25000,1000,5\n";
  const preview = await service.previewImport({ csv });
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.preview[0].action, "CREATE");
  assert.equal((await service.commitImport({ csv }, actor)).duplicate, false);
  assert.equal((await service.commitImport({ csv }, actor)).duplicate, true);
  const product = (await service.catalog())[0];
  assert.equal(product.price_minor, 25000);
  assert.equal(product.on_hand, 5);
  assert.equal(product.vat_rate_bps, 1000);
  assert.equal(product.supplier, "Acme");
  assert.match(await service.exportCsv("products"), /COF-1/);
  assert.match(await service.exportCsv("products"), /Acme/);
  const collision = await service.previewImport({ csv: csv.replace("COF-1", "OTHER") });
  assert.match(collision.warnings.join(" "), /barcode is shared with another product/);
});

test("inventory can list inactive products and update supplier and image details", async () => {
  const { service, actor } = fixture();
  await service.upsertProduct({ sid: "P1", name: "Coffee", sku: "COF-1", supplier: "Acme", image: "https://example.test/coffee.png" }, actor);
  assert.equal((await service.catalog()).length, 1);
  const archived = await service.upsertProduct({ sid: "P1", name: "Coffee", sku: "COF-1", supplier: "Bean Co", image: "data:image/png;base64,abc", status: "ARCHIVED" }, actor);
  assert.equal(archived.product.supplier, "Bean Co");
  assert.equal(archived.product.image, "data:image/png;base64,abc");
  assert.equal((await service.catalog()).length, 0);
  assert.equal((await service.catalog("", true))[0].status, "ARCHIVED");
  const restored = await service.upsertProduct({ sid: "P1", name: "Coffee", sku: "COF-1", status: "ACTIVE" }, actor);
  assert.equal(restored.product.status, "ACTIVE");
  assert.equal(restored.product.supplier, "Bean Co");
  const tagged = await service.upsertProduct({ sid: "P1", name: "Coffee", sku: "COF-1",
    search_keywords: ["coffee beans", "arabica"], label_texts: ["100% arabica"] }, actor);
  assert.deepEqual(tagged.product.search_keywords, ["coffee beans", "arabica"]);
  assert.deepEqual(tagged.product.label_texts, ["100% arabica"]);
});

test("product row import preserves units and source stock while allowing ambiguous barcodes", async () => {
  const { service, actor } = fixture();
  const rows = [
    { row_number: 2, sku: "ITEM-1", name: "Rice 1kg", barcodes: ["123456"], category: "Food",
      unit: "kg", price_minor: 40000, cost_minor: 32000, min_stock: 0.5, source_on_hand: 2, opening_stock: 2 },
    { row_number: 3, sku: "ITEM-2", name: "Rice 500g", barcodes: ["123456"], category: "Food",
      unit: "bag", price_minor: 22000, cost_minor: 17000, min_stock: 1, source_on_hand: 1.5, opening_stock: "" },
  ];
  const preview = await service.previewImport({ rows });
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.warning_count, 2);
  const imported = await service.commitImport({ rows }, actor);
  assert.equal(imported.run.count, 2);
  const catalog = await service.catalog();
  assert.deepEqual(catalog.map((product) => product.unit).sort(), ["bag", "kg"]);
  assert.equal(catalog.find((product) => product.sku === "ITEM-1").cost_minor, 32000);
  assert.equal(catalog.find((product) => product.sku === "ITEM-2").stock_import_warning, true);
  assert.equal(catalog.find((product) => product.sku === "ITEM-2").on_hand, 0);
  assert.equal(catalog.find((product) => product.sku === "ITEM-1").on_hand, 2);
});

test("cash returns refund only unsold quantities and optionally restock", async () => {
  const { service, actor } = fixture();
  await service.upsertProduct({ sid: "P1", name: "Coffee", sku: "COF-1", vat_rate_bps: 1000 }, actor);
  await service.setPrice({ product_sid: "P1", price_minor: 25000 }, actor);
  await service.adjustStock({ product_sid: "P1", delta: 3, reason: "received" }, actor);
  const sale = (await service.checkout({ idempotency_key: "sale-return-1",
    lines: [{ product_sid: "P1", quantity: 2 }], cash_received_minor: 60000 }, actor)).sale;
  const request = { sale_sid: sale.sid, idempotency_key: "return-1", reason: "Customer return",
    lines: [{ product_sid: "P1", quantity: 1, restock: true }] };
  const returned = await service.refundSale(request, actor);
  assert.equal(returned.return.amount_minor, 27500);
  assert.equal((await service.refundSale(request, actor)).duplicate, true);
  await assert.rejects(service.refundSale({ ...request, idempotency_key: "return-2",
    lines: [{ product_sid: "P1", quantity: 2, restock: true }] }, actor), /exceeds remaining quantity/);
  assert.equal((await service.catalog())[0].on_hand, 2);
  const rest = await service.refundSale({ sale_sid: sale.sid, idempotency_key: "return-3",
    reason: "Remaining return", lines: [{ product_sid: "P1", quantity: 1, restock: false }] }, actor);
  assert.equal(rest.return.amount_minor, 27500);
  assert.equal((await service.sales())[0].refund_status, "REFUNDED");
  assert.equal((await service.dashboard()).net_minor, 0);
});

test("a cash shift totals sales and refunds and rejects local pending sales", async () => {
  const { service, actor } = fixture();
  await service.upsertProduct({ sid: "P1", name: "Coffee", sku: "COF-1" }, actor);
  await service.setPrice({ product_sid: "P1", price_minor: 25000 }, actor);
  await service.adjustStock({ product_sid: "P1", delta: 1, reason: "received" }, actor);
  const shift = (await service.openShift({ opening_cash_minor: 10000 }, actor)).shift;
  await assert.rejects(service.openShift({ opening_cash_minor: 0 }, actor), /already has an open shift/);
  await service.checkout({ idempotency_key: "shift-sale-1", lines: [{ product_sid: "P1", quantity: 1 }],
    cash_received_minor: 30000 }, actor);
  await assert.rejects(service.closeShift({ shift_sid: shift.sid, counted_cash_minor: 35000, pending_count: 1 }, actor),
    /Sync pending local sales/);
  const closed = (await service.closeShift({ shift_sid: shift.sid,
    counted_cash_minor: 35000, pending_count: 0 }, actor)).shift;
  assert.equal(closed.expected_cash_minor, 35000);
  assert.equal(closed.variance_minor, 0);
});

test("stock counts can be reviewed and posted, but reject stale or allocated stock", async () => {
  const { service, actor } = fixture();
  await service.upsertProduct({ sid: "P1", name: "Coffee", sku: "COF-1" }, actor);
  await service.adjustStock({ product_sid: "P1", delta: 5, reason: "received" }, actor);
  const count = (await service.createStockCount(actor)).count;
  const reviewed = await service.submitStockCount({ count_sid: count.sid,
    lines: [{ product_sid: "P1", counted_on_hand: 4 }] }, actor);
  assert.equal(reviewed.count.lines[0].variance, -1);
  await service.postStockCount({ count_sid: count.sid, reason: "Physical count" }, actor);
  assert.equal((await service.catalog())[0].on_hand, 4);

  const stale = (await service.createStockCount(actor)).count;
  await service.submitStockCount({ count_sid: stale.sid,
    lines: [{ product_sid: "P1", counted_on_hand: 4 }] }, actor);
  await service.adjustStock({ product_sid: "P1", delta: 1, reason: "received after count" }, actor);
  await assert.rejects(service.postStockCount({ count_sid: stale.sid, reason: "Physical count" }, actor),
    /Stock changed during count/);

  const allocated = (await service.createStockCount(actor)).count;
  await service.submitStockCount({ count_sid: allocated.sid,
    lines: [{ product_sid: "P1", counted_on_hand: 1 }] }, actor);
  await service.pairDevice({ device_id: "device-001" }, actor);
  await service.allocateStock({ device_id: "device-001", product_sid: "P1", quantity: 2 }, actor);
  await assert.rejects(service.postStockCount({ count_sid: allocated.sid, reason: "Physical count" }, actor),
    /below stock allocated/);
});
