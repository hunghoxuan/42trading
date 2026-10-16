export type Product = {
  sid: string;
  name: string;
  sku: string;
  barcodes: string[];
  category: string;
  unit: string;
  family_sku: string;
  group_code: string;
  image: string;
  status: string;
  price_minor: number | null;
  vat_rate_bps: number;
  cost_minor: number | null;
  min_stock: number;
  source_on_hand: number | null;
  stock_import_warning: boolean;
  on_hand: number;
  allocated: number;
  offline_available: number;
};

export type Snapshot = {
  sid: string;
  store_sid: string;
  device_id: string;
  products: Product[];
  currency: string;
  tax_rate_bps: number;
  issued_at: string;
  expires_at: string;
};

export type Bootstrap = { snapshot: Snapshot; grant: string; public_key: string };

export type SaleLine = { product_sid: string; quantity: number };

export type LocalSale = {
  idempotency_key: string;
  cashier_id: string;
  receipt_id: string;
  device_id: string;
  sequence: number;
  sold_at: string;
  lines: SaleLine[];
  receipt_lines: { product_sid: string; name: string; quantity: number; price_minor: number; vat_minor: number; total_minor: number }[];
  total_minor: number;
  vat_minor: number;
  cash_received_minor: number;
  tender: "CASH";
  grant: string;
  sync_state: "PENDING_SYNC" | "SYNCED" | "NEEDS_ATTENTION";
  sync_error?: string;
};

const DB_NAME = "42trade-pos-v1";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("Local transaction aborted"));
    tx.onerror = () => reject(tx.error || new Error("Local transaction failed"));
  });
}

export function openPosDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("sales")) db.createObjectStore("sales", { keyPath: "idempotency_key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Close other POS tabs before upgrading local storage"));
  });
}

export async function readBootstrap(): Promise<Bootstrap | null> {
  const db = await openPosDb();
  const tx = db.transaction("meta", "readonly");
  const value = await request(tx.objectStore("meta").get("bootstrap"));
  await completed(tx);
  db.close();
  return (value as Bootstrap) || null;
}

export async function listLocalSales(): Promise<LocalSale[]> {
  const db = await openPosDb();
  const tx = db.transaction("sales", "readonly");
  const rows = await request(tx.objectStore("sales").getAll());
  await completed(tx);
  db.close();
  return (rows as LocalSale[]).sort((a, b) => a.device_id === b.device_id
    ? a.sequence - b.sequence : a.sold_at.localeCompare(b.sold_at));
}

export async function saveBootstrap(value: Bootstrap): Promise<void> {
  const pending = (await listLocalSales()).some((sale) => sale.sync_state !== "SYNCED");
  if (pending) throw new Error("Sync or reconcile pending sales before refreshing the offline catalog");
  const db = await openPosDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(value, "bootstrap");
  await completed(tx);
  db.close();
}

function pemBytes(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    (char) => char.charCodeAt(0));
}

export async function validateBootstrap(value: Bootstrap): Promise<void> {
  if (Date.now() >= Date.parse(value.snapshot.expires_at)) throw new Error("Offline authorization expired. Reconnect and refresh this register.");
  const [body, signature] = value.grant.split(".");
  if (!body || !signature) throw new Error("Offline authorization is invalid");
  const claims = JSON.parse(new TextDecoder().decode(base64UrlBytes(body)));
  if (claims.device_id !== value.snapshot.device_id || claims.snapshot_id !== value.snapshot.sid ||
      claims.expires_at !== value.snapshot.expires_at) throw new Error("Offline authorization does not match the catalog");
  const key = await crypto.subtle.importKey("spki", pemBytes(value.public_key),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
    base64UrlBytes(signature), new TextEncoder().encode(body));
  if (!valid) throw new Error("Offline authorization signature is invalid");
}

