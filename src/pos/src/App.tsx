import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { useRegisterSW } from "virtual:pwa-register/react";
import { ApiError, posApi } from "./api";
import Receipt, { fromLocalSale, fromServerSale } from "./Receipt";
import {
  commitLocalSale, listLocalSales, readBootstrap, requestDurableStorage,
  saveBootstrap, updateSaleState, validateBootstrap,
  type Bootstrap, type LocalSale, type Product, type SaleLine,
} from "./storage";

const money = (value: number) => new Intl.NumberFormat("vi-VN", {
  style: "currency", currency: "VND", maximumFractionDigits: 0,
}).format(value);
const todayInVietnam = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

function deviceId(): string {
  const key = "42trade-pos-device-id";
  let value = localStorage.getItem(key);
  if (!value) {
    value = "posdev_" + crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem(key, value);
  }
  return value;
}

function Scanner({ onCode, onClose }: { onCode: (value: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let controls: IScannerControls | undefined;
    const reader = new BrowserMultiFormatReader();
    if (video.current) {
      reader.decodeFromVideoDevice(undefined, video.current, (result) => {
        if (result && !cancelled) onCode(result.getText());
      }).then((value) => { controls = value; if (cancelled) controls.stop(); })
        .catch((cause) => setError(cause instanceof Error ? cause.message : "Camera unavailable"));
    }
    return () => { cancelled = true; controls?.stop(); };
  }, [onCode]);
  return <div className="pos-scanner" role="dialog" aria-label="Scan product code">
    <div className="pos-scanner-card">
      <div className="pos-row"><h2>Scan code</h2><button onClick={onClose}>Close</button></div>
      <video ref={video} muted playsInline aria-label="Camera preview" />
      <p className="pos-muted">Point the camera at a QR code or barcode.</p>
      {error && <p className="pos-error">{error}. Type the product number in the search box instead.</p>}
    </div>
  </div>;
}

type Tab = "sale" | "inventory" | "reports" | "register";

