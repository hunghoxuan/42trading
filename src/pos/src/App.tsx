import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { useRegisterSW } from "virtual:pwa-register/react";
import { ApiError, posApi, type ImportPreview } from "./api";
import Receipt, { fromLocalSale, fromServerSale } from "./Receipt";
import { t, type Language } from "./i18n";
// Reuse the existing 42trade React components; their sources are JavaScript, not TypeScript.
// @ts-expect-error shared JS component has no declaration file
import AdminPageToolbar from "../../admin/shared/components/AdminPageToolbar";
// @ts-expect-error shared JS component has no declaration file
import PageHeader from "../../admin/shared/components/PageHeader";
// @ts-expect-error shared JS component has no declaration file
import ResponsivePanel from "../../admin/shared/components/ResponsivePanel";
import {
  commitLocalSale, listLocalSales, readBootstrap, requestDurableStorage,
  saveBootstrap, updateSaleState, validateBootstrap,
  type Bootstrap, type LocalSale, type Product, type SaleLine,
} from "./storage";

const money = (value: number, language: Language) => new Intl.NumberFormat(language === "en" ? "en-US" : "vi-VN", {
  style: "currency", currency: "VND", maximumFractionDigits: 0,
}).format(value);
const todayInVietnam = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

function signInHref(): string {
  const pathname = window.location.pathname;
  const integrated = /(?:^|\/)admin\/pos(?:\/|$)/.test(pathname);
  const login = new URL(pathname.startsWith("/ui/") ? "/ui/login" : "/login", window.location.origin);
  if (!integrated && (import.meta.env.DEV || (["localhost", "127.0.0.1"].includes(window.location.hostname)
    && window.location.port === "3002"))) login.port = "3000";
  const returnPath = integrated ? pathname : "/pos/";
  login.searchParams.set("return_url", login.origin === window.location.origin
    ? returnPath : new URL(returnPath, window.location.origin).href);
  return login.href;
}

function readProductImage(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 3 * 1024 * 1024) {
    return Promise.reject(new Error("Choose a PNG, JPEG, or WebP image under 3 MB"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read product image"));
    reader.readAsDataURL(file);
  });
}

function ProductImage({ src, label, preview = false }: { src: string; label: string; preview?: boolean }) {
  const [failedSrc, setFailedSrc] = useState("");
  const imageSrc = String(src || "").trim();
  if (!imageSrc || failedSrc === imageSrc) {
    return <span className={preview ? "pos-product-image-empty" : "pos-product-image pos-product-image-empty"}>{label}</span>;
  }
  return <img className={preview ? undefined : "pos-product-image"} src={imageSrc} alt="" loading="lazy"
    onError={() => setFailedSrc(imageSrc)} />;
}

function deviceId(): string {
  const key = "42trade-pos-device-id";
  let value = localStorage.getItem(key);
  if (!value) {
    value = "posdev_" + crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem(key, value);
  }
  return value;
}

function Scanner({ onCode, onClose, language }: { onCode: (value: string) => void; onClose: () => void; language: Language }) {
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
  return <div className="pos-scanner" role="dialog" aria-label={t(language, "Scan code")}>
    <div className="pos-scanner-card">
      <div className="pos-row"><h2>{t(language, "Scan code")}</h2><button onClick={onClose}>{t(language, "Close")}</button></div>
      <video ref={video} muted playsInline aria-label={t(language, "Camera preview")} />
      <p className="pos-muted">{t(language, "Point the camera at a QR code or barcode.")}</p>
      {error && <p className="pos-error">{error}. {t(language, "Type the product number in the search box instead.")}</p>}
    </div>
  </div>;
}

type Tab = "sale" | "inventory" | "reports" | "register";

