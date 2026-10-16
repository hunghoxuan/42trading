"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createUniversalStoreAdapter } = require("../../shared/universal-store/adapterFactory");
const { recognizeProductImage } = require("./vision");
const { parseCsv, validateRows, toCsv } = require("./imports");

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
    unit: metadata.pos_unit || "each",
    image: product.image || "",
    status: product.status || "ACTIVE",
    price_minor: price.price_minor ?? null,
    vat_rate_bps: metadata.pos_vat_rate_bps ?? 0,
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
  async function catalog(deviceId = "") {
    const [products, prices, stocks, allocations] = await Promise.all([
      list(PRODUCT), list("pos_price"), list("pos_stock"), deviceId ? list("pos_stock_allocation") : [],
    ]);
    const byKey = (rows) => new Map(rows.map((row) => [row.entity_key, row]));
    const priceByKey = byKey(prices);
    const stockByKey = byKey(stocks);
    const allocationByKey = byKey(allocations);
    return products.map((row) => productView(row, priceByKey.get(row.entity_key),
      stockByKey.get(row.entity_key), allocationByKey.get(deviceId + ":" + row.entity_key)))
      .filter((product) => product.status === "ACTIVE");
  }

  async function upsertProduct(input, actor) {
    const sid = String(input.sid || id("P42P")).trim();
    const name = requiredText(input.name, "Product name");
    const sku = requiredText(input.sku, "Product number");
    const barcodes = [...new Set((Array.isArray(input.barcodes) ? input.barcodes : [])
      .map((value) => String(value).trim()).filter(Boolean))];
    const vatRate = nonNegativeInt(input.vat_rate_bps ?? 0, "VAT rate");
    if (vatRate > 10000) throw new PosError("VAT rate exceeds 100%");
    await transact(function* () {
      yield ["lockStore"];
      const products = yield ["listEntities", { tenantId: TENANT, entityType: PRODUCT, limit: 10000 }];
      for (const row of products) {
        if (row.entity_key === sid) continue;
        const other = dataOf(row)?.metadata || {};
        if (other.pos_sku === sku || barcodes.some((code) => (other.pos_barcodes || []).includes(code))) {
          throw new PosError("Product number or barcode already exists");
        }
      }
      const current = yield ["getEntity", TENANT, PRODUCT, sid];
      const previous = dataOf(current) || {};
      const product = {
        ...previous, sid, name, image: String(input.image || previous.image || ""),
        type: String(input.type || previous.type || "retail"),
        status: input.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
        create_sid: previous.create_sid || actor.user_id,
        created_at: previous.created_at || now(), updated_at: now(),
        metadata: {
          ...(previous.metadata || {}), pos_sku: sku, pos_barcodes: barcodes,
          pos_unit: String(input.unit || "each"), pos_vat_rate_bps: vatRate,
          category: String(input.category || ""),
          description: String(input.description || ""),
        },
      };
      yield ["upsertEntity", entity(PRODUCT, sid, product, current, {
        title: name, category: product.metadata.category, scopeModule: "42pay",
        visibility: "PUBLIC", accessLevel: "PUBLIC_READ",
      })];
    });
    return { ok: true, product: (await catalog()).find((row) => row.sid === sid) };
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
        if (stock.on_hand - stock.allocated < line.quantity) throw new PosError("Out of stock: " + line.product_sid, 409);
        yield ["upsertEntity", entity("pos_stock", line.product_sid,
          { ...stock, on_hand: stock.on_hand - line.quantity, updated_at: now() }, stockRow)];
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

  async function dashboard() {
    const [saleRows, stockRows] = await Promise.all([list("pos_sale"), list("pos_stock")]);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
    const todays = saleRows.map(dataOf).filter((sale) => sale?.status === "PAID" &&
      new Date(sale.sold_at).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }) === today);
    return { ok: true, currency: "VND", sales_count: todays.length,
      gross_minor: todays.reduce((sum, sale) => sum + sale.total_minor, 0),
      low_stock: stockRows.map(dataOf).filter((stock) => stock && stock.on_hand - stock.allocated <= 5) };
  }

  async function recognizeImage(input) {
    return { ok: true, ...(await recognizeProductImage(input.image, await catalog(), options.textExtractor)) };
  }

  async function previewImport(input) {
    const rows = parseCsv(input.csv);
    const validated = validateRows(rows, await catalog());
    return { ok: true, count: rows.length, errors: validated.errors,
      preview: validated.rows.slice(0, 20).map(({ current, ...row }) => ({ ...row, action: current ? "UPDATE" : "CREATE" })) };
  }

  async function commitImport(input, actor) {
    const csv = requiredText(input.csv, "CSV");
    const importKey = crypto.createHash("sha256").update(csv).digest("hex");
    const alreadyImported = await get("pos_import_run", importKey);
    if (alreadyImported) return { ok: true, run: dataOf(alreadyImported), duplicate: true };
    const preview = await previewImport({ csv });
    if (preview.errors.length) throw new PosError(preview.errors.join("; "));
    const parsed = parseCsv(csv);
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
            category: row.category, pos_unit: previous.metadata?.pos_unit || "each" } };
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
        count: checked.rows.length, status: "COMPLETED", imported_at: now() };
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
    if (type === "products") return toCsv(["sid", "sku", "name", "barcodes", "category", "price_minor", "vat_rate_bps", "on_hand", "allocated"],
      (await catalog()).map((product) => ({ ...product, barcodes: product.barcodes.join("|") })));
    if (type === "sales") return toCsv(["sid", "receipt_id", "sold_at", "cashier_id", "total_minor", "vat_minor", "status", "origin"],
      (await list("pos_sale")).map(dataOf).filter(Boolean));
    throw new PosError("Unknown export type", 404);
  }

  return { init, catalog, get, upsertProduct, setPrice, adjustStock, pairDevice,
    allocateStock, bootstrap, checkout, syncSale, sales, dashboard, recognizeImage,
    previewImport, commitImport, reportSales, exportCsv,
    verifyGrant: (token) => verifyGrant(token, keys) };
}

module.exports = { createPosService, PosError, TENANT, STORE_ID, REGISTER_ID, calculateLines };