export default function App() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const [tab, setTab] = useState<Tab>("sale");
  const [online, setOnline] = useState(navigator.onLine);
  const [actor, setActor] = useState<{ user_id: string; name?: string } | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<LocalSale[]>([]);
  const [serverSales, setServerSales] = useState<Record<string, unknown>[]>([]);
  const [dashboard, setDashboard] = useState<{ gross_minor: number; net_minor: number; refunds_minor: number; sales_count: number; low_stock: unknown[] } | null>(null);
  const [shifts, setShifts] = useState<Record<string, unknown>[]>([]);
  const [openingCash, setOpeningCash] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [selectedSale, setSelectedSale] = useState<Record<string, unknown> | null>(null);
  const [returnLines, setReturnLines] = useState<Record<string, { quantity: string; restock: boolean }>>({});
  const [returnReason, setReturnReason] = useState("");
  const [importCsv, setImportCsv] = useState("");
  const [importPreview, setImportPreview] = useState<{ count: number; errors: string[]; preview: Record<string, unknown>[] } | null>(null);
  const [reportGroup, setReportGroup] = useState("day");
  const [reportFrom, setReportFrom] = useState(todayInVietnam());
  const [reportTo, setReportTo] = useState(todayInVietnam());
  const [reportRows, setReportRows] = useState<{ key: string; sales_count: number; quantity: number; base_minor: number; vat_minor: number; gross_minor: number }[]>([]);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<SaleLine[]>([]);
  const [cash, setCash] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [form, setForm] = useState({ sid: "", name: "", sku: "", barcodes: "", category: "", price: "", vat: "0", image: "" });
  const [stockDelta, setStockDelta] = useState("");
  const [stockReason, setStockReason] = useState("");
  const [stockCount, setStockCount] = useState<Record<string, unknown> | null>(null);
  const [stockCountRows, setStockCountRows] = useState<Record<string, unknown>[]>([]);
  const [stockCountValues, setStockCountValues] = useState<Record<string, string>>({});
  const [stockCountReason, setStockCountReason] = useState("");
  const [allocation, setAllocation] = useState("");
  const [scanner, setScanner] = useState(false);
  const [receipt, setReceipt] = useState<ReturnType<typeof fromServerSale> | null>(null);
  const [candidates, setCandidates] = useState<{ product_sid: string; name: string; retail_price_minor: number | null; score: number; explanation: string }[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const onlineCheckoutKey = useRef<string | null>(null);
  const returnKey = useRef<string | null>(null);
  const syncPromise = useRef<Promise<void> | null>(null);
  const device = useMemo(deviceId, []);

  const localProducts = bootstrap?.snapshot.products || [];
  const visibleProducts = tab === "sale" && bootstrap ? localProducts : online && products.length ? products : localProducts;
  const filtered = visibleProducts.filter((product) => {
    const text = query.trim().toLowerCase();
    return !text || [product.name, product.sku, product.sid, product.category, ...product.barcodes]
      .some((part) => String(part || "").toLowerCase().includes(text));
  });
  const cartRows = cart.map((line) => ({ ...line, product: visibleProducts.find((p) => p.sid === line.product_sid) }));
  const subtotal = cartRows.reduce((sum, row) => sum + (row.product?.price_minor || 0) * row.quantity, 0);
  const vat = cartRows.reduce((sum, row) => {
    const base = (row.product?.price_minor || 0) * row.quantity;
    return sum + Math.round(base * (row.product?.vat_rate_bps || 0) / 10000);
  }, 0);
  const total = subtotal + vat;
  const pending = sales.filter((sale) => sale.sync_state === "PENDING_SYNC");
  const attention = sales.filter((sale) => sale.sync_state === "NEEDS_ATTENTION");
  const pendingKey = pending.map((sale) => sale.idempotency_key).join(",");
  const openShift = shifts.find((shift) => shift.status === "OPEN");

  const refreshLocal = useCallback(async () => {
    const [saved, rows] = await Promise.all([readBootstrap(), listLocalSales()]);
    setBootstrap(saved);
    setSales(rows);
  }, []);

  const refreshOnline = useCallback(async () => {
    const [user, catalog, summary, recent, shiftList, countList] = await Promise.all([
      posApi.auth(), posApi.products(device), posApi.dashboard(), posApi.sales(), posApi.shifts(), posApi.stockCounts(),
    ]);
    setActor(user.user);
    setProducts(catalog.items);
    setDashboard(summary);
    setServerSales(recent.items as Record<string, unknown>[]);
    setShifts(shiftList.items);
    setStockCountRows(countList.items);
  }, [device]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    refreshLocal().catch((cause) => setError(String(cause)));
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, [refreshLocal]);

  useEffect(() => {
    if (online) refreshOnline().catch((cause) => setError(String(cause)));
  }, [online, refreshOnline]);

  useEffect(() => {
    if (online && pendingKey) syncPending().catch((cause) => setError(String(cause)));
  }, [online, pendingKey]);

  useEffect(() => {
    if (online && tab === "reports") posApi.reportSales(reportGroup, reportFrom, reportTo).then((result) => setReportRows(result.items))
      .catch((cause) => setError(String(cause)));
  }, [online, tab, reportGroup, reportFrom, reportTo]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); if (success) setMessage(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  function syncPending(): Promise<void> {
    if (!syncPromise.current) {
      syncPromise.current = (async () => {
        for (const sale of await listLocalSales()) {
          if (sale.sync_state !== "PENDING_SYNC") continue;
          try {
            await posApi.syncSale(sale);
            await updateSaleState(sale.idempotency_key, "SYNCED");
            setReceipt((current) => current?.receipt_id === sale.receipt_id
              ? fromLocalSale({ ...sale, sync_state: "SYNCED" }) : current);
          } catch (cause) {
            if (!(cause instanceof ApiError) || cause.status >= 500 || cause.status === 401) break;
            await updateSaleState(sale.idempotency_key, "NEEDS_ATTENTION", cause.message);
            break;
          }
        }
        await refreshLocal();
        if (navigator.onLine) await refreshOnline();
      })().finally(() => { syncPromise.current = null; });
    }
    return syncPromise.current;
  }

  async function provision() {
    await syncPending();
    await posApi.pair(device);
    const next = await posApi.bootstrap(device);
    await validateBootstrap(next);
    await saveBootstrap(next);
    await requestDurableStorage();
    await refreshLocal();
    await refreshOnline();
  }

  function addToCart(product: Product) {
    setCart((rows) => {
      const current = rows.find((row) => row.product_sid === product.sid);
      return current ? rows.map((row) => row.product_sid === product.sid ? { ...row, quantity: row.quantity + 1 } : row)
        : [...rows, { product_sid: product.sid, quantity: 1 }];
    });
  }

  async function checkout() {
    if (!cart.length) throw new Error("Cart is empty");
    const received = Number(cash);
    if (!Number.isSafeInteger(received) || received < total) throw new Error("Enter enough cash received");
    if (bootstrap) {
      const sale = await commitLocalSale(cart, received);
      setReceipt(fromLocalSale(sale));
      setCart([]); setCash("");
      await refreshLocal();
      setMessage("Cash sale saved locally. Receipt " + sale.receipt_id + " is pending sync.");
    } else if (online) {
      onlineCheckoutKey.current ||= crypto.randomUUID();
      const result = await posApi.checkout(onlineCheckoutKey.current, cart, received);
      const paid = result.sale as { receipt_id: string };
      setReceipt(fromServerSale(result.sale as Record<string, unknown>));
      setMessage("Sale paid. Receipt " + paid.receipt_id);
      setCart([]); setCash(""); onlineCheckoutKey.current = null;
      await refreshOnline();
    } else throw new Error("Provision this register online before offline sales");
  }

  function selectProduct(product: Product) {
    setSelected(product);
    setForm({ sid: product.sid, name: product.name, sku: product.sku,
      barcodes: product.barcodes.join(", "), category: product.category,
      price: String(product.price_minor ?? ""), vat: String(product.vat_rate_bps / 100), image: product.image });
    setAllocation(String(product.offline_available));
  }

  async function saveProduct() {
    const result = await posApi.saveProduct({ ...form, vat_rate_bps: Math.round(Number(form.vat) * 100),
      barcodes: form.barcodes.split(",").map((v) => v.trim()).filter(Boolean) });
    if (form.price) await posApi.setPrice(result.product.sid, Number(form.price));
    await refreshOnline();
    setSelected(null);
  }

  function selectSaleForReturn(sale: Record<string, unknown>) {
    setSelectedSale(sale);
    setReturnLines(Object.fromEntries(((sale.lines || []) as { product_sid: string }[])
      .map((line) => [line.product_sid, { quantity: "0", restock: true }])));
    setReturnReason("");
    returnKey.current = null;
  }

  async function submitReturn() {
    if (!selectedSale) throw new Error("Select a sale");
    const lines = Object.entries(returnLines).filter(([, value]) => Number(value.quantity) > 0)
      .map(([product_sid, value]) => ({ product_sid, quantity: Number(value.quantity), restock: value.restock }));
    if (!lines.length) throw new Error("Enter a return quantity");
    returnKey.current ||= crypto.randomUUID();
    await posApi.refundSale(String(selectedSale.sid), returnReason, lines, returnKey.current);
    returnKey.current = null;
    setSelectedSale(null);
    await refreshOnline();
  }

  async function voidSelectedSale(sale: Record<string, unknown>) {
    const reason = prompt("Reason for voiding this cash sale");
    if (!reason?.trim()) return;
    await posApi.voidSale(String(sale.sid), reason.trim(), crypto.randomUUID());
    await refreshOnline();
  }

  async function startStockCount() {
    const result = await posApi.createStockCount();
    setStockCount(result.count);
    const lines = result.count.lines as { product_sid: string; expected_on_hand: number }[];
    setStockCountValues(Object.fromEntries(lines.map((line) => [line.product_sid, String(line.expected_on_hand)])));
    setStockCountReason("");
  }

  function resumeStockCount(count: Record<string, unknown>) {
    setStockCount(count);
    const lines = count.lines as { product_sid: string; counted_on_hand: number | null }[];
    setStockCountValues(Object.fromEntries(lines.map((line) => [line.product_sid,
      line.counted_on_hand === null ? "" : String(line.counted_on_hand)])));
    setStockCountReason(String(count.posting_reason || ""));
  }

  async function submitCountForReview() {
    if (!stockCount) throw new Error("Start a stock count first");
    const lines = (stockCount.lines as { product_sid: string }[]).map((line) => {
      const value = stockCountValues[line.product_sid];
      if (value === undefined || value === "") throw new Error("Enter a counted quantity for every product");
      return { product_sid: line.product_sid, counted_on_hand: Number(value) };
    });
    const result = await posApi.submitStockCount(String(stockCount.sid), lines);
    setStockCount(result.count);
    await refreshOnline();
  }

  async function postCount() {
    if (!stockCount) throw new Error("Select a stock count");
    await posApi.postStockCount(String(stockCount.sid), stockCountReason);
    setStockCount(null);
    setStockCountValues({});
    setStockCountReason("");
    await refreshOnline();
  }

  const scanned = useCallback((code: string) => {
    setScanner(false);
    setQuery(code);
    const product = visibleProducts.find((item) => item.sku === code || item.sid === code || item.barcodes.includes(code));
    if (product && tab === "inventory") {
      selectProduct(product);
      setMessage("Opened " + product.name);
    } else if (product) {
      addToCart(product);
      setMessage("Added " + product.name);
    } else if (tab === "inventory") {
      setSelected(null);
      setForm({ sid: "", name: "", sku: code, barcodes: code ? code : "", category: "", price: "", vat: "0", image: "" });
      setMessage("No match. Review the scanned code and create a product.");
    } else setMessage("No match for " + code + ". Use Inventory to create a product.");
  }, [visibleProducts, tab]);

  async function recognizeFile(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 4 * 1024 * 1024) {
      throw new Error("Choose a PNG, JPEG, or WebP under 4 MB");
    }
    const image = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    try {
      const decoded = await new BrowserMultiFormatReader().decodeFromImageUrl(image);
      const code = decoded.getText();
      const product = visibleProducts.find((item) => item.sid === code || item.sku === code || item.barcodes.includes(code));
      if (product) {
        setCandidates([{ product_sid: product.sid, name: product.name,
          retail_price_minor: product.price_minor, score: 1, explanation: "Barcode or QR code in image" }]);
        return;
      }
    } catch { /* A product photo may have no machine-readable code. */ }
    if (!online) throw new Error("No known barcode found. Product-photo recognition needs an internet connection.");
    const result = await posApi.recognizeImage(image);
    const available = result.candidates.filter((candidate) => visibleProducts.some((item) => item.sid === candidate.product_sid));
    setCandidates(available);
    if (!available.length) setMessage("No match in this register's approved catalog. Refresh it or try a product number.");
  }

  return <div className="pos-app">
    <header className="pos-header">
      <div><strong>42Trade POS</strong><span className="pos-muted"> · Main store · VND{import.meta.env.VITE_POS_DEMO === "1" ? " · DEMO" : ""}</span></div>
      <div className="pos-row">
        <span className={online ? "pos-online" : "pos-offline"}>{online ? "Online" : "Offline"}</span>
        <span>{pending.length} pending</span>
        {attention.length > 0 && <span className="pos-error">{attention.length} needs attention</span>}
      </div>
    </header>
    <nav className="pos-tabs" aria-label="POS sections">
      {(["sale", "inventory", "reports", "register"] as Tab[]).map((item) =>
        <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
    </nav>
    {error && <div className="pos-alert pos-error" role="alert">{error}
      {error.includes("AUTH_REQUIRED") && <> · <a href="/login?next=/pos/">Sign in to 42Trade</a></>}
    </div>}
    {needRefresh && <div className="pos-alert pos-row" role="status"><span>A POS update is ready. Finish the current cart before reloading.</span>
      <button disabled={cart.length > 0 || busy} onClick={() => updateServiceWorker(true)}>Update POS</button></div>}
    {message && <div className="pos-alert pos-success" role="status">{message}</div>}

    {tab === "sale" && <main className="pos-checkout">
      <section className="pos-panel">
        <div className="pos-row"><h1>Products</h1><div className="pos-row"><button onClick={() => setScanner(true)}>Scan code</button>
          <label className="pos-upload">Recognize photo<input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={(event) => {
            const file = event.target.files?.[0]; if (file) run(() => recognizeFile(file), ""); event.target.value = "";
          }} /></label></div></div>
        {bootstrap && <p className="pos-muted">Approved register prices from {new Date(bootstrap.snapshot.issued_at).toLocaleString("vi-VN")}. Refresh the register after price changes.</p>}
        <input className="pos-search" placeholder="Scan or enter product number, barcode, name" value={query}
          onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && query.trim()) { event.preventDefault(); scanned(query.trim()); }
          }} autoFocus />
        {candidates.length > 0 && <div className="pos-candidates"><strong>Possible matches — confirm product</strong>
          {candidates.map((candidate) => <button key={candidate.product_sid} onClick={() => {
            const product = visibleProducts.find((item) => item.sid === candidate.product_sid);
            if (product) addToCart(product); setCandidates([]);
          }}>{candidate.name} · {money(visibleProducts.find((item) => item.sid === candidate.product_sid)?.price_minor || 0)}
            <small>{candidate.explanation}{bootstrap ? " · approved register price" : " · current inventory price"}</small></button>)}
        </div>}
        <div className="pos-products">
          {filtered.map((product) => <button className="pos-product" key={product.sid}
            disabled={product.price_minor === null || (bootstrap ? product.offline_available <= 0 : product.on_hand - product.allocated <= 0)}
            onClick={() => addToCart(product)}>
            <span><strong>{product.name}</strong><small>{product.sku || product.sid} · {product.category}</small></span>
            <span>{product.price_minor === null ? "Price needed" : money(product.price_minor)}<small>{online ? "Stock " + product.on_hand : "Offline " + product.offline_available}</small></span>
          </button>)}
          {!filtered.length && <p className="pos-muted">No matching products. Create one in Inventory.</p>}
        </div>
      </section>
      <section className="pos-panel pos-cart">
        <h1>Cart</h1>
        {cartRows.map((row) => <div className="pos-cart-line" key={row.product_sid}>
          <div><strong>{row.product?.name || row.product_sid}</strong><small>{money(row.product?.price_minor || 0)} each</small></div>
          <div className="pos-row"><button aria-label="Decrease quantity" onClick={() => setCart((items) => items.map((item) =>
            item.product_sid === row.product_sid ? { ...item, quantity: Math.max(0, item.quantity - 1) } : item).filter((item) => item.quantity))}>−</button>
            <span>{row.quantity}</span><button aria-label="Increase quantity" onClick={() => addToCart(row.product!)}>+</button></div>
        </div>)}
        {!cartRows.length && <p className="pos-muted">Scan or select a product to start a sale.</p>}
        <div className="pos-cart-bottom">
          <div className="pos-row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
          <div className="pos-row"><span>VAT</span><span>{money(vat)}</span></div>
          <div className="pos-total"><span>Total</span><strong>{money(total)}</strong></div>
          <label>Cash received<input type="number" min="0" step="1" value={cash} onChange={(event) => setCash(event.target.value)} /></label>
          <p>Change: {money(Math.max(0, Number(cash || 0) - total))}</p>
          <button className="pos-primary" disabled={busy || !cart.length} onClick={() => run(checkout, "")}>Complete cash sale</button>
          <small className="pos-muted">Offline sales are saved on this device until synced.</small>
        </div>
      </section>
    </main>}

    {tab === "inventory" && <main className="pos-grid">
      <section className="pos-panel"><div className="pos-row"><h1>Inventory</h1><div className="pos-row"><button onClick={() => setScanner(true)}>Scan code</button><button disabled={!online || busy} onClick={() => run(startStockCount, "Stock count started")}>Start stock count</button><button onClick={() => { setSelected(null); setForm({ sid: "", name: "", sku: "", barcodes: "", category: "", price: "", vat: "0", image: "" }); }}>New product</button></div></div>
        <input placeholder="Search products or scan a product number" value={query} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && query.trim()) { event.preventDefault(); scanned(query.trim()); } }} />
        <div className="pos-products">{filtered.map((product) => <button key={product.sid} className="pos-product" onClick={() => selectProduct(product)}>
          <span><strong>{product.name}</strong><small>{product.sku || product.sid}</small></span>
          <span>{money(product.price_minor || 0)}<small>On hand {product.on_hand} · Reserved {product.allocated}</small></span>
        </button>)}</div>
        {!!stockCountRows.length && <div className="pos-count-history"><h2>Stock counts</h2>{stockCountRows.slice(0, 10).map((count) => <button key={String(count.sid)} disabled={!online || busy || count.status === "POSTED"}
          onClick={() => resumeStockCount(count)}>{String(count.status)} · {new Date(String(count.created_at)).toLocaleString()} · {((count.lines || []) as unknown[]).length} products</button>)}</div>}
        {stockCount && <div className="pos-count-form"><div className="pos-row"><h2>Stock count · {String(stockCount.status)}</h2>
          <button onClick={() => { setStockCount(null); setStockCountValues({}); }}>Close count</button></div>
          {(stockCount.lines as { product_sid: string; name: string; expected_on_hand: number; counted_on_hand: number | null; variance?: number }[]).map((line) => <label className="pos-count-line" key={line.product_sid}>
            <span>{line.name}<small>System count {line.expected_on_hand}{line.variance !== undefined ? " · variance " + line.variance : ""}</small></span>
            {stockCount.status === "DRAFT" ? <input aria-label={"Count " + line.name} type="number" min="0" step="1" value={stockCountValues[line.product_sid] ?? ""}
              onChange={(event) => setStockCountValues({ ...stockCountValues, [line.product_sid]: event.target.value })} /> : <strong>{line.counted_on_hand}</strong>}
          </label>)}
          {stockCount.status === "DRAFT" && <button className="pos-primary" disabled={busy} onClick={() => run(submitCountForReview, "Count ready for review")}>Review count</button>}
          {stockCount.status === "REVIEWED" && <><label>Posting reason<input value={stockCountReason} onChange={(event) => setStockCountReason(event.target.value)} /></label>
            <button className="pos-danger" disabled={busy || !stockCountReason.trim()} onClick={() => {
              if (confirm("Post these stock adjustments? This updates on-hand quantities.")) run(postCount, "Stock count posted");
            }}>Post stock count</button></>}
        </div>}
      </section>
      <section className="pos-panel"><h1>{selected ? "Edit product" : "New product"}</h1>
        <div className="pos-form">
          <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Product number<input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /></label>
          <label>Barcodes, comma separated<input value={form.barcodes} onChange={(event) => setForm({ ...form, barcodes: event.target.value })} /></label>
          <label>Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
          <label>Retail price (VND)<input type="number" min="0" step="1" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
          <label>VAT added on top (%)<input type="number" min="0" max="100" step="0.01" value={form.vat} onChange={(event) => setForm({ ...form, vat: event.target.value })} /></label>
          <label>Image URL<input value={form.image} onChange={(event) => setForm({ ...form, image: event.target.value })} /></label>
          <button className="pos-primary" disabled={!online || busy} onClick={() => run(saveProduct, "Product saved")}>Save product</button>
          {selected && <><hr/><h2>Stock</h2><p>On hand {selected.on_hand} · Reserved {selected.allocated}</p>
            <label>Adjustment (+ receive, − remove)<input type="number" step="1" value={stockDelta} onChange={(event) => setStockDelta(event.target.value)} /></label>
            <label>Reason<input value={stockReason} onChange={(event) => setStockReason(event.target.value)} /></label>
            <button disabled={!online || busy} onClick={() => run(async () => { await posApi.adjustStock(selected.sid, Number(stockDelta), stockReason); await refreshOnline(); }, "Stock updated")}>Post stock adjustment</button>
            <hr/><h2>Offline allocation</h2><p>Available on this device: {selected.offline_available}</p>
            <label>Allocate to this device<input type="number" min="0" step="1" value={allocation} onChange={(event) => setAllocation(event.target.value)} /></label>
            <button disabled={!online || busy} onClick={() => run(async () => { await posApi.allocate(device, selected.sid, Number(allocation)); await provision(); }, "Allocation updated")}>Save allocation and refresh</button>
            <hr/><button className="pos-danger" disabled={!online || busy} onClick={() => {
              if (confirm("Archive this product?")) run(async () => { await posApi.archiveProduct(selected.sid); await refreshOnline(); setSelected(null); }, "Product archived");
            }}>Archive product</button></>}
        </div>
        <hr/><h2>Import products</h2>
        <p className="pos-muted">CSV columns: sku, name, barcodes (separate multiple with |), category, price_minor, vat_rate_bps, opening_stock.</p>
        <input type="file" accept=".csv,text/csv" disabled={!online} onChange={async (event) => {
          const file = event.target.files?.[0]; if (!file) return;
          setImportCsv(await file.text()); setImportPreview(null);
        }} />
        <div className="pos-row"><button disabled={!online || !importCsv || busy} onClick={() => run(async () => {
          setImportPreview(await posApi.previewImport(importCsv));
        }, "Preview ready")}>Preview import</button>
          <a href="/api/pos/exports/products.csv">Export products CSV</a></div>
        {importPreview && <div className="pos-import-preview">
          <p>{importPreview.count} rows · {importPreview.errors.length} errors</p>
          {importPreview.errors.map((item) => <p className="pos-error" key={item}>{item}</p>)}
          {importPreview.preview.slice(0, 5).map((item, index) => <p key={index}>{String(item.action)} · {String(item.sku)} · {String(item.name)}</p>)}
          <button className="pos-primary" disabled={busy || importPreview.errors.length > 0} onClick={() => run(async () => {
            const result = await posApi.commitImport(importCsv);
            await refreshOnline(); setImportPreview(null); setImportCsv("");
            setMessage((result.duplicate ? "Already imported " : "Imported ") + result.run.count + " products");
          }, "")}>Commit import</button>
        </div>}
      </section>
    </main>}

    {tab === "reports" && <main className="pos-grid">
      <section className="pos-panel"><h1>Dashboard</h1>
        <div className="pos-kpis"><div><small>Synced sales today</small><strong>{dashboard?.sales_count ?? "—"}</strong></div>
          <div><small>Gross today</small><strong>{money(dashboard?.gross_minor || 0)}</strong></div>
          <div><small>Refunds today</small><strong>{money(dashboard?.refunds_minor || 0)}</strong></div>
          <div><small>Net today</small><strong>{money(dashboard?.net_minor || 0)}</strong></div>
          <div><small>Pending on this device</small><strong>{pending.length}</strong></div></div>
        <h2>Low stock</h2><p>{dashboard?.low_stock.length || 0} products need review</p>
      </section>
      <section className="pos-panel"><div className="pos-row"><h1>Sales</h1><div className="pos-row"><a href="/api/pos/exports/sales.csv">Sales CSV</a><a href="/api/pos/exports/returns.csv">Returns CSV</a><a href="/api/pos/exports/shifts.csv">Shifts CSV</a></div></div>
        {serverSales.slice(0, 30).map((sale) => <div className="pos-list-line" key={String(sale.sid)}><span>{String(sale.receipt_id)}<small>{String(sale.sold_at)} · {String(sale.refund_status || "PAID")}</small></span><span><strong>{money(Number(sale.total_minor) || 0)}</strong>
          <button disabled={!online || busy || sale.refund_status === "REFUNDED" || sale.refund_status === "VOIDED"} onClick={() => selectSaleForReturn(sale)}>Return</button>
          <button className="pos-danger" disabled={!online || busy || sale.refund_status === "REFUNDED" || sale.refund_status === "VOIDED"} onClick={() => {
            if (confirm("Void the remaining refundable quantity and record a cash refund?")) run(() => voidSelectedSale(sale), "Sale voided");
          }}>Void</button></span></div>)}
        {!serverSales.length && <p className="pos-muted">No synced sales yet.</p>}
        {selectedSale && <div className="pos-return-form"><div className="pos-row"><h2>Cash return · {String(selectedSale.receipt_id)}</h2><button onClick={() => setSelectedSale(null)}>Cancel</button></div>
          {((selectedSale.lines || []) as { product_sid: string; name: string; quantity: number }[]).map((line) => {
            const already = Number((selectedSale.returned_quantities as Record<string, number> | undefined)?.[line.product_sid] || 0);
            const value = returnLines[line.product_sid] || { quantity: "0", restock: true };
            return <div className="pos-return-line" key={line.product_sid}><span>{line.name} · available to return {line.quantity - already}</span>
              <input aria-label={"Return quantity for " + line.name} type="number" min="0" max={line.quantity - already} step="1" value={value.quantity}
                onChange={(event) => setReturnLines({ ...returnLines, [line.product_sid]: { ...value, quantity: event.target.value } })} />
              <label><input type="checkbox" checked={value.restock} onChange={(event) => setReturnLines({ ...returnLines, [line.product_sid]: { ...value, restock: event.target.checked } })} /> Restock</label></div>;
          })}
          <label>Reason<input value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /></label>
          <button className="pos-primary" disabled={busy || !online} onClick={() => run(submitReturn, "Cash return recorded")}>Record cash return</button>
        </div>}
        <hr/><div className="pos-row"><h2>Report</h2><select value={reportGroup} onChange={(event) => setReportGroup(event.target.value)}>
          <option value="day">By day</option><option value="cashier">By cashier</option><option value="product">By product</option>
        </select><label>From<input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} /></label>
          <label>To<input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} /></label></div>
        {reportRows.map((row) => <div className="pos-list-line" key={row.key}><span>{row.key}<small>{row.sales_count} sales · {row.quantity} units · VAT {money(row.vat_minor)}</small></span><strong>{money(row.gross_minor)}</strong></div>)}
      </section>
    </main>}

    {tab === "register" && <main className="pos-grid">
      <section className="pos-panel"><h1>Register</h1><p>Device: <code>{device}</code></p>
        <p>Cashier: {actor?.name || actor?.user_id || "Sign in through 42Trade while online"}</p>
        <p>Offline catalog expires: {bootstrap ? new Date(bootstrap.snapshot.expires_at).toLocaleString() : "Not provisioned"}</p>
        <div className="pos-row"><button disabled={!online || busy} onClick={() => run(provision, "Offline catalog refreshed")}>Pair / refresh offline catalog</button>
          <button disabled={!online || busy} onClick={() => run(syncPending, "Sync complete")}>Sync pending sales</button></div>
        <p className="pos-muted">Provision online before disconnecting. Cash sales are the only offline payment type.</p>
        <hr/><h2>Cash shift</h2>
        {openShift ? <><p>Open since {String(openShift.opened_at)} · opening cash {money(Number(openShift.opening_cash_minor) || 0)}</p>
          <label>Counted cash (VND)<input type="number" min="0" step="1" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} /></label>
          <button disabled={!online || busy || pending.length > 0 || attention.length > 0 || !countedCash} onClick={() => run(async () => {
            await posApi.closeShift(String(openShift.sid), Number(countedCash), pending.length + attention.length);
            setCountedCash(""); await refreshOnline();
          }, "Shift closed")}>Close shift</button>
          {(pending.length > 0 || attention.length > 0) && <p className="pos-error">Sync or reconcile local sales before closing.</p>}
        </> : <><label>Opening cash (VND)<input type="number" min="0" step="1" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label>
          <button disabled={!online || busy || !openingCash} onClick={() => run(async () => {
            await posApi.openShift(Number(openingCash)); setOpeningCash(""); await refreshOnline();
          }, "Shift opened")}>Open shift</button></>}
      </section>
      <section className="pos-panel"><h1>Local receipts</h1>{sales.slice().reverse().map((sale) =>
        <div className="pos-list-line" key={sale.idempotency_key}><span><strong>{sale.receipt_id}</strong><small>{sale.sync_state} · {sale.sync_error || sale.sold_at}</small></span>
          <span><strong>{money(sale.total_minor)}</strong><button onClick={() => setReceipt(fromLocalSale(sale))}>Receipt</button></span></div>)}
        {!sales.length && <p className="pos-muted">No local receipts yet.</p>}
      </section>
    </main>}
    {scanner && <Scanner onCode={scanned} onClose={() => setScanner(false)} />}
    {receipt && <Receipt receipt={receipt} onClose={() => setReceipt(null)} />}
  </div>;
}
