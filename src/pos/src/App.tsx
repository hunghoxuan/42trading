import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type SelectHTMLAttributes } from "react";
import { readBarcodePhoto } from "./barcodeReader";
import { useRegisterSW } from "virtual:pwa-register/react";
import { ApiError, posApi, type ImportPreview, type ProductObservation } from "./api";
import Receipt, { fromLocalSale, fromServerSale } from "./Receipt";
import PhotoCamera from "./PhotoCamera";
import CashPayment from "./CashPayment";
import Scanner from "./Scanner";
import { cashReceivedForCheckout } from "./cashChange";
import { searchProducts } from "./productSearch";
import { t, type Language } from "./i18n";
// Reuse the existing 42trade React components; their sources are JavaScript, not TypeScript.
// @ts-expect-error shared JS component has no declaration file
import AdminPageToolbar from "../../admin/shared/components/AdminPageToolbar";
// @ts-expect-error shared JS component has no declaration file
import ResponsiveSectionNav from "../../admin/shared/components/ResponsiveSectionNav";
// @ts-expect-error shared JS component has no declaration file
import PageHeader from "../../admin/shared/components/PageHeader";
// @ts-expect-error shared JS component has no declaration file
import ResponsivePanel from "../../admin/shared/components/ResponsivePanel";
// @ts-expect-error shared JS source has no declaration file
import CrudContainer from "../../admin/shared/components/CrudContainer";
// @ts-expect-error shared JS source has no declaration file
import DataTable from "../../admin/shared/components/DataTable";
// @ts-expect-error shared JS source has no declaration file
import SharedInputComboSelect from "../../admin/shared/components/InputComboSelect";
// @ts-expect-error shared JS source has no declaration file
import ComboButtonMenu from "../../admin/shared/components/ComboButtonMenu";
// @ts-expect-error shared JS source has no declaration file
import PaginationBar from "../../admin/shared/components/PaginationBar";
// @ts-expect-error shared JS source has no declaration file
import useIsMobile from "../../admin/shared/hooks/useIsMobile";
// @ts-expect-error Reuse the status indicator shared by the main 42Trade pages.
import { StatusDisplay } from "../../admin/shared/components/StatusBadge";
// @ts-expect-error shared JS component has no declaration file
import MobileFullscreenModal from "../../admin/shared/components/MobileFullscreenModal";
import {
  commitLocalSale, listLocalSales, readBootstrap, requestDurableStorage,
  saveBootstrap, updateSaleState, validateBootstrap,
  type Bootstrap, type LocalSale, type Product, type SaleLine,
} from "./storage";

const InputComboSelect = SharedInputComboSelect as ComponentType<SelectHTMLAttributes<HTMLSelectElement> & {
  searchable?: boolean; placeholder?: string; searchPlaceholder?: string; allowCreate?: boolean; createLabel?: string; menuClassName?: string;
}>;
type ProductCell = { row: { original: Product } };

function attributeOptions(products: Product[], field: "category" | "supplier" | "unit"): string[] {
  const values = new Map<string, string>();
  for (const product of products) {
    const value = product[field].trim().normalize("NFC");
    if (value && !values.has(value.toLowerCase())) values.set(value.toLowerCase(), value);
  }
  return [...values.values()].sort((left, right) => left.localeCompare(right, "vi"));
}

