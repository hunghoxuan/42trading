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

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "42trade-pos-"));
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const service = createPosService({
    provider: "sqlite", sqlitePath: path.join(dir, "system.db"),
    keys: {
      privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
    },
  });
  return { service, actor: { user_id: "cashier-1" } };
}

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

test("CSV import previews errors, commits once, and exports catalog", async () => {
  const { service, actor } = fixture();
  const csv = "sku,name,barcodes,category,price_minor,vat_rate_bps,opening_stock\n" +
    "COF-1,Coffee,1234,Beverage,25000,1000,5\n";
  const preview = await service.previewImport({ csv });
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.preview[0].action, "CREATE");
  assert.equal((await service.commitImport({ csv }, actor)).duplicate, false);
  assert.equal((await service.commitImport({ csv }, actor)).duplicate, true);
  const product = (await service.catalog())[0];
  assert.equal(product.price_minor, 25000);
  assert.equal(product.on_hand, 5);
  assert.equal(product.vat_rate_bps, 1000);
  assert.match(await service.exportCsv("products"), /COF-1/);
  const collision = await service.previewImport({ csv: csv.replace("COF-1", "OTHER") });
  assert.match(collision.errors.join(" "), /barcode belongs to another product/);
});