export default function App() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("42trade-pos-language") === "en" ? "en" : "vi");
  const tr = (value: string) => t(language, value);
  const localizedImportWarning = (value: string) => {
    if (language !== "vi") return value;
    const barcode = value.match(/^Row (\d+): barcode is shared with another product: (.+)$/);
    if (barcode) return "Dòng " + barcode[1] + ": mã vạch được dùng chung với sản phẩm khác: " + barcode[2];
    const stock = value.match(/^Row (\d+): stock was not loaded because POS stock must be a non-negative whole number$/);
    if (stock) return "Dòng " + stock[1] + ": không nhập tồn vì POS yêu cầu số lượng nguyên không âm.";
    return value;
  };
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
  const [importRows, setImportRows] = useState<Record<string, unknown>[] | null>(null);
  const [importFilename, setImportFilename] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [reportGroup, setReportGroup] = useState("day");
  const [reportFrom, setReportFrom] = useState(todayInVietnam());
  const [reportTo, setReportTo] = useState(todayInVietnam());
  const [reportRows, setReportRows] = useState<{ key: string; sales_count: number; quantity: number; base_minor: number; vat_minor: number; gross_minor: number }[]>([]);
  const [query, setQuery] = useState("");
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState("ALL");
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState("");
  const [inventorySupplierFilter, setInventorySupplierFilter] = useState("");
  const [cart, setCart] = useState<SaleLine[]>([]);
  const [cash, setCash] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [form, setForm] = useState({ sid: "", name: "", sku: "", barcodes: "", category: "", supplier: "", status: "ACTIVE", unit: "cái", price: "", cost: "", minStock: "0", vat: "0", image: "" });
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

  useEffect(() => {
    localStorage.setItem("42trade-pos-language", language);
    document.documentElement.lang = language;
  }, [language]);

  const localProducts = bootstrap?.snapshot.products || [];
  const usingOfflineCatalog = !online && !!bootstrap;
  const visibleProducts = online
    ? (tab === "sale" ? products.filter((product) => product.status === "ACTIVE") : products)
    : localProducts;
  const filtered = visibleProducts.filter((product) => {
    const text = query.trim().toLowerCase();
    return !text || [product.name, product.sku, product.sid, product.category, product.supplier, ...product.barcodes]
      .some((part) => String(part || "").toLowerCase().includes(text));
  });
  const inventoryFiltered = filtered.filter((product) => {
    if (inventoryStatusFilter === "ACTIVE" && product.status !== "ACTIVE") return false;
    if (inventoryStatusFilter === "INACTIVE" && product.status === "ACTIVE") return false;
    if (inventoryStatusFilter === "OUT_OF_STOCK" && product.on_hand > 0) return false;
    if (inventoryStatusFilter === "NO_PRICE" && product.price_minor !== null) return false;
    if (inventoryStatusFilter === "NO_IMAGE" && product.image.trim()) return false;
    if (inventoryCategoryFilter && product.category !== inventoryCategoryFilter) return false;
    if (inventorySupplierFilter && product.supplier !== inventorySupplierFilter) return false;
    return true;
  });
  const inventoryCategories = [...new Set(products.map((product) => product.category.trim()).filter(Boolean))].sort();
  const inventorySuppliers = [...new Set(products.map((product) => product.supplier.trim()).filter(Boolean))].sort();
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
      posApi.auth(), posApi.products(device, true), posApi.dashboard(), posApi.sales(), posApi.shifts(), posApi.stockCounts(),
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
    if (!online) return;
    let lastRefresh = 0;
    const refresh = () => {
      if (Date.now() - lastRefresh < 1000) return;
      lastRefresh = Date.now();
      refreshOnline().then(() => setError("")).catch((cause) => {
        if (cause instanceof ApiError && cause.status === 0) {
          setOnline(false);
          setError("");
        } else {
          setError(String(cause));
        }
      });
    };
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [online, refreshOnline]);

  useEffect(() => {
    if (online && tab === "inventory") refreshOnline().catch((cause) => setError(String(cause)));
  }, [online, tab, refreshOnline]);

  useEffect(() => {
    if (online) return;
    const retry = window.setInterval(() => {
      if (navigator.onLine) setOnline(true);
    }, 15_000);
    return () => window.clearInterval(retry);
  }, [online]);

  useEffect(() => {
    if (online && pendingKey) syncPending().catch((cause) => setError(String(cause)));
  }, [online, pendingKey]);

  useEffect(() => {
    if (online && tab === "reports") posApi.reportSales(reportGroup, reportFrom, reportTo).then((result) => setReportRows(result.items))
      .catch((cause) => setError(String(cause)));
  }, [online, tab, reportGroup, reportFrom, reportTo]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); if (success) setMessage(tr(success)); }
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
    if (!online && bootstrap) {
      const sale = await commitLocalSale(cart, received);
      setReceipt(fromLocalSale(sale));
      setCart([]); setCash("");
      await refreshLocal();
      setMessage(language === "vi" ? "Đã lưu giao dịch. Hóa đơn " + sale.receipt_id + " đang chờ đồng bộ." : "Cash sale saved locally. Receipt " + sale.receipt_id + " is pending sync.");
    } else if (online) {
      onlineCheckoutKey.current ||= crypto.randomUUID();
      const result = await posApi.checkout(onlineCheckoutKey.current, cart, received);
      const paid = result.sale as { receipt_id: string };
      setReceipt(fromServerSale(result.sale as Record<string, unknown>));
      setMessage(language === "vi" ? "Đã thanh toán. Hóa đơn " + paid.receipt_id : "Sale paid. Receipt " + paid.receipt_id);
      setCart([]); setCash(""); onlineCheckoutKey.current = null;
      await refreshOnline();
    } else throw new Error("Provision this register online before offline sales");
  }

  function selectProduct(product: Product) {
    setSelected(product);
    setForm({ sid: product.sid, name: product.name, sku: product.sku,
      barcodes: product.barcodes.join(", "), category: product.category, supplier: product.supplier, status: product.status,
      unit: product.unit, price: String(product.price_minor ?? ""), cost: String(product.cost_minor ?? ""),
      minStock: String(product.min_stock), vat: String(product.vat_rate_bps / 100), image: product.image });
    setAllocation(String(product.offline_available));
  }

  async function saveProduct() {
    const result = await posApi.saveProduct({ ...form, cost_minor: form.cost === "" ? null : Number(form.cost),
      min_stock: Number(form.minStock), vat_rate_bps: Math.round(Number(form.vat) * 100),
      barcodes: form.barcodes.split(",").map((v) => v.trim()).filter(Boolean) });
    if (form.price) await posApi.setPrice(result.product.sid, Number(form.price));
    await refreshOnline();
    setSelected(null);
  }

  async function exportProductsXlsx() {
    const { items } = await posApi.products("", true);
    const { downloadProductsXlsx } = await import("./xlsxProducts");
    await downloadProductsXlsx(items);
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
    const matches = visibleProducts.filter((item) => item.sku === code || item.sid === code || item.barcodes.includes(code));
    if (matches.length > 1) {
      setCandidates(matches.map((item) => ({ product_sid: item.sid, name: item.name,
        retail_price_minor: item.price_minor, score: 1, explanation: "Barcode is shared; select the correct product." })));
      setMessage(language === "vi" ? "Mã vạch trùng nhiều sản phẩm. Hãy chọn đúng sản phẩm." : "This barcode matches multiple products. Choose the correct product.");
      return;
    }
    const product = matches[0];
    if (product && tab === "inventory") {
      selectProduct(product);
      setMessage(tr("Opened") + " " + product.name);
    } else if (product) {
      addToCart(product);
      setMessage(tr("Added") + " " + product.name);
    } else if (tab === "inventory") {
      setSelected(null);
      setForm({ sid: "", name: "", sku: code, barcodes: code ? code : "", category: "", supplier: "", status: "ACTIVE", unit: "cái", price: "", cost: "", minStock: "0", vat: "0", image: "" });
      setMessage(tr("No match. Review the scanned code and create a product."));
    } else setMessage(tr("No match for") + " " + code + ". " + tr("Use Inventory to create a product."));
  }, [visibleProducts, tab, language]);

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

  return <section className="pos-app logs-page-container trades-page-container stack-layout fadeIn" lang={language}>
    <PageHeader className="trades-page-header pos-page-header" title="42Trade POS" actions={
      <div className="pos-header-actions">
        <span className="pos-muted">{tr("Main store")} · VND{import.meta.env.VITE_POS_DEMO === "1" ? " · DEMO" : ""}</span>
        <button className="secondary-button" aria-label={language === "vi" ? "Switch to English" : "Chuyển sang Tiếng Việt"} onClick={() => setLanguage(language === "vi" ? "en" : "vi")}>{language === "vi" ? "English" : "Tiếng Việt"}</button>
        <span className={online ? "pos-online status-dot status-active" : "pos-offline status-dot status-warning"}>{tr(online ? "Online" : "Offline")}</span>
        <span>{pending.length} {tr("pending")}</span>
        {attention.length > 0 && <span className="pos-error status-dot status-danger">{attention.length} {tr("needs attention")}</span>}
      </div>
    } />
    <AdminPageToolbar className="trades-toolbar-panel pos-tabs-toolbar" actions={
      <nav className="pos-tabs" aria-label="POS sections">
        {(["sale", "inventory", "reports", "register"] as Tab[]).map((item) =>
          <button key={item} type="button" className={tab === item ? "secondary-button active" : "secondary-button"} onClick={() => setTab(item)}>{tr(item[0].toUpperCase() + item.slice(1))}</button>)}
      </nav>
    } />
    {error && <div className="pos-alert pos-error" role="alert">{error}
      {error.includes("AUTH_REQUIRED") && <> · <a href={signInHref()}>{tr("Sign in to 42Trade")}</a></>}
    </div>}
    {needRefresh && <div className="pos-alert pos-row" role="status"><span>{tr("A POS update is ready. Finish the current cart before reloading.")}</span>
      <button disabled={cart.length > 0 || busy} onClick={() => updateServiceWorker(true)}>{tr("Update POS")}</button></div>}
    {message && <div className="pos-alert pos-success" role="status">{message}</div>}

    {tab === "sale" && <main className="pos-checkout pos-page-content">
      <ResponsivePanel className="pos-panel" style={{ width: "auto" }} title={tr("Products")} subtitle={usingOfflineCatalog ? tr("Approved register prices from") + " " + new Date(bootstrap.snapshot.issued_at).toLocaleString(language === "vi" ? "vi-VN" : "en-US") : tr("Main store")} showToggle={false} border="always" headerActions={<div className="pos-row"><button className="secondary-button" onClick={() => setScanner(true)}>{tr("Scan code")}</button>
          <label className="pos-upload">{tr("Recognize photo")}<input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={(event) => {
            const file = event.target.files?.[0]; if (file) run(() => recognizeFile(file), ""); event.target.value = "";
          }} /></label></div>}>
        {usingOfflineCatalog && <p className="pos-muted">{tr("Refresh the register after price changes.")}</p>}
        <input className="pos-search" placeholder={tr("Scan or enter product number, barcode, name")} value={query}
          onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && query.trim()) { event.preventDefault(); scanned(query.trim()); }
          }} autoFocus />
        {candidates.length > 0 && <div className="pos-candidates"><strong>{tr("Possible matches — confirm product")}</strong>
          {candidates.map((candidate) => <button key={candidate.product_sid} onClick={() => {
            const product = visibleProducts.find((item) => item.sid === candidate.product_sid);
            if (product) addToCart(product); setCandidates([]);
          }}>{candidate.name} · {money(visibleProducts.find((item) => item.sid === candidate.product_sid)?.price_minor || 0, language)}
            <small>{candidate.explanation}{usingOfflineCatalog ? " · " + tr("approved register price") : " · " + tr("current inventory price")}</small></button>)}
        </div>}
        <div className="pos-products">
          {filtered.map((product) => <button className="pos-product" key={product.sid}
            disabled={product.price_minor === null || (usingOfflineCatalog ? product.offline_available <= 0 : product.on_hand - product.allocated <= 0)}
            onClick={() => addToCart(product)}>
            <span><strong>{product.name}</strong><small>{product.sku || product.sid} · {product.category}</small></span>
            <span>{product.price_minor === null ? tr("Price needed") : money(product.price_minor, language)}<small>{online ? tr("Stock") + " " + product.on_hand : tr("Offline") + " " + product.offline_available}</small></span>
          </button>)}
          {!filtered.length && <p className="pos-muted">{tr("No matching products. Create one in Inventory.")}</p>}
        </div>
      </ResponsivePanel>
      <ResponsivePanel className="pos-panel pos-cart" style={{ width: "auto" }} title={tr("Cart")} subtitle={`${cartRows.length} ${tr("items")}`} showToggle={false} border="always">
        {cartRows.map((row) => <div className="pos-cart-line" key={row.product_sid}>
          <div><strong>{row.product?.name || row.product_sid}</strong><small>{money(row.product?.price_minor || 0, language)} {tr("each")}</small></div>
          <div className="pos-row"><button aria-label="Decrease quantity" onClick={() => setCart((items) => items.map((item) =>
            item.product_sid === row.product_sid ? { ...item, quantity: Math.max(0, item.quantity - 1) } : item).filter((item) => item.quantity))}>−</button>
            <span>{row.quantity}</span><button aria-label="Increase quantity" onClick={() => addToCart(row.product!)}>+</button></div>
        </div>)}
        {!cartRows.length && <p className="pos-muted">{tr("Scan or select a product to start a sale.")}</p>}
        <div className="pos-cart-bottom">
          <div className="pos-row"><span>{tr("Subtotal")}</span><span>{money(subtotal, language)}</span></div>
          <div className="pos-row"><span>{tr("VAT")}</span><span>{money(vat, language)}</span></div>
          <div className="pos-total"><span>{tr("Total")}</span><strong>{money(total, language)}</strong></div>
          <label>{tr("Cash received")}<input type="number" min="0" step="1" value={cash} onChange={(event) => setCash(event.target.value)} /></label>
          <p>{tr("Change")}: {money(Math.max(0, Number(cash || 0) - total), language)}</p>
          <button className="primary-button" disabled={busy || !cart.length} onClick={() => run(checkout, "")}>{tr("Complete cash sale")}</button>
          <small className="pos-muted">{tr("Offline sales are saved on this device until synced.")}</small>
        </div>
      </ResponsivePanel>
    </main>}

    {tab === "inventory" && <main className="pos-grid pos-page-content">
      <ResponsivePanel className="pos-panel" style={{ width: "auto" }} title={tr("Inventory")} subtitle={`${inventoryFiltered.length} ${tr("products")}`} showToggle={false} border="always" headerActions={<div className="pos-row"><button className="secondary-button" onClick={() => setScanner(true)}>{tr("Scan code")}</button><button className="secondary-button" disabled={!online || busy} onClick={() => run(startStockCount, "Stock count started")}>{tr("Start stock count")}</button><button className="primary-button" onClick={() => { setSelected(null); setForm({ sid: "", name: "", sku: "", barcodes: "", category: "", supplier: "", status: "ACTIVE", unit: "cái", price: "", cost: "", minStock: "0", vat: "0", image: "" }); }}>{tr("New product")}</button></div>}>
        <input placeholder={tr("Search products or scan a product number")} value={query} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && query.trim()) { event.preventDefault(); scanned(query.trim()); } }} />
        <div className="pos-inventory-filters">
          <select aria-label={tr("Filter by status")} value={inventoryStatusFilter} onChange={(event) => setInventoryStatusFilter(event.target.value)}>
            <option value="ALL">{tr("All status")}</option><option value="ACTIVE">{tr("Active")}</option><option value="INACTIVE">{tr("Inactive")}</option>
            <option value="OUT_OF_STOCK">{tr("Out-of-Stock")}</option><option value="NO_PRICE">{tr("No Price")}</option><option value="NO_IMAGE">{tr("No Image")}</option>
          </select>
          <select aria-label={tr("Filter by category")} value={inventoryCategoryFilter} onChange={(event) => setInventoryCategoryFilter(event.target.value)}>
            <option value="">{tr("All categories")}</option>{inventoryCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select aria-label={tr("Filter by supplier")} value={inventorySupplierFilter} onChange={(event) => setInventorySupplierFilter(event.target.value)}>
            <option value="">{tr("All suppliers")}</option>{inventorySuppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
          </select>
        </div>
        <div className="pos-products">{inventoryFiltered.map((product) => <button key={product.sid} className="pos-product" onClick={() => selectProduct(product)}>
          <ProductImage src={product.image} label={tr("No Image")} />
          <span className="pos-product-copy"><strong>{product.name}</strong><small>{product.sku || product.sid} · {product.category || tr("Uncategorized")}</small>
            <small>{product.supplier ? tr("Supplier") + ": " + product.supplier + " · " : ""}{product.status === "ACTIVE" ? tr("Active") : tr("Inactive")}</small></span>
          <span>{product.price_minor === null ? tr("No Price") : money(product.price_minor, language)}<small>{tr("On hand")} {product.on_hand} {product.unit} · {tr("Reserved")} {product.allocated}</small></span>
        </button>)}</div>
        {!inventoryFiltered.length && <p className="pos-muted">{tr("No products match these filters.")}</p>}
        {!!stockCountRows.length && <div className="pos-count-history"><h2>{tr("Stock counts")}</h2>{stockCountRows.slice(0, 10).map((count) => <button key={String(count.sid)} disabled={!online || busy || count.status === "POSTED"}
          onClick={() => resumeStockCount(count)}>{tr(String(count.status))} · {new Date(String(count.created_at)).toLocaleString(language === "vi" ? "vi-VN" : "en-US")} · {((count.lines || []) as unknown[]).length} {tr("products")}</button>)}</div>}
        {stockCount && <div className="pos-count-form"><div className="pos-row"><h2>{tr("Stock count")} · {tr(String(stockCount.status))}</h2>
          <button onClick={() => { setStockCount(null); setStockCountValues({}); }}>{tr("Close count")}</button></div>
          {(stockCount.lines as { product_sid: string; name: string; expected_on_hand: number; counted_on_hand: number | null; variance?: number }[]).map((line) => <label className="pos-count-line" key={line.product_sid}>
            <span>{line.name}<small>{tr("System count")} {line.expected_on_hand}{line.variance !== undefined ? " · " + tr("variance") + " " + line.variance : ""}</small></span>
            {stockCount.status === "DRAFT" ? <input aria-label={"Count " + line.name} type="number" min="0" step="1" value={stockCountValues[line.product_sid] ?? ""}
              onChange={(event) => setStockCountValues({ ...stockCountValues, [line.product_sid]: event.target.value })} /> : <strong>{line.counted_on_hand}</strong>}
          </label>)}
          {stockCount.status === "DRAFT" && <button className="primary-button" disabled={busy} onClick={() => run(submitCountForReview, "Count ready for review")}>{tr("Review count")}</button>}
          {stockCount.status === "REVIEWED" && <><label>{tr("Posting reason")}<input value={stockCountReason} onChange={(event) => setStockCountReason(event.target.value)} /></label>
            <button className="danger-button" disabled={busy || !stockCountReason.trim()} onClick={() => {
              if (confirm(tr("Post these stock adjustments? This updates on-hand quantities."))) run(postCount, "Stock count posted");
            }}>{tr("Post stock count")}</button></>}
        </div>}
      </ResponsivePanel>
      <ResponsivePanel className="pos-panel" style={{ width: "auto" }} title={tr(selected ? "Edit product" : "New product")} subtitle={selected?.sku || tr("Product details")} showToggle={false} border="always">
        <div className="pos-form">
          <label>{tr("Name")}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>{tr("Product number")}<input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /></label>
          <label>{tr("Barcodes, comma separated")}<input value={form.barcodes} onChange={(event) => setForm({ ...form, barcodes: event.target.value })} /></label>
          <label>{tr("Category")}<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
          <label>{tr("Supplier")}<input value={form.supplier} onChange={(event) => setForm({ ...form, supplier: event.target.value })} /></label>
          <label>{tr("Status")}<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
            <option value="ACTIVE">{tr("Active")}</option><option value="ARCHIVED">{tr("Inactive")}</option>
          </select></label>
          <label className="pos-product-image-picker" htmlFor="pos-product-image"><ProductImage src={form.image} label={tr("No Image")} preview />
            <span className="secondary-button">{tr(form.image ? "Update image" : "Add image")}</span>
            <input id="pos-product-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
              const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
              if (file) run(async () => {
                const image = await readProductImage(file);
                setForm((current) => ({ ...current, image }));
              }, "Image ready");
            }} />
          </label>
          <label>{tr("Unit")}<input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} /></label>
          <label>{tr("Retail price (VND)")}<input type="number" min="0" step="1" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
          <label>{tr("Cost price (VND)")}<input type="number" min="0" step="1" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} /></label>
          <label>{tr("Minimum stock")}<input type="number" min="0" step="0.01" value={form.minStock} onChange={(event) => setForm({ ...form, minStock: event.target.value })} /></label>
          <label>{tr("VAT added on top (%)")}<input type="number" min="0" max="100" step="0.01" value={form.vat} onChange={(event) => setForm({ ...form, vat: event.target.value })} /></label>
          <label>{tr("Image URL")}<input value={form.image} onChange={(event) => setForm({ ...form, image: event.target.value })} /></label>
          <button className="primary-button" disabled={!online || busy} onClick={() => run(saveProduct, "Product saved")}>{tr("Save product")}</button>
          {selected && <><hr/><h2>{tr("Stock")}</h2><p>{tr("On hand")} {selected.on_hand} {selected.unit} · {tr("Reserved")} {selected.allocated}</p>
            {selected.stock_import_warning && <p className="pos-error">{tr("Stock source not imported")}: {selected.source_on_hand}</p>}
            <label>{tr("Adjustment (+ receive, − remove)")}<input type="number" step="1" value={stockDelta} onChange={(event) => setStockDelta(event.target.value)} /></label>
            <label>{tr("Reason")}<input value={stockReason} onChange={(event) => setStockReason(event.target.value)} /></label>
            <button disabled={!online || busy} onClick={() => run(async () => { await posApi.adjustStock(selected.sid, Number(stockDelta), stockReason); await refreshOnline(); }, "Stock updated")}>{tr("Post stock adjustment")}</button>
            <hr/><h2>{tr("Offline allocation")}</h2><p>{tr("Available on this device:")} {selected.offline_available}</p>
            <label>{tr("Allocate to this device")}<input type="number" min="0" step="1" value={allocation} onChange={(event) => setAllocation(event.target.value)} /></label>
            <button disabled={!online || busy} onClick={() => run(async () => { await posApi.allocate(device, selected.sid, Number(allocation)); await provision(); }, "Allocation updated")}>{tr("Save allocation and refresh")}</button>
            <hr/><button className="danger-button" disabled={!online || busy} onClick={() => {
              if (confirm(tr("Archive this product?"))) run(async () => { await posApi.archiveProduct(selected.sid); await refreshOnline(); setSelected(null); }, "Product archived");
            }}>{tr("Archive product")}</button></>}
        </div>
        <hr/><h2>{tr("Import products")}</h2>
        <p className="pos-muted">{tr("Import CSV or XLSX. XLSX accepts the Vietnamese product export columns, including product number, barcode, name, category, unit, price, cost and stock.")}</p>
        <input type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!online} onChange={(event) => {
          const file = event.target.files?.[0]; if (!file) return;
          setImportFilename(file.name); setImportPreview(null);
          event.target.value = "";
          run(async () => {
            if (file.name.toLowerCase().endsWith(".xlsx")) {
              const { parseXlsxProducts } = await import("./xlsxProducts");
              setImportRows(await parseXlsxProducts(file)); setImportCsv("");
            } else {
              setImportCsv(await file.text()); setImportRows(null);
            }
          }, "File ready");
        }} />
        {importFilename && <p className="pos-muted">{importFilename}</p>}
        <div className="pos-row"><button disabled={!online || (!importCsv && !importRows) || busy} onClick={() => run(async () => {
          setImportPreview(importRows ? await posApi.previewImportRows(importRows) : await posApi.previewImport(importCsv));
        }, "Preview ready")}>{tr("Preview import")}</button>
          <a href="/api/pos/exports/products.csv">{tr("Export products CSV")}</a>
          <button disabled={!online || busy} onClick={() => run(exportProductsXlsx, "XLSX catalog exported")}>{tr("Export products XLSX")}</button></div>
        {importPreview && <div className="pos-import-preview">
          <p>{importPreview.count} {tr("rows")} · {importPreview.errors.length} {tr("errors")} · {importPreview.warning_count} {tr("warnings")}</p>
          {importPreview.errors.map((item) => <p className="pos-error" key={item}>{item}</p>)}
          {importPreview.warnings.slice(0, 12).map((item) => <p className="pos-muted" key={item}>{localizedImportWarning(item)}</p>)}
          {importPreview.preview.slice(0, 5).map((item, index) => <p key={index}>{String(item.action)} · {String(item.sku)} · {String(item.name)}</p>)}
          <button className="primary-button" disabled={busy || importPreview.errors.length > 0} onClick={() => run(async () => {
            const result = importRows ? await posApi.commitImportRows(importRows) : await posApi.commitImport(importCsv);
            await refreshOnline(); setImportPreview(null); setImportCsv(""); setImportRows(null); setImportFilename("");
            const action = result.duplicate ? tr("Already imported") : tr("Imported");
            setMessage(language === "vi" ? action + " " + result.run.count + " sản phẩm · " + (result.run.warnings || 0) + " cảnh báo" : action + " " + result.run.count + " products · " + (result.run.warnings || 0) + " warnings");
          }, "")}>{tr("Commit import")}</button>
        </div>}
      </ResponsivePanel>
    </main>}

    {tab === "reports" && <main className="pos-grid pos-page-content">
      <ResponsivePanel className="pos-panel" style={{ width: "auto" }} title={tr("Dashboard")} subtitle={tr("Main store")} showToggle={false} border="always">
        <div className="pos-kpis"><div><small>{tr("Synced sales today")}</small><strong>{dashboard?.sales_count ?? "—"}</strong></div>
          <div><small>{tr("Gross today")}</small><strong>{money(dashboard?.gross_minor || 0, language)}</strong></div>
          <div><small>{tr("Refunds today")}</small><strong>{money(dashboard?.refunds_minor || 0, language)}</strong></div>
          <div><small>{tr("Net today")}</small><strong>{money(dashboard?.net_minor || 0, language)}</strong></div>
          <div><small>{tr("Pending on this device")}</small><strong>{pending.length}</strong></div></div>
        <h2>{tr("Low stock")}</h2><p>{dashboard?.low_stock.length || 0} {tr("products need review")}</p>
      </ResponsivePanel>
      <ResponsivePanel className="pos-panel" style={{ width: "auto" }} title={tr("Sales")} subtitle={tr("Sales and cash returns")} showToggle={false} border="always" headerActions={<div className="pos-row"><a className="secondary-button" href="/api/pos/exports/sales.csv">{tr("Sales CSV")}</a><a className="secondary-button" href="/api/pos/exports/returns.csv">{tr("Returns CSV")}</a><a className="secondary-button" href="/api/pos/exports/shifts.csv">{tr("Shifts CSV")}</a></div>}>
        {serverSales.slice(0, 30).map((sale) => <div className="pos-list-line" key={String(sale.sid)}><span>{String(sale.receipt_id)}<small>{String(sale.sold_at)} · {tr(String(sale.refund_status || "PAID"))}</small></span><span><strong>{money(Number(sale.total_minor) || 0, language)}</strong>
          <button disabled={!online || busy || sale.refund_status === "REFUNDED" || sale.refund_status === "VOIDED"} onClick={() => selectSaleForReturn(sale)}>{tr("Return")}</button>
          <button className="danger-button" disabled={!online || busy || sale.refund_status === "REFUNDED" || sale.refund_status === "VOIDED"} onClick={() => {
            if (confirm(tr("Void the remaining refundable quantity and record a cash refund?"))) run(() => voidSelectedSale(sale), "Sale voided");
          }}>{tr("Void")}</button></span></div>)}
        {!serverSales.length && <p className="pos-muted">{tr("No synced sales yet.")}</p>}
        {selectedSale && <div className="pos-return-form"><div className="pos-row"><h2>{tr("Cash return")} · {String(selectedSale.receipt_id)}</h2><button onClick={() => setSelectedSale(null)}>{tr("Cancel")}</button></div>
          {((selectedSale.lines || []) as { product_sid: string; name: string; quantity: number }[]).map((line) => {
            const already = Number((selectedSale.returned_quantities as Record<string, number> | undefined)?.[line.product_sid] || 0);
            const value = returnLines[line.product_sid] || { quantity: "0", restock: true };
            return <div className="pos-return-line" key={line.product_sid}><span>{line.name} · {tr("available to return")} {line.quantity - already}</span>
              <input aria-label={"Return quantity for " + line.name} type="number" min="0" max={line.quantity - already} step="1" value={value.quantity}
                onChange={(event) => setReturnLines({ ...returnLines, [line.product_sid]: { ...value, quantity: event.target.value } })} />
              <label><input type="checkbox" checked={value.restock} onChange={(event) => setReturnLines({ ...returnLines, [line.product_sid]: { ...value, restock: event.target.checked } })} /> {tr("Restock")}</label></div>;
          })}
          <label>{tr("Reason")}<input value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /></label>
          <button className="primary-button" disabled={busy || !online} onClick={() => run(submitReturn, "Cash return recorded")}>{tr("Record cash return")}</button>
        </div>}
        <hr/><div className="pos-row"><h2>{tr("Report")}</h2><select value={reportGroup} onChange={(event) => setReportGroup(event.target.value)}>
          <option value="day">{tr("By day")}</option><option value="cashier">{tr("By cashier")}</option><option value="product">{tr("By product")}</option>
        </select><label>{tr("From")}<input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} /></label>
          <label>{tr("To")}<input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} /></label></div>
        {reportRows.map((row) => <div className="pos-list-line" key={row.key}><span>{row.key}<small>{row.sales_count} {tr("sales")} · {row.quantity} {tr("units")} · VAT {money(row.vat_minor, language)}</small></span><strong>{money(row.gross_minor, language)}</strong></div>)}
      </ResponsivePanel>
    </main>}

    {tab === "register" && <main className="pos-grid pos-page-content">
      <ResponsivePanel className="pos-panel" style={{ width: "auto" }} title={tr("Register")} subtitle={device} showToggle={false} border="always"><p>{tr("Device")}: <code>{device}</code></p>
        <p>{tr("Cashier")}: {actor?.name || actor?.user_id || tr("Sign in through 42Trade while online")}</p>
        <p>{tr("Offline catalog expires")}: {bootstrap ? new Date(bootstrap.snapshot.expires_at).toLocaleString(language === "vi" ? "vi-VN" : "en-US") : tr("Not provisioned")}</p>
        <div className="pos-row"><button disabled={!online || busy} onClick={() => run(provision, "Offline catalog refreshed")}>{tr("Pair / refresh offline catalog")}</button>
          <button disabled={!online || busy} onClick={() => run(syncPending, "Sync pending sales")}>{tr("Sync pending sales")}</button></div>
        <p className="pos-muted">{tr("Provision online before disconnecting. Cash sales are the only offline payment type.")}</p>
        <hr/><h2>{tr("Cash shift")}</h2>
        {openShift ? <><p>{tr("Open since")} {String(openShift.opened_at)} · {tr("opening cash")} {money(Number(openShift.opening_cash_minor) || 0, language)}</p>
          <label>{tr("Counted cash (VND)")}<input type="number" min="0" step="1" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} /></label>
          <button disabled={!online || busy || pending.length > 0 || attention.length > 0 || !countedCash} onClick={() => run(async () => {
            await posApi.closeShift(String(openShift.sid), Number(countedCash), pending.length + attention.length);
            setCountedCash(""); await refreshOnline();
          }, "Shift closed")}>{tr("Close shift")}</button>
          {(pending.length > 0 || attention.length > 0) && <p className="pos-error">{tr("Sync or reconcile local sales before closing.")}</p>}
        </> : <><label>{tr("Opening cash (VND)")}<input type="number" min="0" step="1" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label>
          <button disabled={!online || busy || !openingCash} onClick={() => run(async () => {
            await posApi.openShift(Number(openingCash)); setOpeningCash(""); await refreshOnline();
          }, "Shift opened")}>{tr("Open shift")}</button></>}
      </ResponsivePanel>
      <ResponsivePanel className="pos-panel" style={{ width: "auto" }} title={tr("Local receipts")} subtitle={`${sales.length} ${tr("receipts")}`} showToggle={false} border="always">{sales.slice().reverse().map((sale) =>
        <div className="pos-list-line" key={sale.idempotency_key}><span><strong>{sale.receipt_id}</strong><small>{sale.sync_state} · {sale.sync_error || sale.sold_at}</small></span>
          <span><strong>{money(sale.total_minor, language)}</strong><button onClick={() => setReceipt(fromLocalSale(sale))}>{tr("Receipt")}</button></span></div>)}
        {!sales.length && <p className="pos-muted">{tr("No local receipts yet.")}</p>}
      </ResponsivePanel>
    </main>}
    {scanner && <Scanner onCode={scanned} onClose={() => setScanner(false)} language={language} />}
    {receipt && <Receipt receipt={receipt} onClose={() => setReceipt(null)} language={language} />}
  </section>;
}
