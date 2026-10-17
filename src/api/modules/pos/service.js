"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createUniversalStoreAdapter } = require("../../shared/universal-store/adapterFactory");
const { imageBuffer } = require("./vision");
const { recognizeCashImage } = require("./cashVision");
const { recognizeProductWithAI } = require("./productVision");
const { parseCsv, parseProductRows, validateRows, toCsv } = require("./imports");

const TENANT = "__42pay__";
const STORE_ID = "STORE_1";
const REGISTER_ID = "REG_1";
const PRODUCT = "42pay_products";
const PREFIX = "pos_";
const KEY_PATH = process.env.POS_GRANT_KEY_PATH || path.resolve(__dirname, "../../../../data/system/pos-grant-key.json");

class PosError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requiredText(value, label) {
  const result = String(value ?? "").trim();
  if (!result) throw new PosError(label + " is required");
  return result;
}

function nonNegativeInt(value, label) {
  if (value === null || value === undefined || value === "") throw new PosError(label + " is required");
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new PosError(label + " must be a non-negative integer");
  return result;
}

function positiveInt(value, label) {
  const result = nonNegativeInt(value, label);
  if (result === 0) throw new PosError(label + " must be greater than zero");
  return result;
}

function id(prefix) {
  return prefix + "_" + crypto.randomUUID().replace(/-/g, "");
}

function now() { return new Date().toISOString(); }

function dataOf(row) { return row?.data && typeof row.data === "object" ? row.data : null; }

function entity(type, key, data, current = null, extra = {}) {
  return {
    id: current?.id || undefined,
    tenantId: TENANT,
    entityType: type,
    entityKey: key,
    title: data.name || data.sid || key,
    status: data.status || "ACTIVE",
    scopeModule: "pos",
    scopeTenantId: TENANT,
    createdAt: current?.created_at || now(),
    updatedAt: now(),
    data,
    ...extra,
  };
}

function loadSigningKeys() {
  try {
    return JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true, mode: 0o700 });
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const keys = {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
  };
  try {
    fs.writeFileSync(KEY_PATH, JSON.stringify(keys), { flag: "wx", mode: 0o600 });
    return keys;
  } catch (error) {
    if (error.code === "EEXIST") return JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
    throw error;
  }
}