function attributeValue(value: string, options: string[]): string {
  const trimmed = value.trim().normalize("NFC");
  return options.find((option) => option.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
}

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

function ProductImage({ src, label, preview = false, previewLabel = label, onPreview }: { src: string; label: string; preview?: boolean; previewLabel?: string; onPreview?: () => void }) {
  const [failedSrc, setFailedSrc] = useState("");
  const imageSrc = String(src || "").trim();
  if (!imageSrc || failedSrc === imageSrc) {
    return <span className={preview ? "pos-product-image-empty" : "pos-product-image pos-product-image-empty"}>{label}</span>;
  }
  const image = <img className={preview ? undefined : "pos-product-image"} src={imageSrc} alt="" loading="lazy"
    onError={() => setFailedSrc(imageSrc)} />;
  if (!onPreview) return image;
  return <button type="button" className={`pos-product-image-trigger${preview ? " pos-product-image-trigger--preview" : ""}`}
    aria-label={previewLabel} title={previewLabel} onClick={(event) => { event.stopPropagation(); onPreview(); }}>{image}</button>;
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

type Tab = "sale" | "inventory" | "reports" | "register";
type CaptureProductDraft = Partial<{ name: string; sku: string; barcodes: string; supplier: string; image: string }>;

export default function App() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const [language, setLanguage] = useState<Language>(() => {
    const locale = localStorage.getItem("ui_locale");
    if (locale) return /^viet/i.test(locale) ? "vi" : "en";
    return localStorage.getItem("42trade-pos-language") === "en" ? "en" : "vi";
  });
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
  const [mobileNavigation, setMobileNavigation] = useState<"menu" | "bottom">(() => {
    try { return localStorage.getItem("42trade-pos-mobile-navigation") === "bottom" ? "bottom" : "menu"; }
    catch { return "menu"; }
  });
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
  const [scannerMode, setScannerMode] = useState<"barcode" | "recognize">("barcode");
  const [photoCamera, setPhotoCamera] = useState<"product" | "recognize" | null>(null);
  const productPhotoUpload = useRef<HTMLInputElement>(null);
  const [lastImageChange, setLastImageChange] = useState<{ sid: string; before: string; after: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<{ src: string; title: string } | null>(null);
  const isMobile = useIsMobile();
  const [detailOpen, setDetailOpen] = useState(() => window.innerWidth >= 768);
  const [catalogMode, setCatalogMode] = useState("table");
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPageSize, setCatalogPageSize] = useState(25);
  const [catalogSorting, setCatalogSorting] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  useEffect(() => { setCatalogPage(1); }, [tab, query, inventoryStatusFilter, inventoryCategoryFilter, inventorySupplierFilter, catalogPageSize, catalogSorting]);
  const [receipt, setReceipt] = useState<ReturnType<typeof fromServerSale> | null>(null);
  const [lastReceipt, setLastReceipt] = useState<ReturnType<typeof fromServerSale> | null>(null);
  const [printReceipt, setPrintReceipt] = useState(false);
  const [candidates, setCandidates] = useState<{ product_sid: string; name: string; retail_price_minor: number | null; score: number; explanation: string; matched_keywords?: string[]; confidence?: string }[]>([]);
  const [recognitionHints, setRecognitionHints] = useState<string[]>([]);
  const [recognitionDetails, setRecognitionDetails] = useState<ProductObservation | null>(null);
  const [recognitionImage, setRecognitionImage] = useState("");
  const [recognitionImageBackgroundRemoved, setRecognitionImageBackgroundRemoved] = useState(false);
  const [recognitionColors, setRecognitionColors] = useState<string[]>([]);
  const [recognitionKeywords, setRecognitionKeywords] = useState<string[]>([]);
  const [selectedRecognitionSid, setSelectedRecognitionSid] = useState("");
  const [recognizedIds, setRecognizedIds] = useState<string[] | null>(null);
  const recognitionRequest = useRef(0);
  const captureProductDraft = useRef<CaptureProductDraft>({});
  const [message, setMessageText] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "warning">("success");
  const [messageAddProduct, setMessageAddProduct] = useState(false);
  function setMessage(text: string, tone: "success" | "warning" = "success", addProduct = false) {
    setMessageText(text); setMessageTone(tone);
    setMessageAddProduct(addProduct);
  }
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

  useEffect(() => {
    const onGlobalLanguageChanged = (event: CustomEvent<{ language?: string }>) => {
      if (event.detail?.language === "en" || event.detail?.language === "vi") {
        setLanguage(event.detail.language);
      }
    };
    window.addEventListener("42trade-language-changed", onGlobalLanguageChanged as EventListener);
    return () => window.removeEventListener("42trade-language-changed", onGlobalLanguageChanged as EventListener);
  }, []);

  const changeLanguage = (nextLanguage: Language) => {
    const locale = nextLanguage === "vi" ? "Vietnamese" : "English";
    setLanguage(nextLanguage);
    localStorage.setItem("ui_locale", locale);
    window.dispatchEvent(new CustomEvent("42trade-language-changed", {
      detail: { language: nextLanguage, source: "pos" },
    }));
  };

  const localProducts = bootstrap?.snapshot.products || [];
  const usingOfflineCatalog = !online && !!bootstrap;
  const visibleProducts = online
    ? (tab === "sale" ? products.filter((product) => product.status === "ACTIVE") : products)
    : localProducts;
  const filtered = recognizedIds === null ? searchProducts(visibleProducts, query)
    : visibleProducts.filter((product) => recognizedIds.includes(product.sid));
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
  const productAttributeOptions = {
    category: attributeOptions(products, "category"),
    supplier: attributeOptions(products, "supplier"),
    unit: attributeOptions(products, "unit"),
  };
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
            setLastReceipt((current) => current?.receipt_id === sale.receipt_id
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

  async function checkout(print = false) {
    if (!cart.length) throw new Error("Cart is empty");
    const received = cashReceivedForCheckout(cash, total);
    if (!cash.trim()) setCash(String(received));
    if (!online && bootstrap) {
      const sale = await commitLocalSale(cart, received);
      const invoice = fromLocalSale(sale);
      setPrintReceipt(print); setReceipt(invoice); setLastReceipt(invoice);
      setCart([]); setCash("");
      await refreshLocal();
      setMessage(language === "vi" ? "Đã lưu giao dịch. Hóa đơn " + sale.receipt_id + " đang chờ đồng bộ." : "Cash sale saved locally. Receipt " + sale.receipt_id + " is pending sync.");
    } else if (online) {
      onlineCheckoutKey.current ||= crypto.randomUUID();
      const result = await posApi.checkout(onlineCheckoutKey.current, cart, received);
      const paid = result.sale as { receipt_id: string };
      const invoice = fromServerSale(result.sale as Record<string, unknown>);
      setPrintReceipt(print); setReceipt(invoice); setLastReceipt(invoice);
      setMessage(language === "vi" ? "Đã thanh toán. Hóa đơn " + paid.receipt_id : "Sale paid. Receipt " + paid.receipt_id);
      setCart([]); setCash(""); onlineCheckoutKey.current = null;
      await refreshOnline();
    } else throw new Error("Provision this register online before offline sales");
  }

  function selectProduct(product: Product) {
    setDetailOpen(true);
    setSelected(product);
    setForm({ sid: product.sid, name: product.name, sku: product.sku,
      barcodes: product.barcodes.join(", "), category: product.category, supplier: product.supplier, status: product.status,
      unit: product.unit, price: String(product.price_minor ?? ""), cost: String(product.cost_minor ?? ""),
      minStock: String(product.min_stock), vat: String(product.vat_rate_bps / 100), image: product.image });
    setAllocation(String(product.offline_available));
  }

  async function saveProduct() {
    const attributes = {
      category: attributeValue(form.category, productAttributeOptions.category),
      supplier: attributeValue(form.supplier, productAttributeOptions.supplier),
      unit: attributeValue(form.unit, productAttributeOptions.unit),
    };
    const result = await posApi.saveProduct({ ...form, ...attributes, cost_minor: form.cost === "" ? null : Number(form.cost),
      min_stock: Number(form.minStock), vat_rate_bps: Math.round(Number(form.vat) * 100),
      barcodes: form.barcodes.split(",").map((v) => v.trim()).filter(Boolean) });
    if (form.price) await posApi.setPrice(result.product.sid, Number(form.price));
    await refreshOnline();
    setSelected(result.product);
    setForm((current) => ({ ...current, ...attributes, sid: result.product.sid }));
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
    captureProductDraft.current = { sku: code, barcodes: code };
    recognitionRequest.current++; setRecognizedIds(null); setRecognitionDetails(null);
    setRecognitionImage(""); setRecognitionImageBackgroundRemoved(false); setRecognitionColors([]);
    setRecognitionKeywords([]); setSelectedRecognitionSid("");
    setScanner(false);
    setQuery(code);
    setError(""); setCandidates([]); setRecognitionHints([]);
    const notice = tr("Scanned code") + ": " + code + ". ";
    const matches = visibleProducts.filter((item) => item.sku === code || item.sid === code || item.barcodes.includes(code));
    if (matches.length > 1) {
      setCandidates(matches.map((item) => ({ product_sid: item.sid, name: item.name,
        retail_price_minor: item.price_minor, score: 1, explanation: "Barcode is shared; select the correct product." })));
      setMessage(notice + (language === "vi" ? "Mã vạch trùng nhiều sản phẩm. Hãy chọn đúng sản phẩm." : "This barcode matches multiple products. Choose the correct product."));
      return;
    }
    const product = matches[0];
    if (product && tab === "inventory") {
      selectProduct(product);
      setMessage(notice + tr("Opened") + " " + product.name);
    } else if (product) {
      addToCart(product);
      setMessage(notice + tr("Added") + " " + product.name);
    } else if (tab === "inventory") {
      startNewProduct({ sku: code, barcodes: code });
      setMessage(notice + tr("No match. Review the scanned code and create a product."), "warning");
    } else setMessage(notice + tr("No match for") + " " + code + ". " + tr("Add this product to inventory to sell it."), "warning", true);
  }, [visibleProducts, tab, language, inventoryCategoryFilter, inventorySupplierFilter]);

  function openScanner(mode: "barcode" | "recognize") {
    captureProductDraft.current = {};
    setMessage(""); setScannerMode(mode); setScanner(true);
  }

  function openProductCamera() {
    setPhotoCamera("product");
    void import("./productPhoto").then(({ warmProductPhoto }) => warmProductPhoto()).catch(() => {});
  }

  async function updateProductPhoto(file: File) {
    const target = { sid: form.sid, name: form.name, sku: form.sku, previous: products.find((product) => product.sid === form.sid)?.image ?? form.image };
    const { prepareProductPhoto } = await import("./productPhoto");
    const prepared = await prepareProductPhoto(file);
    if (target.sid && online) {
      await posApi.setProductImage(target.sid, prepared.image);
      setProducts((current) => current.map((product) => product.sid === target.sid ? { ...product, image: prepared.image } : product));
      setSelected((current) => current?.sid === target.sid ? { ...current, image: prepared.image } : current);
      setLastImageChange({ sid: target.sid, before: target.previous, after: prepared.image });
    }
    setForm((current) => current.sid === target.sid && (target.sid || (current.name === target.name && current.sku === target.sku)) ? { ...current, image: prepared.image } : current);
    setMessage(tr(target.sid && online ? "Product photo saved automatically." : "Photo ready. Save the product to finish.")
      + (prepared.backgroundRemoved ? "" : " " + tr("Background could not be removed; your photo was kept.")));
  }

  async function undoProductPhoto() {
    if (!lastImageChange) return;
    const change = lastImageChange;
    await posApi.setProductImage(change.sid, change.before);
    setProducts((current) => current.map((product) => product.sid === change.sid ? { ...product, image: change.before } : product));
    setSelected((current) => current?.sid === change.sid ? { ...current, image: change.before } : current);
    setForm((current) => current.sid === change.sid ? { ...current, image: change.before } : current);
    setLastImageChange(null);
  }

  async function recognizeFile(file: File) {
    const request = ++recognitionRequest.current;
    // Recognition keywords are names, not product numbers. Only use a decoded barcode as a code.
    captureProductDraft.current = { sku: "", barcodes: "" };
    setCandidates([]); setRecognitionHints([]); setMessage(""); setError(""); setRecognitionDetails(null); setRecognizedIds([]);
    setRecognitionImage(""); setRecognitionImageBackgroundRemoved(false); setRecognitionColors([]);
    setRecognitionKeywords([]); setSelectedRecognitionSid("");
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 4 * 1024 * 1024) {
      throw new Error("Choose a PNG, JPEG, or WebP under 4 MB");
    }
    try {
      const code = await readBarcodePhoto(file);
      if (request !== recognitionRequest.current) return;
      if (!code) throw new Error("No barcode in this photo");
      captureProductDraft.current = { sku: code, barcodes: code };
      const matches = visibleProducts.filter((item) => item.sid === code || item.sku === code || item.barcodes.includes(code));
      if (matches.length > 1) {
        setRecognizedIds(matches.map((item) => item.sid));
        setCandidates(matches.map((item) => ({ product_sid: item.sid, name: item.name,
          retail_price_minor: item.price_minor, score: 1, explanation: "Barcode is shared; select the correct product." })));
        setMessage(language === "vi" ? "Mã vạch trùng nhiều sản phẩm. Hãy chọn đúng sản phẩm." : "This barcode matches multiple products. Choose the correct product.");
        return;
      }
      const product = matches[0];
      if (product) {
        setRecognizedIds([product.sid]); setQuery(code);
        setCandidates([{ product_sid: product.sid, name: product.name,
          retail_price_minor: product.price_minor, score: 1, explanation: "Barcode or QR code in image" }]);
        return;
      }
    } catch { /* A product photo may have no machine-readable code. */ }
    if (!online) throw new Error("No known barcode found. Product-photo recognition needs an internet connection.");
    const { prepareRecognitionPhoto } = await import("./recognitionPhoto");
    const prepared = await prepareRecognitionPhoto(file, visibleProducts);
    if (request !== recognitionRequest.current) return;
    setRecognitionImage(prepared.capture_image);
    captureProductDraft.current.image = prepared.capture_image;
    setRecognitionImageBackgroundRemoved(prepared.background_removed);
    setRecognitionColors(prepared.colors.map((item) => item.color));
    const result = await posApi.recognizeImage({ image: prepared.image });
    if (request !== recognitionRequest.current) return;
    setRecognitionDetails(result.observed);
    const observed = result.observed;
    if (observed.product_name || observed.object_name) captureProductDraft.current.name = observed.product_name || observed.object_name;
    if (observed.brand) captureProductDraft.current.supplier = observed.brand;
    if (observed.barcode) {
      captureProductDraft.current.barcodes = observed.barcode;
      captureProductDraft.current.sku ||= observed.barcode;
    }
    const keywords = Array.isArray(result.keywords) ? result.keywords : [];
    setRecognitionKeywords(keywords);
    setRecognitionHints([...keywords, ...prepared.colors.map((item) => tr(item.color))]);
    if (result.keywords?.length) setQuery(result.keywords.join(" "));
    const available = result.candidates.filter((candidate) => visibleProducts.some((item) => item.sid === candidate.product_sid));
    setCandidates(available);
    setSelectedRecognitionSid(available[0]?.product_sid || "");
    setRecognizedIds(available.map((item) => item.product_sid));
    if (!available.length) setMessage(tr("No sufficiently matching product in inventory. Try a clearer label or scan the barcode."), "warning", true);
  }

  function clearRecognition() {
    recognitionRequest.current++;
    setRecognizedIds(null); setRecognitionDetails(null); setRecognitionImage("");
    setRecognitionImageBackgroundRemoved(false); setRecognitionColors([]); setRecognitionKeywords([]);
    setRecognitionHints([]); setSelectedRecognitionSid(""); setCandidates([]); setQuery(""); setMessage("");
  }

  async function matchCaptureToProduct() {
    const product = visibleProducts.find((item) => item.sid === selectedRecognitionSid);
    if (!product || !recognitionDetails || !recognitionImage) throw new Error("Select a product match and capture an image first");
    const searchKeywords = [...new Set([...(product.search_keywords || []), recognitionDetails.product_name,
      recognitionDetails.brand, ...recognitionKeywords, ...recognitionColors].map((value) => value.trim()).filter(Boolean))];
    const labelTexts = [...new Set([...(product.label_texts || []), ...recognitionDetails.texts].map((value) => value.trim()).filter(Boolean))];
    await posApi.saveProduct({ sid: product.sid, name: product.name, sku: product.sku, barcodes: product.barcodes,
      category: product.category, supplier: product.supplier, description: product.description || "", unit: product.unit,
      status: product.status, image: recognitionImage, cost_minor: product.cost_minor, min_stock: product.min_stock,
      vat_rate_bps: product.vat_rate_bps, search_keywords: searchKeywords, label_texts: labelTexts });
    setLastImageChange({ sid: product.sid, before: product.image, after: recognitionImage });
    await refreshOnline();
    setMessage(tr("Capture matched to inventory item"));
  }

  async function addCaptureAsProduct() {
    if (!recognitionDetails || !recognitionImage) throw new Error("Capture a product image first");
    if (!online) throw new Error("Connect to the internet to add a product");
    const name = recognitionDetails.product_name || recognitionDetails.object_name;
    if (!name) throw new Error("The capture does not have a readable product name");
    const product = await posApi.saveProduct({ name, sku: "POSIMG" + Date.now(),
      barcodes: recognitionDetails.barcode ? [recognitionDetails.barcode] : [], supplier: recognitionDetails.brand,
      unit: "cái", status: "ACTIVE", image: recognitionImage, cost_minor: null, min_stock: 0, vat_rate_bps: 0,
      description: recognitionDetails.texts.join(" · "), search_keywords: [...new Set([name, recognitionDetails.brand,
        ...recognitionKeywords, ...recognitionColors].filter(Boolean))], label_texts: recognitionDetails.texts });
    await refreshOnline();
    setTab("inventory");
    selectProduct(product.product);
    setMessage(tr("Product created from capture. Add a price and stock to sell it."));
  }

  function startNewProduct(draft: CaptureProductDraft = {}) {
    setSelected(null);
    const code = query.trim();
    setForm({ sid: "", name: "", sku: code, barcodes: code, category: inventoryCategoryFilter, supplier: inventorySupplierFilter,
      status: "ACTIVE", unit: "cái", price: "", cost: "", minStock: "0", vat: "0", image: "", ...draft });
    setStockDelta(""); setStockReason(""); setAllocation(""); setDetailOpen(true);
  }

  function openProductFromCapture() {
    const draft = { ...captureProductDraft.current };
    setScanner(false); setPhotoCamera(null); setTab("inventory"); setError("");
    clearRecognition(); startNewProduct(draft);
  }

  function selectSaleProduct(product: Product) {
    if (product.price_minor === null) { setMessage(tr("Price needed")); return; }
    addToCart(product);
  }

  const catalog = tab === "inventory" ? inventoryFiltered : filtered;
  const sortedCatalog = catalogSorting ? [...catalog].sort((a, b) => {
    const key = catalogSorting.key as keyof Product;
    const left = a[key]; const right = b[key];
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""), language, { numeric: true });
    return catalogSorting.dir === "desc" ? -order : order;
  }) : catalog;
  const catalogPages = Math.max(1, Math.ceil(catalog.length / catalogPageSize));
  const currentCatalogPage = Math.min(catalogPage, catalogPages);
  const pagedCatalog = sortedCatalog.slice((currentCatalogPage - 1) * catalogPageSize, currentCatalogPage * catalogPageSize);
  const catalogModes = [
    { value: "table", label: tr("Table") }, { value: "grid", label: tr("Grid") },
    { value: "cards", label: tr("Cards") }, { value: "carousel", label: tr("Carousel") },
  ];
  const productColumns = [
    { accessorKey: "name", header: tr("Products"), cell: ({ row: { original: product } }: ProductCell) =>
      <div className="pay42-cell-media"><ProductImage src={product.image} label={tr("No Image")} previewLabel={`${tr("View product image")}: ${product.name}`} onPreview={() => setImagePreview({ src: product.image, title: product.name })} />
        <div className="cell-wrap ui-data-stack"><strong className="ui-data-title">{product.name}</strong><span className="ui-data-meta">{product.sku || product.sid}</span></div></div> },
    { accessorKey: "category", header: tr("Category"), cell: ({ row }: ProductCell) => row.original.category || "—" },
    ...(tab === "inventory" ? [
      { accessorKey: "supplier", header: tr("Supplier"), cell: ({ row }: ProductCell) => row.original.supplier || "—" },
      { accessorKey: "status", header: tr("Status"), cell: ({ row }: ProductCell) => <span className={`badge badge-mini ${row.original.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"}`}>{tr(row.original.status === "ACTIVE" ? "Active" : "Inactive")}</span> },
    ] : []),
    { accessorKey: "price_minor", header: tr("Retail price (VND)"), cell: ({ row }: ProductCell) => row.original.price_minor === null ? <span className="minor-text">{tr("No Price")}</span> : <span className={row.original.price_minor === 0 ? "pos-zero-value" : undefined}>{money(row.original.price_minor, language)}</span> },
    { accessorKey: "on_hand", header: tr("Stock"), cell: ({ row }: ProductCell) => {
      const quantity = usingOfflineCatalog ? row.original.offline_available : row.original.on_hand;
      return <div className="ui-data-stack"><span className={quantity === 0 ? "pos-zero-value" : undefined}>{quantity} {row.original.unit}</span><span className="ui-data-meta">{tr("Reserved")} {row.original.allocated}</span></div>;
    } },
  ];
  const productCard = {
    getTitle: (product: Product) => <span className="pos-product-card-title"><StatusDisplay status={product.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"} title={tr(product.status === "ACTIVE" ? "Active" : "Inactive")} size="md" className="pos-product-status-icon" /><span>{product.name}</span></span>,
    getSubtitle: (product: Product) => product.sku || product.sid,
    getImageSrc: (product: Product) => product.image, getImageAlt: (product: Product) => product.name, getImageLabel: () => "—",
    getAmount: (product: Product) => ({ value: product.price_minor === null ? tr("No Price") : money(product.price_minor, language), tone: product.price_minor === 0 || product.price_minor === null ? "muted" : undefined }),
    getRows: (product: Product) => {
      const quantity = usingOfflineCatalog ? product.offline_available : product.on_hand;
      return [[{ value: product.category || "—" }, { value: `${tr("Stock")}: ${quantity} ${product.unit}`, tone: quantity === 0 ? "muted" : undefined }]];
    },
  };

  const attributeField = (field: "category" | "supplier" | "unit", label: string) => (
    <label className="pay42-form-field"><span className="ui-field-label">{tr(label)}</span>
      <InputComboSelect aria-label={tr(label)} value={form[field]} searchable allowCreate
        menuClassName="pos-product-attribute-menu"
        placeholder={tr("Select or enter a new value")} searchPlaceholder={tr("Search or enter a new value")}
        createLabel={tr("Add")} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}>
        {field !== "unit" && <option value="">{tr("None")}</option>}
        {form[field] && !productAttributeOptions[field].includes(form[field])
          && <option value={form[field]}>{form[field]}</option>}
        {productAttributeOptions[field].map((value) => <option key={value} value={value}>{value}</option>)}
      </InputComboSelect>
    </label>
  );

  const inventoryDetail = (<div className="pay42-form-grid pos-form">
          <label className="pay42-form-field pay42-form-field--full"><span className="ui-field-label">{tr("Name")}</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className="pay42-form-field"><span className="ui-field-label">{tr("Product number")}</span><input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} /></label>
          <label className="pay42-form-field"><span className="ui-field-label">{tr("Barcodes, comma separated")}</span><input value={form.barcodes} onChange={(event) => setForm({ ...form, barcodes: event.target.value })} /></label>
          <label className="pay42-form-field"><span className="ui-field-label">{tr("Status")}</span><InputComboSelect value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
            <option value="ACTIVE">{tr("Active")}</option><option value="ARCHIVED">{tr("Inactive")}</option>
          </InputComboSelect></label>
          {attributeField("unit", "Unit")}
          <label className="pay42-form-field"><span className="ui-field-label">{tr("Import price (VND)")}</span><input className={Number(form.cost) === 0 ? "pos-zero-value" : undefined} type="number" min="0" step="1" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} /></label>
          <label className="pay42-form-field"><span className="ui-field-label">{tr("Retail price (VND)")}</span><input className={Number(form.price) === 0 ? "pos-zero-value" : undefined} type="number" min="0" step="1" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
          <label className="pay42-form-field"><span className="ui-field-label">{tr("Minimum stock")}</span><input type="number" min="0" step="0.01" value={form.minStock} onChange={(event) => setForm({ ...form, minStock: event.target.value })} /></label>
          <label className="pay42-form-field"><span className="ui-field-label">{tr("Current Qty in Stock")}</span><input className={(selected ? (products.find((product) => product.sid === selected.sid)?.on_hand ?? selected.on_hand) : 0) === 0 ? "pos-zero-value" : undefined} type="number" value={selected ? (products.find((product) => product.sid === selected.sid)?.on_hand ?? selected.on_hand) : 0} readOnly aria-readonly="true" /></label>
          {attributeField("category", "Category")}
          {attributeField("supplier", "Provider")}
          <div className="pay42-form-field--full pos-product-image-field">
            <span className="ui-field-label">{tr("Image")}</span>
            <div className="pos-product-image-picker">
              <ProductImage src={form.image} label={tr("No Image")} preview previewLabel={`${tr("View product image")}: ${form.name}`} onPreview={() => setImagePreview({ src: form.image, title: form.name })} />
              <div className="stack-layout">
                <button type="button" className="primary-button" disabled={busy} onClick={openProductCamera}>{tr(form.image ? "Retake product photo" : "Take product photo")}</button>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => productPhotoUpload.current?.click()}>{tr("Choose existing photo")}</button>
                {lastImageChange?.sid === form.sid && <button type="button" className="secondary-button" disabled={busy || !online}
                  onClick={() => run(undoProductPhoto, "Previous photo restored.")}>{tr("Undo photo change")}</button>}
              </div>
            </div>
            <label className="pay42-form-field"><span className="ui-field-label">{tr("Image URL")}</span><input value={form.image} onChange={(event) => setForm({ ...form, image: event.target.value })} /></label>
          </div>
          <label className="pay42-form-field"><span className="ui-field-label">{tr("VAT added on top (%)")}</span><input type="number" min="0" max="100" step="0.01" value={form.vat} onChange={(event) => setForm({ ...form, vat: event.target.value })} /></label>
          <p className="minor-text pay42-form-field--full">{tr("New values are added to the lists when you save the product.")}</p>
          <button className="primary-button" disabled={!online || busy} onClick={() => run(saveProduct, "Product saved")}>{tr("Save product")}</button>
          {selected && <><hr/><h2>{tr("Stock")}</h2><p>{tr("On hand")} {selected.on_hand} {selected.unit} · {tr("Reserved")} {selected.allocated}</p>
            {selected.stock_import_warning && <p className="pos-error">{tr("Stock source not imported")}: {selected.source_on_hand}</p>}
            <label className="pay42-form-field"><span className="ui-field-label">{tr("Adjustment (+ receive, − remove)")}</span><input type="number" step="1" value={stockDelta} onChange={(event) => setStockDelta(event.target.value)} /></label>
            <label className="pay42-form-field"><span className="ui-field-label">{tr("Reason")}</span><input value={stockReason} onChange={(event) => setStockReason(event.target.value)} /></label>
            <button disabled={!online || busy} onClick={() => run(async () => { await posApi.adjustStock(selected.sid, Number(stockDelta), stockReason); await refreshOnline(); }, "Stock updated")}>{tr("Post stock adjustment")}</button>
            <hr/><h2>{tr("Offline allocation")}</h2><p>{tr("Available on this device:")} {selected.offline_available}</p>
            <label className="pay42-form-field"><span className="ui-field-label">{tr("Allocate to this device")}</span><input type="number" min="0" step="1" value={allocation} onChange={(event) => setAllocation(event.target.value)} /></label>
            <button disabled={!online || busy} onClick={() => run(async () => { await posApi.allocate(device, selected.sid, Number(allocation)); await provision(); }, "Allocation updated")}>{tr("Save allocation and refresh")}</button>
            <hr/><button className="danger-button" disabled={!online || busy} onClick={() => {
              if (confirm(tr("Archive this product?"))) run(async () => { await posApi.archiveProduct(selected.sid); await refreshOnline(); setSelected(null); setDetailOpen(false); }, "Product archived");
            }}>{tr("Archive product")}</button></>}
        </div>);
  const cartDetail = (<>{cartRows.map((row) => <div className="pos-cart-line" key={row.product_sid}>
          <div className="pos-cart-product">
            {row.product?.image && <ProductImage src={row.product.image} label={tr("No Image")} previewLabel={`${tr("View product image")}: ${row.product.name}`} onPreview={() => setImagePreview({ src: row.product!.image, title: row.product!.name })} />}
            <div className="pos-cart-product-text"><strong>{row.product?.name || row.product_sid}</strong>
              <small>{money(row.product?.price_minor || 0, language)} / {row.product?.unit || tr("each")}</small></div>
          </div>
          <div className="pos-cart-quantity"><button aria-label={tr("Decrease quantity")} onClick={() => setCart((items) => items.map((item) =>
            item.product_sid === row.product_sid ? { ...item, quantity: Math.max(0, item.quantity - 1) } : item).filter((item) => item.quantity))}>−</button>
            <span>{row.quantity}</span><button aria-label={tr("Increase quantity")} disabled={!row.product} onClick={() => row.product && addToCart(row.product)}>+</button></div>
        </div>)}
        {!cartRows.length && <p className="pos-muted">{tr("Scan or select a product to start a sale.")}</p>}
        <div className="pos-cart-bottom">
          {vat > 0 && <div className="pos-cart-tax"><div className="pos-row"><span>{tr("Subtotal")}</span><span>{money(subtotal, language)}</span></div>
            <div className="pos-row"><span>{tr("VAT")}</span><span>{money(vat, language)}</span></div></div>}
          <div className="pos-total"><span>{tr("Total")}</span><strong>{money(total, language)}</strong></div>
          <CashPayment cash={cash} total={total} language={language} online={online} disabled={busy} onCashChange={setCash} />
          <div className="pos-checkout-actions">
            <button className="primary-button" disabled={busy || !cart.length} onClick={() => run(() => checkout(), "")}>{tr("Pay")}</button>
            <button className="secondary-button" disabled={busy || !cart.length} onClick={() => run(() => checkout(true), "")}>{tr("Pay & print")}</button>
          </div>
          {lastReceipt && <button className="secondary-button pos-reprint" onClick={() => { setPrintReceipt(true); setReceipt(lastReceipt); }}>{tr("Reprint invoice")}</button>}
          {!online && <small className="pos-offline">{tr("Offline · saved on this device")}</small>}
        </div></>);
  const inventoryOperations = (<>{!!stockCountRows.length && <div className="pos-count-history"><h2>{tr("Stock counts")}</h2>{stockCountRows.slice(0, 10).map((count) => <button key={String(count.sid)} disabled={!online || busy || count.status === "POSTED"}
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
        </div>}</>);
  const inventoryImports = (<div className="stack-layout"><p className="pos-muted">{tr("Import CSV or XLSX. XLSX accepts the Vietnamese product export columns, including product number, barcode, name, category, unit, price, cost and stock.")}</p>
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
        </div>}</div>);

  const captureErrorAction = tab === "sale" ? <button type="button" className="secondary-button" disabled={busy}
    onClick={openProductFromCapture}>{tr("Add product")}</button> : undefined;

  return <section className={`pos-app pos-app--nav-${mobileNavigation} logs-page-container trades-page-container pay42-page-container stack-layout fadeIn`} lang={language}>
    <PageHeader className="trades-page-header pos-page-header" title="42Trade POS" actions={
      <div className="pos-header-actions">
        <span className="pos-muted">{tr("Main store")} · VND{import.meta.env.VITE_POS_DEMO === "1" ? " · DEMO" : ""}</span>
        <button className="secondary-button" aria-label={language === "vi" ? "Switch to English" : "Chuyển sang Tiếng Việt"} onClick={() => changeLanguage(language === "vi" ? "en" : "vi")}>{language === "vi" ? "English" : "Tiếng Việt"}</button>
        <span className={online ? "pos-online status-dot status-active" : "pos-offline status-dot status-warning"}>{tr(online ? "Online" : "Offline")}</span>
        <span>{pending.length} {tr("pending")}</span>
        {attention.length > 0 && <span className="pos-error status-dot status-danger">{attention.length} {tr("needs attention")}</span>}
      </div>
    } />
    <AdminPageToolbar className="trades-toolbar-panel pos-tabs-toolbar" actions={
      <ResponsiveSectionNav value={tab} onChange={setTab}
        items={(["sale", "inventory", "reports", "register"] as Tab[]).map((item) => ({
          value: item, label: tr(item[0].toUpperCase() + item.slice(1)),
        }))}
        label={tr("POS sections")} menuLabel={tr("Menu")} closeLabel={tr("Close")}
        mobilePlacement={mobileNavigation} onMobilePlacementChange={(placement: "menu" | "bottom") => {
          setMobileNavigation(placement);
          try { localStorage.setItem("42trade-pos-mobile-navigation", placement); } catch { /* Keep the current session preference. */ }
        }} placementLabel={tr("Mobile navigation")} menuOptionLabel={tr("Automatic menu")}
        bottomOptionLabel={tr("Bottom navigation")} />
    } />
    {error && <div className="pos-alert pos-error" role="alert">{error}
      {error.includes("AUTH_REQUIRED") && <> · <a href={signInHref()}>{tr("Sign in to 42Trade")}</a></>}
    </div>}
    {needRefresh && <div className="pos-alert pos-row" role="status"><span>{tr("A POS update is ready. Finish the current cart before reloading.")}</span>
      <button disabled={cart.length > 0 || busy} onClick={() => updateServiceWorker(true)}>{tr("Update POS")}</button></div>}
    {message && <div className={`pos-alert pos-row ${messageTone === "warning" ? "pos-warning" : "pos-success"}`} role="status">
      <span>{message}</span>
      {tab === "sale" && messageAddProduct && captureErrorAction}
    </div>}

    {(tab === "sale" || tab === "inventory") && <main className="pos-page-content stack-layout">
      {tab === "sale" && usingOfflineCatalog && <p className="minor-text">{tr("Refresh the register after price changes.")}</p>}
      {recognitionHints.length > 0 && <p className="minor-text" role="status">{tr("Detected keywords")}: {recognitionHints.join(" · ")}</p>}
      {recognizedIds !== null && <div className="card-flat pos-recognition-result" aria-label={tr("Image recognition result")}>
        <div className="pos-recognition-result__header">
          <strong>{recognitionDetails?.product_name || recognitionDetails?.object_name || tr("Recognition result")}</strong>
          <button type="button" className="secondary-button pos-recognition-result__close" aria-label={tr("Close")}
            title={tr("Close")} onClick={clearRecognition}>×</button>
        </div>
        {recognitionDetails && <>
          <div className="pos-recognition-capture">
            {recognitionImage && <button type="button" className="pos-recognition-capture__image"
              aria-label={tr("View captured product image")} onClick={() => setImagePreview({ src: recognitionImage, title: recognitionDetails.product_name || recognitionDetails.object_name })}>
              <img src={recognitionImage} alt={recognitionDetails.product_name || recognitionDetails.object_name} />
            </button>}
            <div className="pos-recognition-capture__details">
              <span><strong>{tr("Capture name")}:</strong> {recognitionDetails.product_name || recognitionDetails.object_name || tr("Unclear product")}</span>
              <span><strong>{tr("Keywords")}:</strong> {recognitionKeywords.join(" · ") || tr("No keywords detected")}</span>
              <span><strong>{tr("Label text")}:</strong> {recognitionDetails.texts.join(" · ") || tr("No label text detected")}</span>
              <span><strong>{tr("Price on label")}:</strong> {recognitionDetails.visible_price?.text || tr("No visible price")}</span>
              <span><strong>{tr("Capture color")}:</strong> {recognitionColors.map((color) => tr(color)).join(" · ") || tr("Unclear product")}</span>
              <small className="minor-text">{recognitionImageBackgroundRemoved ? tr("Background removed from capture") : tr("Capture kept with its original background")}</small>
            </div>
          </div>
          {recognitionDetails.brand && <span>{tr("Brand")}: {recognitionDetails.brand}</span>}
          <small className="minor-text">{tr("Register prices come from inventory.")}</small>
        </>}
        <div className="pos-row pos-recognition-actions">
          <button type="button" className="secondary-button" disabled={!selectedRecognitionSid}
            onClick={() => {
              const product = visibleProducts.find((item) => item.sid === selectedRecognitionSid);
              if (product) selectSaleProduct(product);
            }}>{tr("Add selected item to cart")}</button>
          <button type="button" className="primary-button" disabled={!online || busy || !selectedRecognitionSid || !recognitionImage}
            onClick={() => run(matchCaptureToProduct, "Capture matched to inventory item")}>{tr("Match and save image")}</button>
          <button type="button" className="secondary-button" disabled={!online || busy || !recognitionDetails?.product_name && !recognitionDetails?.object_name}
            onClick={() => run(addCaptureAsProduct, "Product created from capture. Add a price and stock to sell it.")}>{tr("Add as product")}</button>
          <button type="button" className="secondary-button" onClick={clearRecognition}>{tr("Clear / Close")}</button>
        </div>
      </div>}
      {candidates.length > 0 && <div className="pos-candidates" role="listbox" aria-label={tr("Potential inventory matches")}>
        <strong>{tr("Potential inventory matches")}</strong>
        {candidates.map((candidate) => {
          const product = visibleProducts.find((item) => item.sid === candidate.product_sid);
          return <button type="button" className={`pos-candidate${selectedRecognitionSid === candidate.product_sid ? " is-selected" : ""}`}
            aria-selected={selectedRecognitionSid === candidate.product_sid} key={candidate.product_sid}
            onClick={() => setSelectedRecognitionSid(candidate.product_sid)}>
            {product?.image ? <img className="pos-product-image" src={product.image} alt="" /> : <span className="pos-product-image pos-product-image-empty">{tr("No Image")}</span>}
            <span className="ui-data-stack"><strong>{candidate.name} · {product?.price_minor === null ? tr("No Price") : money(product?.price_minor || 0, language)}</strong>
              <small>{candidate.confidence === "high" ? tr("Strong label match") : tr("Please check the product")}{candidate.matched_keywords?.length ? " · " + candidate.matched_keywords.join(" · ") : ""}</small></span>
          </button>;
        })}
        </div>}
      <CrudContainer className="pay42-crud-layout"
        toolbar={{ displayMode: "top", filters: <div className="trades-toolbar-row"><div className="trades-toolbar-filters">
          <input aria-label={tr("Search products or scan a product number")} placeholder={tr("Search products or scan a product number")} value={query}
            onChange={(event) => { recognitionRequest.current++; setRecognizedIds(null); setRecognitionDetails(null); setRecognitionImage("");
              setMessage(""); captureProductDraft.current = {};
              setRecognitionImageBackgroundRemoved(false); setRecognitionColors([]); setRecognitionKeywords([]); setSelectedRecognitionSid("");
              setCandidates([]); setRecognitionHints([]); setQuery(event.target.value); }} onKeyDown={(event) => {
              if (event.key === "Enter" && query.trim()) { event.preventDefault(); scanned(query.trim()); }
            }} />
          {tab === "inventory" && <>
            <InputComboSelect aria-label={tr("Filter by status")} value={inventoryStatusFilter} onChange={(event) => setInventoryStatusFilter(event.target.value)}>
              <option value="ALL">{tr("All status")}</option><option value="ACTIVE">{tr("Active")}</option><option value="INACTIVE">{tr("Inactive")}</option>
              <option value="OUT_OF_STOCK">{tr("Out-of-Stock")}</option><option value="NO_PRICE">{tr("No Price")}</option><option value="NO_IMAGE">{tr("No Image")}</option>
            </InputComboSelect>
            <InputComboSelect aria-label={tr("Filter by category")} value={inventoryCategoryFilter || "ALL"} searchable onChange={(event) => setInventoryCategoryFilter(event.target.value === "ALL" ? "" : event.target.value)}>
              <option value="ALL">{tr("All categories")}</option>{inventoryCategories.map((category) => <option key={category} value={category}>{category}</option>)}
            </InputComboSelect>
            <InputComboSelect aria-label={tr("Filter by supplier")} value={inventorySupplierFilter || "ALL"} searchable onChange={(event) => setInventorySupplierFilter(event.target.value === "ALL" ? "" : event.target.value)}>
              <option value="ALL">{tr("All suppliers")}</option>{inventorySuppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
            </InputComboSelect>
          </>}
        </div></div>, actions: <>
          <button className="secondary-button" onClick={() => openScanner("barcode")}>{tr("Scan code")}</button>
          {tab === "sale" && <button type="button" className="secondary-button" onClick={() => openScanner("recognize")}>{tr("Recognize photo")}</button>}
          {tab === "inventory" && <>
            <button className="secondary-button" disabled={!online || busy} onClick={() => run(startStockCount, "Stock count started")}>{tr("Start stock count")}</button>
            <button className="primary-button" onClick={() => startNewProduct()}>{tr("New product")}</button>
          </>}
          <button className="secondary-button" aria-label={tr("Refresh products")} title={tr("Refresh products")} disabled={!online || busy} onClick={() => run(refreshOnline, "")}>↻</button>
        </> }}
        detailMode={tab === "inventory" && isMobile ? "modal" : "section"}
        detailOpen={tab === "sale" || detailOpen} onDetailOpenChange={setDetailOpen} detailCloseButton={tab === "inventory"} detailCloseButtonLabel={tr("Close detail panel")}
        list={{ title: `${catalog.length} ${tr("products")}`,
          subtitle: usingOfflineCatalog && bootstrap ? `${tr("Approved register prices from")} ${new Date(bootstrap.snapshot.issued_at).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}` : "",
          headerActions: <>
          <PaginationBar page={currentCatalogPage} pages={catalogPages} total={catalog.length} pageSize={catalogPageSize} pageSizeOptions={[10, 25, 50, 100]} onPageChange={setCatalogPage} onPageSizeChange={setCatalogPageSize} />
          <ComboButtonMenu selectId="pos-catalog-mode" value={catalogMode} buttonText={`${tr("Mode")}: ${catalogModes.find((item) => item.value === catalogMode)?.label}`}
            onChange={setCatalogMode} items={catalogModes} ariaLabel={tr("Select products view mode")} align="end" triggerClassName="data-table-mode-switcher" />
        </>, panelClassName: "component-frozen-wrap", tableProps: {
          columns: productColumns, data: pagedCatalog, emptyText: tr("No products match these filters."), className: "events-table events-table--compact events-table--products",
          mode: catalogMode, sorting: catalogSorting, onSortingChange: setCatalogSorting,
          onRowClick: tab === "inventory" ? selectProduct : selectSaleProduct,
          getRowId: (product: Product) => product.sid, selectedRowId: tab === "inventory" ? selected?.sid : null, mobileCard: productCard,
        } }}
        detail={tab === "inventory" ? { title: selected
          ? <span className="pos-product-detail-title"><StatusDisplay status={selected.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"} title={tr(selected.status === "ACTIVE" ? "Active" : "Inactive")} size="md" className="pos-product-status-icon" /><span>{selected.name}</span></span>
          : tr("New product"), children: inventoryDetail }
          : { title: tr("Cart"), subtitle: `${cartRows.length} ${tr("items")}`, className: "pos-cart", children: cartDetail }} />
      {tab === "inventory" && <>
        {(stockCount || stockCountRows.length > 0) && <ResponsivePanel title={tr("Stock counts")} showToggle={false} border="always">{inventoryOperations}</ResponsivePanel>}
        <ResponsivePanel title={tr("Import products")} border="always" defaultOpen={false}>{inventoryImports}</ResponsivePanel>
      </>}
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
        <DataTable className="events-table events-table--compact" data={serverSales.slice(0, 30)} getRowId={(sale: Record<string, unknown>) => String(sale.sid)} emptyText={tr("No synced sales yet.")}
          columns={[
            { accessorKey: "receipt_id", header: tr("Receipt") },
            { accessorKey: "sold_at", header: tr("Date"), cell: ({ row }: { row: { original: Record<string, unknown> } }) => new Date(String(row.original.sold_at)).toLocaleString(language === "vi" ? "vi-VN" : "en-US") },
            { accessorKey: "refund_status", header: tr("Status"), cell: ({ row }: { row: { original: Record<string, unknown> } }) => tr(String(row.original.refund_status || "PAID")) },
            { accessorKey: "total_minor", header: tr("Total"), cell: ({ row }: { row: { original: Record<string, unknown> } }) => money(Number(row.original.total_minor) || 0, language) },
            { id: "actions", header: tr("Actions"), cell: ({ row: { original: sale } }: { row: { original: Record<string, unknown> } }) => <div className="pay42-inline-actions">
              <button className="secondary-button" disabled={!online || busy || sale.refund_status === "REFUNDED" || sale.refund_status === "VOIDED"} onClick={() => selectSaleForReturn(sale)}>{tr("Return")}</button>
              <button className="danger-button" disabled={!online || busy || sale.refund_status === "REFUNDED" || sale.refund_status === "VOIDED"} onClick={() => {
                if (confirm(tr("Void the remaining refundable quantity and record a cash refund?"))) run(() => voidSelectedSale(sale), "Sale voided");
              }}>{tr("Void")}</button>
            </div> },
          ]} />
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
        <hr/><div className="pos-row"><h2>{tr("Report")}</h2><InputComboSelect value={reportGroup} onChange={(event) => setReportGroup(event.target.value)}>
          <option value="day">{tr("By day")}</option><option value="cashier">{tr("By cashier")}</option><option value="product">{tr("By product")}</option>
        </InputComboSelect><label>{tr("From")}<input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} /></label>
          <label>{tr("To")}<input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} /></label></div>
        <DataTable className="events-table events-table--compact" data={reportRows} getRowId={(row: { key: string }) => row.key} emptyText={tr("No sales in this period.")}
          columns={[
            { accessorKey: "key", header: tr(reportGroup === "cashier" ? "Cashier" : reportGroup === "product" ? "Products" : "Date") },
            { accessorKey: "sales_count", header: tr("Sales") }, { accessorKey: "quantity", header: tr("units") },
            { accessorKey: "vat_minor", header: "VAT", cell: ({ row }: { row: { original: { vat_minor: number } } }) => money(row.original.vat_minor, language) },
            { accessorKey: "gross_minor", header: tr("Total"), cell: ({ row }: { row: { original: { gross_minor: number } } }) => money(row.original.gross_minor, language) },
          ]} />
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
      <ResponsivePanel className="pos-panel" style={{ width: "auto" }} title={tr("Local receipts")} subtitle={`${sales.length} ${tr("receipts")}`} showToggle={false} border="always">
        <DataTable className="events-table events-table--compact" data={sales.slice().reverse()} getRowId={(sale: LocalSale) => sale.idempotency_key} emptyText={tr("No local receipts yet.")}
          onRowClick={(sale: LocalSale) => setReceipt(fromLocalSale(sale))} columns={[
            { accessorKey: "receipt_id", header: tr("Receipt") },
            { accessorKey: "sync_state", header: tr("Status"), cell: ({ row }: { row: { original: LocalSale } }) => <div className="ui-data-stack"><span>{tr(row.original.sync_state)}</span><span className="ui-data-meta">{row.original.sync_error || row.original.sold_at}</span></div> },
            { accessorKey: "total_minor", header: tr("Total"), cell: ({ row }: { row: { original: LocalSale } }) => money(row.original.total_minor, language) },
          ]} />
      </ResponsivePanel>
    </main>}
    <input ref={productPhotoUpload} className="pos-photo-upload" type="file" accept="image/png,image/jpeg,image/webp" aria-label={tr("Choose product photo")} onChange={(event) => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
      if (file) run(() => updateProductPhoto(file), "");
    }} />
    {photoCamera && <PhotoCamera language={language} purpose={photoCamera} onClose={() => { recognitionRequest.current++; setPhotoCamera(null); }}
      errorAction={photoCamera === "recognize" ? captureErrorAction : undefined}
      onCapture={async (file) => {
        setBusy(true);
        try { if (photoCamera === "product") await updateProductPhoto(file); else await recognizeFile(file); }
        finally { setBusy(false); }
      }} />}
    {scanner && <Scanner onCode={scanned} onClose={() => setScanner(false)} language={language} initialMode={scannerMode}
      errorAction={captureErrorAction}
      onRecognize={async (file) => {
        setBusy(true);
        try { await recognizeFile(file); }
        finally { setBusy(false); }
      }} />}
    {receipt && <Receipt receipt={receipt} autoPrint={printReceipt} onClose={() => { setReceipt(null); setPrintReceipt(false); }} language={language} />}
    {imagePreview && <MobileFullscreenModal open title={imagePreview.title || tr("Product image preview")} closeLabel={tr("Close")}
      className="pos-image-preview-modal" onClose={() => setImagePreview(null)}>
      <img className="pos-image-preview-modal__image" src={imagePreview.src} alt={imagePreview.title} />
    </MobileFullscreenModal>}
  </section>;
}