export async function requestDurableStorage(): Promise<boolean> {
  if (import.meta.env.VITE_POS_DEMO === "1") return true;
  if (!navigator.storage?.persist || !navigator.storage?.persisted) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function commitLocalSale(lines: SaleLine[], cashReceived: number): Promise<LocalSale> {
  const bootstrap = await readBootstrap();
  if (!bootstrap) throw new Error("Connect and provision this register before offline sales");
  await validateBootstrap(bootstrap);
  if (!await requestDurableStorage()) throw new Error("Persistent storage is unavailable; offline checkout is blocked to protect unsynced sales");
  const db = await openPosDb();
  const tx = db.transaction(["meta", "sales"], "readwrite");
  try {
    const meta = tx.objectStore("meta");
    const current = await request(meta.get("bootstrap")) as Bootstrap;
    const sequence = Number(await request(meta.get("sequence")) || 0) + 1;
    if (current.snapshot.sid !== bootstrap.snapshot.sid) throw new Error("Offline catalog changed during checkout");
    const quantities = new Map<string, number>();
    for (const line of lines) {
      if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("Invalid quantity");
      quantities.set(line.product_sid, (quantities.get(line.product_sid) || 0) + line.quantity);
    }
    if (!quantities.size) throw new Error("Cart is empty");
    let total = 0;
    let vatTotal = 0;
    const receiptLines: LocalSale["receipt_lines"] = [];
    const nextProducts = current.snapshot.products.map((product) => {
      const quantity = quantities.get(product.sid) || 0;
      if (!quantity) return product;
      if (product.offline_available < quantity) throw new Error("Offline allocation exhausted for " + product.name);
      if (!Number.isSafeInteger(product.price_minor)) throw new Error("Price unavailable for " + product.name);
      const base = (product.price_minor as number) * quantity;
      const vat = Math.round(base * product.vat_rate_bps / 10000);
      total += base + vat;
      vatTotal += vat;
      receiptLines.push({ product_sid: product.sid, name: product.name, quantity,
        price_minor: product.price_minor as number, vat_minor: vat, total_minor: base + vat });
      return { ...product, offline_available: product.offline_available - quantity };
    });
    for (const sid of quantities.keys()) {
      if (!current.snapshot.products.some((product) => product.sid === sid)) throw new Error("Product not in offline catalog: " + sid);
    }
    if (!Number.isSafeInteger(total) || cashReceived < total || !Number.isSafeInteger(cashReceived)) throw new Error("Invalid cash received or total");
    const sale: LocalSale = {
      idempotency_key: crypto.randomUUID(),
      cashier_id: JSON.parse(new TextDecoder().decode(base64UrlBytes(current.grant.split(".")[0]))).cashier_id,
      receipt_id: ["STORE_1", "REG_1", current.snapshot.device_id, sequence].join("-"),
      device_id: current.snapshot.device_id,
      sequence,
      sold_at: new Date().toISOString(),
      lines: [...quantities].map(([product_sid, quantity]) => ({ product_sid, quantity })),
      receipt_lines: receiptLines,
      total_minor: total,
      vat_minor: vatTotal,
      cash_received_minor: cashReceived,
      tender: "CASH",
      grant: current.grant,
      sync_state: "PENDING_SYNC",
    };
    meta.put({ ...current, snapshot: { ...current.snapshot, products: nextProducts } }, "bootstrap");
    meta.put(sequence, "sequence");
    tx.objectStore("sales").add(sale);
    await completed(tx);
    db.close();
    return sale;
  } catch (error) {
    try { tx.abort(); } catch { /* The browser may have already aborted this transaction. */ }
    db.close();
    throw error;
  }
}

export async function updateSaleState(key: string, state: LocalSale["sync_state"], error = ""): Promise<void> {
  const db = await openPosDb();
  const tx = db.transaction("sales", "readwrite");
  const store = tx.objectStore("sales");
  const sale = await request(store.get(key)) as LocalSale | undefined;
  if (sale) store.put({ ...sale, sync_state: state, sync_error: error });
  await completed(tx);
  db.close();
}