function signGrant(claims, keys) {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign("sha256", Buffer.from(body), {
    key: keys.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return body + "." + signature;
}

function verifyGrant(token, keys) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw new PosError("Invalid offline grant", 401);
  const valid = crypto.verify("sha256", Buffer.from(parts[0]), {
    key: keys.publicKey,
    dsaEncoding: "ieee-p1363",
  }, Buffer.from(parts[1], "base64url"));
  if (!valid) throw new PosError("Invalid offline grant", 401);
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
  catch { throw new PosError("Invalid offline grant", 401); }
  return claims;
}

function runOperation(tx, operation) {
  const [method, ...args] = operation;
  if (method === "lockStore") {
    if (tx.backend === "sqlite") return null;
    return tx.pool.query("SELECT id FROM object_entities WHERE tenant_id=$1 AND entity_type='pos_store' AND entity_key=$2 FOR UPDATE", [TENANT, STORE_ID]);
  }
  return tx[method](...args);
}

function runSyncScript(tx, script) {
  const generator = script();
  let step = generator.next();
  while (!step.done) {
    const value = runOperation(tx, step.value);
    if (value && typeof value.then === "function") throw new Error("Async operation in SQLite transaction");
    step = generator.next(value);
  }
  return step.value;
}

async function runAsyncScript(tx, script) {
  const generator = script();
  let step = generator.next();
  while (!step.done) step = generator.next(await runOperation(tx, step.value));
  return step.value;
}

function productView(row, priceRow, stockRow, allocationRow) {
  const product = dataOf(row) || {};
  const metadata = product.metadata || {};
  const price = dataOf(priceRow) || {};
  const stock = dataOf(stockRow) || {};
  const allocation = dataOf(allocationRow) || {};
  return {
    sid: product.sid || row.entity_key,
    name: product.name || "",
    sku: metadata.pos_sku || "",
    barcodes: Array.isArray(metadata.pos_barcodes) ? metadata.pos_barcodes : [],
    category: metadata.category || product.type || "",
    supplier: metadata.pos_supplier || "",
    description: metadata.description || "",
    search_keywords: Array.isArray(metadata.pos_search_keywords) ? metadata.pos_search_keywords : [],
    label_texts: Array.isArray(metadata.pos_label_texts) ? metadata.pos_label_texts : [],
    unit: metadata.pos_unit || "each",
    family_sku: metadata.pos_family_sku || "",
    group_code: metadata.pos_group_code || "",
    image: product.image || "",
    status: product.status || "ACTIVE",
    price_minor: price.price_minor ?? null,
    vat_rate_bps: metadata.pos_vat_rate_bps ?? 0,
    cost_minor: metadata.pos_cost_minor ?? null,
    min_stock: metadata.pos_min_stock ?? 0,
    source_on_hand: metadata.pos_source_on_hand ?? null,
    stock_import_warning: Boolean(metadata.pos_stock_import_warning),
    on_hand: stock.on_hand ?? 0,
    allocated: stock.allocated ?? 0,
    offline_available: Math.max(0, (allocation.issued || 0) - (allocation.consumed || 0)),
  };
}

function calculateLines(lines, products) {
  if (!Array.isArray(lines) || lines.length === 0) throw new PosError("Sale needs at least one line");
  const merged = new Map();
  for (const line of lines) {
    const sid = requiredText(line.product_sid || line.sid, "Product SID");
    const quantity = positiveInt(line.quantity, "Quantity");
    merged.set(sid, (merged.get(sid) || 0) + quantity);
  }
  const result = [];
  for (const [sid, quantity] of merged) {
    const product = products.get(sid);
    if (!product || product.status !== "ACTIVE") throw new PosError("Product unavailable: " + sid);
    const price = nonNegativeInt(product.price_minor, "Retail price");
    const vat_rate_bps = nonNegativeInt(product.vat_rate_bps ?? 0, "VAT rate");
    if (vat_rate_bps > 10000) throw new PosError("VAT rate exceeds 100%");
    const base_minor = price * quantity;
    const vat_minor = Math.round(base_minor * vat_rate_bps / 10000);
    const total = base_minor + vat_minor;
    if (!Number.isSafeInteger(total)) throw new PosError("Sale total exceeds safe integer range");
    result.push({ product_sid: sid, name: product.name, quantity, price_minor: price,
      vat_rate_bps, base_minor, vat_minor, total_minor: total });
  }
  const total_minor = result.reduce((sum, line) => sum + line.total_minor, 0);
  if (!Number.isSafeInteger(total_minor)) throw new PosError("Sale total exceeds safe integer range");
  return { lines: result, total_minor };
}

function createPosService(options = {}) {
  const adapter = options.adapter || createUniversalStoreAdapter(options);
  const keys = options.keys || loadSigningKeys();
  let ready;
  async function init() {
    if (!ready) ready = (async () => {
      await adapter.init();
      const store = await adapter.getEntity(TENANT, "pos_store", STORE_ID);
      if (!store) await adapter.upsertEntity(entity("pos_store", STORE_ID, {
        sid: STORE_ID, name: "42Trade Store", country: "VN", currency: "VND",
        timezone: "Asia/Ho_Chi_Minh", tax_rate_bps: 0, status: "ACTIVE",
      }));
      const register = await adapter.getEntity(TENANT, "pos_register", REGISTER_ID);
      if (!register) await adapter.upsertEntity(entity("pos_register", REGISTER_ID, {
        sid: REGISTER_ID, store_sid: STORE_ID, name: "Main register", status: "ACTIVE",
      }));
    })().catch((error) => { ready = null; throw error; });
    await ready;
  }

  async function get(type, key) { await init(); return adapter.getEntity(TENANT, type, key); }
  async function list(type) {
    await init();
    const result = [];
    let offset = 0;
    for (;;) {
      const page = await adapter.listEntities({ tenantId: TENANT, entityType: type, limit: 500, offset });
      result.push(...page);
      if (page.length < 500) return result;
      offset += page.length;
    }
  }
  async function transact(script) {
    await init();
    return adapter.withTransaction((tx) => tx.backend === "sqlite"
      ? runSyncScript(tx, script)
      : runAsyncScript(tx, script));
  }
  async function catalog(deviceId = "", includeArchived = false) {
    const [products, prices, stocks, allocations] = await Promise.all([
      list(PRODUCT), list("pos_price"), list("pos_stock"), deviceId ? list("pos_stock_allocation") : [],
    ]);
    const byKey = (rows) => new Map(rows.map((row) => [row.entity_key, row]));
    const priceByKey = byKey(prices);
    const stockByKey = byKey(stocks);
    const allocationByKey = byKey(allocations);
    return products.map((row) => productView(row, priceByKey.get(row.entity_key),
      stockByKey.get(row.entity_key), allocationByKey.get(deviceId + ":" + row.entity_key)))
      .filter((product) => includeArchived || product.status === "ACTIVE");
  }

  async function upsertProduct(input, actor) {
    const sid = String(input.sid || id("P42P")).trim();
    const name = requiredText(input.name, "Product name");
    const sku = requiredText(input.sku, "Product number");
    const barcodes = [...new Set((Array.isArray(input.barcodes) ? input.barcodes : [])
      .map((value) => String(value).trim()).filter(Boolean))];
    const vatRate = nonNegativeInt(input.vat_rate_bps ?? 0, "VAT rate");
    if (vatRate > 10000) throw new PosError("VAT rate exceeds 100%");
    const costMinor = input.cost_minor === undefined
      ? undefined : input.cost_minor === "" || input.cost_minor === null ? null : nonNegativeInt(input.cost_minor, "Cost");
    const minStock = input.min_stock === undefined ? undefined : Number(input.min_stock);
    if (minStock !== undefined && (!Number.isFinite(minStock) || minStock < 0)) {
      throw new PosError("Minimum stock must be a non-negative number");
    }
    await transact(function* () {
      yield ["lockStore"];
      const products = yield ["listEntities", { tenantId: TENANT, entityType: PRODUCT, limit: 10000 }];
      for (const row of products) {
        if (row.entity_key === sid) continue;
        const other = dataOf(row)?.metadata || {};
        if (other.pos_sku === sku) throw new PosError("Product number already exists");
      }
      const current = yield ["getEntity", TENANT, PRODUCT, sid];
      const previous = dataOf(current) || {};
      const product = {
        ...previous, sid, name, image: String(input.image ?? previous.image ?? ""),
        type: String(input.type || previous.type || "retail"),
        status: input.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
        create_sid: previous.create_sid || actor.user_id,
        created_at: previous.created_at || now(), updated_at: now(),
        metadata: {
          ...(previous.metadata || {}), pos_sku: sku, pos_barcodes: barcodes,
          pos_unit: String(input.unit || "each"), pos_vat_rate_bps: vatRate,
          pos_cost_minor: costMinor === undefined ? previous.metadata?.pos_cost_minor ?? null : costMinor,
          pos_min_stock: minStock === undefined ? previous.metadata?.pos_min_stock ?? 0 : minStock,
          category: String(input.category || ""),
          pos_supplier: String(input.supplier ?? previous.metadata?.pos_supplier ?? ""),
          description: String(input.description || ""),
          pos_search_keywords: Array.isArray(input.search_keywords)
            ? [...new Set(input.search_keywords.map((value) => String(value).trim().slice(0, 250)).filter(Boolean))].slice(0, 100)
            : previous.metadata?.pos_search_keywords || [],
          pos_label_texts: Array.isArray(input.label_texts)
            ? [...new Set(input.label_texts.map((value) => String(value).trim().slice(0, 500)).filter(Boolean))].slice(0, 100)
            : previous.metadata?.pos_label_texts || [],
        },
      };
      yield ["upsertEntity", entity(PRODUCT, sid, product, current, {
        title: name, category: product.metadata.category, scopeModule: "42pay",
        visibility: "PUBLIC", accessLevel: "PUBLIC_READ",
      })];
    });
    return { ok: true, product: (await catalog("", true)).find((row) => row.sid === sid) };
  }

  async function setProductImage(input) {
    const sid = requiredText(input.sid, "Product SID");
    if (typeof input.image !== "string") throw new PosError("Product image is required");
    const image = input.image;
    if (/^(https?:\/\/|\/(?!\/))/.test(image)) {
      new URL(image, "http://pos.local");
    } else if (image) imageBuffer(image);
    await transact(function* () {
      yield ["lockStore"];
      const current = yield ["getEntity", TENANT, PRODUCT, sid];
      if (!current) throw new PosError("Product not found", 404);
      const previous = dataOf(current);
      const product = { ...previous, image, updated_at: now() };
      yield ["upsertEntity", entity(PRODUCT, sid, product, current, {
        scopeModule: current.scope_module || "42pay", category: current.category || previous.metadata?.category || "",
        visibility: current.visibility || "PUBLIC", accessLevel: current.access_level || "PUBLIC_READ",
      })];
    });
    return { ok: true, image };
  }

  async function setPrice(input, actor) {
    const sid = requiredText(input.product_sid, "Product SID");
    const price_minor = nonNegativeInt(input.price_minor, "Price");
    return transact(function* () {
      yield ["lockStore"];
      if (!(yield ["getEntity", TENANT, PRODUCT, sid])) throw new PosError("Product not found", 404);
      const current = yield ["getEntity", TENANT, "pos_price", sid];
      const value = { product_sid: sid, store_sid: STORE_ID, price_minor, currency: "VND", updated_by: actor.user_id, updated_at: now() };
      yield ["upsertEntity", entity("pos_price", sid, value, current, { currency: "VND" })];
      yield ["appendJournal", { tenantId: TENANT, entityType: "pos_price", entityKey: sid,
        userId: actor.user_id, entryType: "pos.price.changed", data: { before: dataOf(current), after: value } }];
      return { ok: true, price: value };
    });
  }

  async function adjustStock(input, actor) {
    const sid = requiredText(input.product_sid, "Product SID");
    const delta = Number(input.delta);
    if (!Number.isSafeInteger(delta) || delta === 0) throw new PosError("Stock delta must be a non-zero integer");
    const reason = requiredText(input.reason, "Reason");
    return transact(function* () {
      yield ["lockStore"];
      const product = yield ["getEntity", TENANT, PRODUCT, sid];
      if (!product) throw new PosError("Product not found", 404);
      const current = yield ["getEntity", TENANT, "pos_stock", sid];
      const previous = dataOf(current) || { on_hand: 0, allocated: 0 };
      const on_hand = previous.on_hand + delta;
      if (on_hand < previous.allocated) throw new PosError("Adjustment would consume stock allocated to offline devices", 409);
      const next = { ...previous, product_sid: sid, store_sid: STORE_ID, on_hand,
        allocated: previous.allocated, updated_at: now() };
      yield ["upsertEntity", entity("pos_stock", sid, next, current)];
      yield ["appendJournal", { tenantId: TENANT, entityType: "pos_stock", entityKey: sid,
        userId: actor.user_id, entryType: "pos.stock.adjusted", data: { delta, reason, before: previous.on_hand, after: on_hand } }];
      return { ok: true, stock: next };
    });
  }

  async function createStockCount(actor) {
    return transact(function* () {
      yield ["lockStore"];
      const products = yield ["listEntities", { tenantId: TENANT, entityType: PRODUCT, limit: 10000 }];
      const stocks = yield ["listEntities", { tenantId: TENANT, entityType: "pos_stock", limit: 10000 }];
      const stockBySid = new Map(stocks.map((row) => [row.entity_key, dataOf(row)]));
      const lines = products.map((row) => dataOf(row)).filter((product) => product?.status === "ACTIVE")
        .filter((product) => stockBySid.has(product.sid))
        .map((product) => ({ product_sid: product.sid, name: product.name,
          expected_on_hand: stockBySid.get(product.sid).on_hand, counted_on_hand: null }));
      if (!lines.length) throw new PosError("No stock records available to count", 409);
      const sid = id("COUNT");
      const count = { sid, store_sid: STORE_ID, status: "DRAFT", actor_id: actor.user_id,
        created_at: now(), lines };
      yield ["upsertEntity", entity("pos_stock_count", sid, count)];
      yield ["appendJournal", { tenantId: TENANT, entityType: "pos_stock_count", entityKey: sid,
        userId: actor.user_id, entryType: "pos.stock_count.created", data: { line_count: lines.length } }];
      return { ok: true, count };
    });
  }

  async function submitStockCount(input, actor) {
    const sid = requiredText(input.count_sid, "Count SID");
    if (!Array.isArray(input.lines)) throw new PosError("Count lines are required");
    return transact(function* () {
      yield ["lockStore"];
      const row = yield ["getEntity", TENANT, "pos_stock_count", sid];
      const count = dataOf(row);
      if (!count || count.status !== "DRAFT") throw new PosError("Draft stock count not found", 404);
      if (count.actor_id !== actor.user_id) throw new PosError("Only the count owner can submit it", 403);
      const submitted = new Map(input.lines.map((line) => [line.product_sid, line.counted_on_hand]));
      if (submitted.size !== count.lines.length) throw new PosError("Submit every stock count line", 400);
      const lines = count.lines.map((line) => {
        const quantity = nonNegativeInt(submitted.get(line.product_sid), "Counted quantity");
        return { ...line, counted_on_hand: quantity, variance: quantity - line.expected_on_hand };
      });
      const next = { ...count, status: "REVIEWED", lines, submitted_at: now() };
      yield ["upsertEntity", entity("pos_stock_count", sid, next, row)];
      yield ["appendJournal", { tenantId: TENANT, entityType: "pos_stock_count", entityKey: sid,
        userId: actor.user_id, entryType: "pos.stock_count.reviewed",
        data: { variance_lines: lines.filter((line) => line.variance !== 0).length } }];
      return { ok: true, count: next };
    });
  }

  async function postStockCount(input, actor) {
    const sid = requiredText(input.count_sid, "Count SID");
    const reason = requiredText(input.reason, "Posting reason");
    return transact(function* () {
      yield ["lockStore"];
      const row = yield ["getEntity", TENANT, "pos_stock_count", sid];
      const count = dataOf(row);
      if (!count || count.status !== "REVIEWED") throw new PosError("Reviewed stock count not found", 404);
      if (count.actor_id !== actor.user_id) throw new PosError("Only the count owner can post it", 403);
      for (const line of count.lines) {
        const stockRow = yield ["getEntity", TENANT, "pos_stock", line.product_sid];
        const stock = dataOf(stockRow);
        if (!stock || stock.on_hand !== line.expected_on_hand) {
          throw new PosError("Stock changed during count for " + line.name + "; start a new count", 409);
        }
        if (line.counted_on_hand === null || line.counted_on_hand === undefined) {
          throw new PosError("Count line is incomplete: " + line.name, 409);
        }
        if (line.counted_on_hand < stock.allocated) {
          throw new PosError("Count is below stock allocated to offline registers for " + line.name, 409);
        }
        const delta = line.counted_on_hand - stock.on_hand;
        if (delta) {
          yield ["upsertEntity", entity("pos_stock", line.product_sid,
            { ...stock, on_hand: line.counted_on_hand, updated_at: now() }, stockRow)];
          yield ["appendJournal", { tenantId: TENANT, entityType: "pos_stock", entityKey: line.product_sid,
            userId: actor.user_id, entryType: "pos.stock.count_adjustment",
            data: { count_sid: sid, delta, reason, counted_on_hand: line.counted_on_hand } }];
        }
      }
      const posted = { ...count, status: "POSTED", posted_by: actor.user_id, posted_at: now(), posting_reason: reason };
      yield ["upsertEntity", entity("pos_stock_count", sid, posted, row)];
      yield ["appendJournal", { tenantId: TENANT, entityType: "pos_stock_count", entityKey: sid,
        userId: actor.user_id, entryType: "pos.stock_count.posted", data: { reason } }];
      return { ok: true, count: posted };
    });
  }

  async function stockCounts() { return (await list("pos_stock_count")).map(dataOf).filter(Boolean); }

  async function pairDevice(input, actor) {
    const deviceId = requiredText(input.device_id, "Device ID");
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(deviceId)) throw new PosError("Invalid device ID");
    const current = await get("pos_device", deviceId);
    if (current && dataOf(current)?.cashier_id !== actor.user_id) throw new PosError("Device belongs to another cashier", 403);
    const value = { device_id: deviceId, store_sid: STORE_ID, register_sid: REGISTER_ID,
      cashier_id: actor.user_id, status: "ACTIVE", paired_at: current?.data?.paired_at || now(),
      last_sequence: current?.data?.last_sequence || 0 };
    await adapter.upsertEntity(entity("pos_device", deviceId, value, current));
    return { ok: true, device: value };
  }

  async function allocateStock(input, actor) {
    const deviceId = requiredText(input.device_id, "Device ID");
    const sid = requiredText(input.product_sid, "Product SID");
    const quantity = nonNegativeInt(input.quantity, "Allocation quantity");
    const key = deviceId + ":" + sid;
    return transact(function* () {
      yield ["lockStore"];
      const device = yield ["getEntity", TENANT, "pos_device", deviceId];
      if (!device || dataOf(device)?.status !== "ACTIVE") throw new PosError("Device is not paired", 404);
      const stockRow = yield ["getEntity", TENANT, "pos_stock", sid];
      const stock = dataOf(stockRow);
      if (!stock) throw new PosError("Stock is not configured", 404);
      const allocationRow = yield ["getEntity", TENANT, "pos_stock_allocation", key];
      const previous = dataOf(allocationRow) || { issued: 0, consumed: 0 };
      const oldRemaining = previous.issued - previous.consumed;
      if (quantity < oldRemaining) throw new PosError("Cannot reduce allocation below unsynced device balance; reconcile device first", 409);
      const delta = quantity - oldRemaining;
      if (stock.on_hand - stock.allocated < delta) throw new PosError("Insufficient unallocated stock", 409);
      const nextAllocation = { device_id: deviceId, product_sid: sid, store_sid: STORE_ID,
        issued: previous.issued + delta, consumed: previous.consumed, updated_at: now() };
      const nextStock = { ...stock, allocated: stock.allocated + delta, updated_at: now() };
      yield ["upsertEntity", entity("pos_stock_allocation", key, nextAllocation, allocationRow)];
      yield ["upsertEntity", entity("pos_stock", sid, nextStock, stockRow)];
      yield ["appendJournal", { tenantId: TENANT, entityType: "pos_stock_allocation", entityKey: key,
        userId: actor.user_id, entryType: "pos.stock.allocated", data: { delta, remaining: quantity } }];
      return { ok: true, allocation: nextAllocation };
    });
  }

  async function bootstrap(deviceId, actor) {
    const device = await get("pos_device", deviceId);
    if (!device || dataOf(device)?.cashier_id !== actor.user_id || dataOf(device)?.status !== "ACTIVE") {
      throw new PosError("Pair this device before offline selling", 403);
    }
    const products = await catalog(deviceId);
    const store = dataOf(await get("pos_store", STORE_ID));
    const snapshotId = id("SNAP");
    const issuedAt = now();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const snapshot = { sid: snapshotId, store_sid: STORE_ID, device_id: deviceId,
      products, currency: store.currency, tax_rate_bps: store.tax_rate_bps,
      issued_at: issuedAt, expires_at: expiresAt };
    await adapter.upsertEntity(entity("pos_snapshot", snapshotId, snapshot));
    const grant = signGrant({ snapshot_id: snapshotId, store_sid: STORE_ID, register_sid: REGISTER_ID,
      device_id: deviceId, cashier_id: actor.user_id, issued_at: issuedAt, expires_at: expiresAt }, keys);
    return { ok: true, snapshot, grant, public_key: keys.publicKey };
  }

  function* saleScript(sale, mode, claims = null) {
    yield ["lockStore"];
    const existing = yield ["getEntity", TENANT, "pos_sale", sale.idempotency_key];
    if (existing) {
      const prior = dataOf(existing);
      const requestedLines = new Map();
      for (const line of sale.lines || []) {
        const sid = line.product_sid || line.sid;
        requestedLines.set(sid, (requestedLines.get(sid) || 0) + Number(line.quantity));
      }
      const sameLines = requestedLines.size === prior.lines.length && prior.lines.every((line) =>
        requestedLines.get(line.product_sid) === line.quantity);
      if (prior.cashier_id !== sale.cashier_id || prior.origin !== mode ||
          prior.device_id !== (sale.device_id || null) ||
          (sale.receipt_id && prior.receipt_id !== sale.receipt_id) ||
          (sale.sequence && prior.sequence !== sale.sequence) ||
          (sale.total_minor !== undefined && prior.total_minor !== Number(sale.total_minor)) ||
          prior.cash_received_minor !== Number(sale.cash_received_minor) || !sameLines) {
        throw new PosError("Idempotency key was already used for a different sale", 409);
      }
      return { ok: true, sale: prior, duplicate: true };
    }
    const registerRow = yield ["getEntity", TENANT, "pos_register", REGISTER_ID];
    sale.shift_sid = dataOf(registerRow)?.current_shift_sid || null;
    let deviceRow = null;
    if (mode === "offline") {
      deviceRow = yield ["getEntity", TENANT, "pos_device", claims.device_id];
      const device = dataOf(deviceRow);
      if (!device || device.status !== "ACTIVE") throw new PosError("Device is disabled", 403);
      const sequence = positiveInt(sale.sequence, "Sale sequence");
      if (sequence !== device.last_sequence + 1) throw new PosError("Offline sale sequence is out of order", 409);
      const expectedReceipt = [STORE_ID, REGISTER_ID, claims.device_id, sequence].join("-");
      if (sale.receipt_id !== expectedReceipt) throw new PosError("Offline receipt ID is invalid", 409);
    }
    let snapshotProducts = null;
    if (mode === "offline") {
      const snapshotRow = yield ["getEntity", TENANT, "pos_snapshot", claims.snapshot_id];
      const snapshot = dataOf(snapshotRow);
      if (!snapshot || snapshot.device_id !== claims.device_id) throw new PosError("Offline snapshot not found", 409);
      snapshotProducts = new Map(snapshot.products.map((product) => [product.sid, product]));
    }
    const products = new Map();
    for (const line of sale.lines || []) {
      const sid = requiredText(line.product_sid || line.sid, "Product SID");
      if (products.has(sid)) continue;
      const productRow = yield ["getEntity", TENANT, PRODUCT, sid];
      const product = dataOf(productRow);
      const priceRow = mode === "online" ? yield ["getEntity", TENANT, "pos_price", sid] : null;
      const price = mode === "online" ? dataOf(priceRow)?.price_minor : snapshotProducts?.get(sid)?.price_minor;
      products.set(sid, { sid, name: mode === "online" ? product?.name : snapshotProducts?.get(sid)?.name,
        status: mode === "online" ? product?.status : snapshotProducts?.get(sid)?.status,
        price_minor: price,
        vat_rate_bps: mode === "online" ? product?.metadata?.pos_vat_rate_bps : snapshotProducts?.get(sid)?.vat_rate_bps });
    }
    const calculated = calculateLines(sale.lines, products);
    if (mode === "offline" && calculated.total_minor !== sale.total_minor) throw new PosError("Offline sale total does not match approved price snapshot", 409);
    const cashReceived = nonNegativeInt(sale.cash_received_minor, "Cash received");
    if (cashReceived < calculated.total_minor) throw new PosError("Cash received is below sale total");
    for (const line of calculated.lines) {
      const stockRow = yield ["getEntity", TENANT, "pos_stock", line.product_sid];
      const stock = dataOf(stockRow);
      if (!stock) throw new PosError("Stock not configured: " + line.product_sid, 409);
      if (mode === "online") {
        if (stock.allocated > 0 && stock.on_hand <= stock.allocated) throw new PosError("Out of stock: " + line.product_sid, 409);
        yield ["upsertEntity", entity("pos_stock", line.product_sid,
          { ...stock, on_hand: Math.max(stock.allocated, stock.on_hand - line.quantity, 0), updated_at: now() }, stockRow)];
      } else {
        const key = claims.device_id + ":" + line.product_sid;
        const allocationRow = yield ["getEntity", TENANT, "pos_stock_allocation", key];
        const allocation = dataOf(allocationRow);
        if (!allocation || allocation.issued - allocation.consumed < line.quantity) {
          throw new PosError("Offline allocation exhausted: " + line.product_sid, 409);
        }
        yield ["upsertEntity", entity("pos_stock_allocation", key,
          { ...allocation, consumed: allocation.consumed + line.quantity, updated_at: now() }, allocationRow)];
        yield ["upsertEntity", entity("pos_stock", line.product_sid,
          { ...stock, on_hand: stock.on_hand - line.quantity,
            allocated: stock.allocated - line.quantity, updated_at: now() }, stockRow)];
      }
      yield ["appendJournal", { tenantId: TENANT, entityType: "pos_stock", entityKey: line.product_sid,
        userId: sale.cashier_id, entryType: "pos.stock.sold", data: { sale_key: sale.idempotency_key, quantity: line.quantity, mode } }];
    }
    if (mode === "offline") {
      yield ["upsertEntity", entity("pos_device", claims.device_id,
        { ...dataOf(deviceRow), last_sequence: sale.sequence }, deviceRow)];
    }
    const saved = { sid: sale.idempotency_key, idempotency_key: sale.idempotency_key,
      receipt_id: sale.receipt_id || id("RCP"), store_sid: STORE_ID, register_sid: REGISTER_ID,
      shift_sid: sale.shift_sid || null,
      device_id: sale.device_id || null, sequence: sale.sequence || null, cashier_id: sale.cashier_id,
      lines: calculated.lines, total_minor: calculated.total_minor,
      vat_minor: calculated.lines.reduce((sum, line) => sum + line.vat_minor, 0),
      cash_received_minor: cashReceived, change_minor: cashReceived - calculated.total_minor,
      currency: "VND", tender: "CASH", status: "PAID", origin: mode,
      sold_at: sale.sold_at || now(), synced_at: now() };
    yield ["upsertEntity", entity("pos_sale", sale.idempotency_key, saved, null,
      { userId: sale.cashier_id, currency: "VND" })];
    yield ["appendJournal", { tenantId: TENANT, entityType: "pos_sale", entityKey: sale.idempotency_key,
      userId: sale.cashier_id, entryType: "pos.sale.paid", data: { total_minor: saved.total_minor, mode } }];
    return { ok: true, sale: saved, duplicate: false };
  }

  async function checkout(input, actor) {
    const sale = { ...input, cashier_id: actor.user_id, idempotency_key: requiredText(input.idempotency_key, "Idempotency key") };
    return transact(() => saleScript(sale, "online"));
  }

  async function syncSale(input, actor) {
    const claims = verifyGrant(input.grant, keys);
    if (claims.cashier_id !== actor.user_id || claims.device_id !== input.device_id || claims.store_sid !== STORE_ID) {
      throw new PosError("Offline grant does not match this cashier/device", 403);
    }
    const sale = { ...input.sale, device_id: claims.device_id, cashier_id: claims.cashier_id,
      idempotency_key: requiredText(input.sale?.idempotency_key, "Idempotency key") };
    if (sale.tender && sale.tender !== "CASH") throw new PosError("Offline tender must be cash");
    const soldAt = Date.parse(sale.sold_at);
    if (!Number.isFinite(soldAt) || soldAt < Date.parse(claims.issued_at) || soldAt > Date.parse(claims.expires_at)) {
      throw new PosError("Sale was outside the offline grant window", 409);
    }
    return transact(() => saleScript(sale, "offline", claims));
  }

  async function sales(limit = 100) {
    return (await list("pos_sale")).slice(0, Math.min(nonNegativeInt(limit, "Limit"), 1000)).map(dataOf);
  }

  async function refundSale(input, actor, voided = false) {
    const saleSid = requiredText(input.sale_sid, "Sale SID");
    const returnKey = requiredText(input.idempotency_key, "Idempotency key");
    const reason = requiredText(input.reason, "Return reason");
    return transact(function* () {
      yield ["lockStore"];
      const priorReturn = yield ["getEntity", TENANT, "pos_return", returnKey];
      if (priorReturn) {
        const prior = dataOf(priorReturn);
        const requestedLines = Array.isArray(input.lines) ? input.lines : [];
        const sameLines = voided || (prior.lines.length === requestedLines.length && prior.lines.every((line) =>
          requestedLines.some((requested) => requested.product_sid === line.product_sid &&
            Number(requested.quantity) === line.quantity && Boolean(requested.restock) === line.restock)));
        if (prior.sale_sid !== saleSid || prior.reason !== reason || prior.voided !== voided || !sameLines) {
          throw new PosError("Idempotency key was already used for a different return", 409);
        }
        return { ok: true, return: prior, duplicate: true };
      }
      const saleRow = yield ["getEntity", TENANT, "pos_sale", saleSid];
      const sale = dataOf(saleRow);
      if (!sale || sale.status !== "PAID" || sale.tender !== "CASH") throw new PosError("Paid cash sale not found", 404);
      const previous = sale.returned_quantities || {};
      const requested = voided
        ? sale.lines.map((line) => ({ product_sid: line.product_sid,
          quantity: line.quantity - (previous[line.product_sid] || 0), restock: true })).filter((line) => line.quantity > 0)
        : input.lines;
      if (!Array.isArray(requested) || !requested.length) throw new PosError("Return needs at least one line");
      const seen = new Set();
      const returnLines = [];
      const nextReturned = { ...previous };
      let amount = 0;
      for (const line of requested) {
        const sid = requiredText(line.product_sid, "Product SID");
        if (seen.has(sid)) throw new PosError("Duplicate product in return");
        seen.add(sid);
        const original = sale.lines.find((item) => item.product_sid === sid);
        if (!original) throw new PosError("Product was not in original sale", 409);
        const quantity = positiveInt(line.quantity, "Return quantity");
        const oldQuantity = previous[sid] || 0;
        if (oldQuantity + quantity > original.quantity) throw new PosError("Return exceeds remaining quantity", 409);
        const oldAmount = Math.round(original.total_minor * oldQuantity / original.quantity);
        const newAmount = Math.round(original.total_minor * (oldQuantity + quantity) / original.quantity);
        const lineAmount = newAmount - oldAmount;
        if (line.restock) {
          const stockRow = yield ["getEntity", TENANT, "pos_stock", sid];
          const stock = dataOf(stockRow);
          if (!stock) throw new PosError("Stock not configured: " + sid, 409);
          yield ["upsertEntity", entity("pos_stock", sid,
            { ...stock, on_hand: stock.on_hand + quantity, updated_at: now() }, stockRow)];
          yield ["appendJournal", { tenantId: TENANT, entityType: "pos_stock", entityKey: sid,
            userId: actor.user_id, entryType: "pos.stock.returned", data: { sale_sid: saleSid, return_key: returnKey, quantity } }];
        }
        nextReturned[sid] = oldQuantity + quantity;
        amount += lineAmount;
        returnLines.push({ product_sid: sid, name: original.name, quantity,
          amount_minor: lineAmount, restock: Boolean(line.restock) });
      }
      const complete = sale.lines.every((line) => nextReturned[line.product_sid] === line.quantity);
      if (!Number.isSafeInteger(amount)) throw new PosError("Return total exceeds safe integer range");
      if (voided && !complete) throw new PosError("Void must return every remaining item", 409);
      const returnedAt = now();
      const saved = { sid: returnKey, idempotency_key: returnKey, sale_sid: saleSid,
        store_sid: STORE_ID, register_sid: REGISTER_ID, actor_id: actor.user_id,
        reason, lines: returnLines, amount_minor: amount, tender: "CASH",
        status: "REFUNDED", voided, returned_at: returnedAt };
      yield ["upsertEntity", entity("pos_return", returnKey, saved)];
      yield ["upsertEntity", entity("pos_sale", saleSid,
        { ...sale, returned_quantities: nextReturned,
          refunded_minor: (sale.refunded_minor || 0) + amount,
          refund_status: complete ? voided ? "VOIDED" : "REFUNDED" : "PARTIALLY_REFUNDED",
          updated_at: returnedAt }, saleRow, { userId: sale.cashier_id, currency: "VND" })];
      yield ["appendJournal", { tenantId: TENANT, entityType: "pos_return", entityKey: returnKey,
        userId: actor.user_id, entryType: voided ? "pos.sale.voided" : "pos.sale.refunded",
        data: { sale_sid: saleSid, reason, amount_minor: amount, lines: returnLines } }];
      return { ok: true, return: saved, duplicate: false };
    });
  }

  async function shifts() { return (await list("pos_shift")).map(dataOf).filter(Boolean); }

  async function openShift(input, actor) {
    const openingCash = nonNegativeInt(input.opening_cash_minor, "Opening cash");
    return transact(function* () {
      yield ["lockStore"];
      const registerRow = yield ["getEntity", TENANT, "pos_register", REGISTER_ID];
      const register = dataOf(registerRow);
      if (register.current_shift_sid) throw new PosError("Register already has an open shift", 409);
      const sid = id("SHIFT");
      const shift = { sid, store_sid: STORE_ID, register_sid: REGISTER_ID,
        cashier_id: actor.user_id, status: "OPEN", opening_cash_minor: openingCash,
        opened_at: now() };
      yield ["upsertEntity", entity("pos_shift", sid, shift)];
      yield ["upsertEntity", entity("pos_register", REGISTER_ID,
        { ...register, current_shift_sid: sid }, registerRow)];
      yield ["appendJournal", { tenantId: TENANT, entityType: "pos_shift", entityKey: sid,
        userId: actor.user_id, entryType: "pos.shift.opened", data: { opening_cash_minor: openingCash } }];
      return { ok: true, shift };
    });
  }

  async function closeShift(input, actor) {
    const sid = requiredText(input.shift_sid, "Shift SID");
    const countedCash = nonNegativeInt(input.counted_cash_minor, "Counted cash");
    if (nonNegativeInt(input.pending_count ?? 0, "Pending local sales") !== 0) {
      throw new PosError("Sync pending local sales before closing the shift", 409);
    }
    return transact(function* () {
      yield ["lockStore"];
      const registerRow = yield ["getEntity", TENANT, "pos_register", REGISTER_ID];
      const register = dataOf(registerRow);
      if (register.current_shift_sid !== sid) throw new PosError("Shift is not open on this register", 409);
      const shiftRow = yield ["getEntity", TENANT, "pos_shift", sid];
      const shift = dataOf(shiftRow);
      if (!shift || shift.status !== "OPEN") throw new PosError("Open shift not found", 404);
      if (shift.cashier_id !== actor.user_id) throw new PosError("Only the opening cashier can close this shift", 403);
      const saleRows = yield ["listEntities", { tenantId: TENANT, entityType: "pos_sale", limit: 100000 }];
      const returnRows = yield ["listEntities", { tenantId: TENANT, entityType: "pos_return", limit: 100000 }];
      const salesAmount = saleRows.map(dataOf).filter((sale) => sale?.status === "PAID" &&
        sale.shift_sid === sid).reduce((sum, sale) => sum + sale.total_minor, 0);
      const returnsAmount = returnRows.map(dataOf).filter((item) => item?.returned_at >= shift.opened_at &&
        item.returned_at <= now() && saleRows.some((saleRow) => dataOf(saleRow)?.sid === item.sale_sid &&
          dataOf(saleRow)?.shift_sid === sid)).reduce((sum, item) => sum + item.amount_minor, 0);
      const expected = shift.opening_cash_minor + salesAmount - returnsAmount;
      const closed = { ...shift, status: "CLOSED", closed_at: now(), closed_by: actor.user_id,
        sales_minor: salesAmount, refunds_minor: returnsAmount, expected_cash_minor: expected,
        counted_cash_minor: countedCash, variance_minor: countedCash - expected };
      yield ["upsertEntity", entity("pos_shift", sid, closed, shiftRow)];
      yield ["upsertEntity", entity("pos_register", REGISTER_ID,
        { ...register, current_shift_sid: null }, registerRow)];
      yield ["appendJournal", { tenantId: TENANT, entityType: "pos_shift", entityKey: sid,
        userId: actor.user_id, entryType: "pos.shift.closed", data: {
          sales_minor: salesAmount, refunds_minor: returnsAmount,
          expected_cash_minor: expected, counted_cash_minor: countedCash, variance_minor: countedCash - expected } }];
      return { ok: true, shift: closed };
    });
  }

  async function dashboard() {
    const [saleRows, stockRows, products] = await Promise.all([list("pos_sale"), list("pos_stock"), list(PRODUCT)]);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
    const todays = saleRows.map(dataOf).filter((sale) => sale?.status === "PAID" &&
      new Date(sale.sold_at).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }) === today);
    const refunds = (await list("pos_return")).map(dataOf).filter((item) => item &&
      new Date(item.returned_at).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }) === today);
    const refundMinor = refunds.reduce((sum, item) => sum + item.amount_minor, 0);
    const minimumBySid = new Map(products.map((row) => [row.entity_key, dataOf(row)?.metadata?.pos_min_stock ?? 5]));
    return { ok: true, currency: "VND", sales_count: todays.length,
      gross_minor: todays.reduce((sum, sale) => sum + sale.total_minor, 0),
      refunds_minor: refundMinor,
      net_minor: todays.reduce((sum, sale) => sum + sale.total_minor, 0) - refundMinor,
      low_stock: stockRows.map((row) => dataOf(row)).filter((stock) => stock &&
        stock.on_hand - stock.allocated <= (minimumBySid.get(stock.product_sid) ?? 5)) };
  }

  async function recognizeImage(input, actor) {
    return { ok: true, ...(await recognizeProductWithAI(input.image, await catalog(), actor, options.productVision)) };
  }

  async function recognizeCash(input, actor) {
    return { ok: true, ...(await recognizeCashImage(input.image, actor, options.cashVision)) };
  }

  async function previewImport(input) {
    const rows = input.rows ? parseProductRows(input.rows) : parseCsv(input.csv);
    const validated = validateRows(rows, await catalog());
    return { ok: true, count: rows.length, errors: validated.errors,
      warnings: validated.warnings.slice(0, 100), warning_count: validated.warnings.length,
      preview: validated.rows.slice(0, 20).map(({ current, ...row }) => ({ ...row, action: current ? "UPDATE" : "CREATE" })) };
  }

  async function commitImport(input, actor) {
    const rows = input.rows ? parseProductRows(input.rows) : parseCsv(requiredText(input.csv, "CSV"));
    const source = input.rows ? JSON.stringify(rows) : String(input.csv);
    const importKey = crypto.createHash("sha256").update(source).digest("hex");
    const alreadyImported = await get("pos_import_run", importKey);
    if (alreadyImported) return { ok: true, run: dataOf(alreadyImported), duplicate: true };
    const preview = await previewImport(input.rows ? { rows } : { csv: input.csv });
    if (preview.errors.length) throw new PosError(preview.errors.join("; "));
    const parsed = rows;
    return transact(function* () {
      yield ["lockStore"];
      const prior = yield ["getEntity", TENANT, "pos_import_run", importKey];
      if (prior) return { ok: true, run: dataOf(prior), duplicate: true };
      const all = yield ["listEntities", { tenantId: TENANT, entityType: PRODUCT, limit: 10000 }];
      const stockRows = yield ["listEntities", { tenantId: TENANT, entityType: "pos_stock", limit: 10000 }];
      const stockBySid = new Map(stockRows.map((row) => [row.entity_key, row]));
      const existing = all.map((row) => productView(row, null, stockBySid.get(row.entity_key)));
      const checked = validateRows(parsed, existing);
      if (checked.errors.length) throw new PosError(checked.errors.join("; "), 409);
      const existingBySku = new Map(existing.filter((row) => row.sku).map((row) => [row.sku, row]));
      for (const row of checked.rows) {
        const sid = existingBySku.get(row.sku)?.sid || "P42P_POS_" + crypto.createHash("sha256").update(row.sku).digest("hex").slice(0, 20);
        const current = yield ["getEntity", TENANT, PRODUCT, sid];
        const previous = dataOf(current) || {};
        const product = { ...previous, sid, name: row.name, type: previous.type || "retail",
          image: previous.image || "", status: "ACTIVE", create_sid: previous.create_sid || actor.user_id,
          created_at: previous.created_at || now(), updated_at: now(),
          metadata: { ...(previous.metadata || {}), pos_sku: row.sku,
            pos_barcodes: row.barcodes, pos_vat_rate_bps: row.vat_rate_bps,
            category: row.category, pos_supplier: row.supplier || previous.metadata?.pos_supplier || "",
            pos_unit: row.unit || previous.metadata?.pos_unit || "each",
            pos_family_sku: row.family_sku, pos_group_code: row.group_code,
            pos_cost_minor: row.cost_minor, pos_min_stock: row.min_stock ?? 0,
            pos_source_on_hand: row.source_on_hand,
            pos_stock_import_warning: row.source_on_hand !== null &&
              (!Number.isSafeInteger(row.source_on_hand) || row.source_on_hand < 0) } };
        yield ["upsertEntity", entity(PRODUCT, sid, product, current,
          { title: row.name, category: row.category, scopeModule: "42pay", visibility: "PUBLIC", accessLevel: "PUBLIC_READ" })];
        if (row.price_minor !== null) {
          const priceRow = yield ["getEntity", TENANT, "pos_price", sid];
          yield ["upsertEntity", entity("pos_price", sid,
            { product_sid: sid, store_sid: STORE_ID, price_minor: row.price_minor,
              currency: "VND", updated_by: actor.user_id, updated_at: now() }, priceRow, { currency: "VND" })];
        }
        if (row.opening_stock !== null) {
          if (stockBySid.has(sid)) throw new PosError("Opening stock already exists for " + row.sku, 409);
          yield ["upsertEntity", entity("pos_stock", sid,
            { product_sid: sid, store_sid: STORE_ID, on_hand: row.opening_stock, allocated: 0, updated_at: now() })];
          yield ["appendJournal", { tenantId: TENANT, entityType: "pos_stock", entityKey: sid,
            userId: actor.user_id, entryType: "pos.stock.opened", data: { quantity: row.opening_stock, import_key: importKey } }];
        }
      }
      const run = { sid: importKey, store_sid: STORE_ID, actor_id: actor.user_id,
        count: checked.rows.length, warnings: checked.warnings.length,
        status: "COMPLETED", imported_at: now() };
      yield ["upsertEntity", entity("pos_import_run", importKey, run)];
      return { ok: true, run, duplicate: false };
    });
  }

  async function reportSales(input = {}) {
    const groupBy = String(input.group_by || "day");
    if (!["day", "cashier", "product"].includes(groupBy)) throw new PosError("Invalid report grouping");
    const from = String(input.from || "0000-01-01");
    const to = String(input.to || "9999-12-31");
    const groups = new Map();
    for (const sale of (await list("pos_sale")).map(dataOf).filter(Boolean)) {
      if (sale.status !== "PAID") continue;
      const day = new Date(sale.sold_at).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
      if (day < from || day > to) continue;
      const pieces = groupBy === "product" ? sale.lines : [null];
      for (const line of pieces) {
        const key = groupBy === "day" ? day : groupBy === "cashier" ? sale.cashier_id : line.product_sid;
        const current = groups.get(key) || { key, sales_count: 0, quantity: 0, base_minor: 0, vat_minor: 0, gross_minor: 0 };
        current.sales_count += 1;
        current.quantity += line ? line.quantity : sale.lines.reduce((sum, item) => sum + item.quantity, 0);
        current.base_minor += line ? line.base_minor : sale.total_minor - sale.vat_minor;
        current.vat_minor += line ? line.vat_minor : sale.vat_minor;
        current.gross_minor += line ? line.total_minor : sale.total_minor;
        groups.set(key, current);
      }
    }
    return { ok: true, currency: "VND", group_by: groupBy, from, to,
      items: [...groups.values()].sort((a, b) => String(a.key).localeCompare(String(b.key))) };
  }

  async function exportCsv(type) {
    if (type === "products") return toCsv(["sid", "sku", "name", "barcodes", "category", "supplier", "unit", "image", "status", "price_minor", "cost_minor", "min_stock", "vat_rate_bps", "on_hand", "allocated", "source_on_hand", "stock_import_warning"],
      (await catalog("", true)).map((product) => ({ ...product, barcodes: product.barcodes.join("|") })));
    if (type === "sales") return toCsv(["sid", "receipt_id", "sold_at", "cashier_id", "total_minor", "vat_minor", "refunded_minor", "refund_status", "status", "origin"],
      (await list("pos_sale")).map(dataOf).filter(Boolean));
    if (type === "returns") return toCsv(["sid", "sale_sid", "returned_at", "actor_id", "amount_minor", "reason", "voided"],
      (await list("pos_return")).map(dataOf).filter(Boolean));
    if (type === "shifts") return toCsv(["sid", "cashier_id", "opened_at", "closed_at", "opening_cash_minor", "sales_minor", "refunds_minor", "expected_cash_minor", "counted_cash_minor", "variance_minor", "status"],
      (await list("pos_shift")).map(dataOf).filter(Boolean));
    throw new PosError("Unknown export type", 404);
  }

  return { init, catalog, get, upsertProduct, setProductImage, setPrice, adjustStock, pairDevice,
    allocateStock, createStockCount, submitStockCount, postStockCount, stockCounts,
    bootstrap, checkout, syncSale, sales, refundSale, shifts, openShift, closeShift, dashboard, recognizeImage, recognizeCash,
    previewImport, commitImport, reportSales, exportCsv,
    verifyGrant: (token) => verifyGrant(token, keys) };
}

module.exports = { createPosService, PosError, TENANT, STORE_ID, REGISTER_ID, calculateLines };
