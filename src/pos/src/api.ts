import type { Bootstrap, LocalSale, Product, SaleLine } from "./storage";

type ApiResult = { ok: boolean; error?: string };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function call<T extends ApiResult>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json() as T;
  if (!response.ok || !result.ok) throw new ApiError(result.error || "Request failed", response.status);
  return result;
}

export const posApi = {
  auth: () => call<ApiResult & { user: { user_id: string; name?: string; roles?: string[] } }>("/auth/me?hydrate=0"),
  products: (deviceId = "") => call<ApiResult & { items: Product[] }>("/api/pos/products" + (deviceId ? "?device_id=" + encodeURIComponent(deviceId) : "")),
  saveProduct: (product: Record<string, unknown>) => call<ApiResult & { product: Product }>(
    product.sid ? "/api/pos/products/" + encodeURIComponent(String(product.sid)) : "/api/pos/products",
    product.sid ? "PATCH" : "POST", product),
  archiveProduct: (sid: string) => call<ApiResult>("/api/pos/products/" + encodeURIComponent(sid) + "/archive", "POST", {}),
  setPrice: (product_sid: string, price_minor: number) => call<ApiResult>("/api/pos/prices", "PUT", { product_sid, price_minor }),
  adjustStock: (product_sid: string, delta: number, reason: string) => call<ApiResult>("/api/pos/stock/movements", "POST", { product_sid, delta, reason }),
  createStockCount: () => call<ApiResult & { count: Record<string, unknown> }>("/api/pos/stock/counts", "POST", {}),
  stockCounts: () => call<ApiResult & { items: Record<string, unknown>[] }>("/api/pos/stock/counts"),
  submitStockCount: (sid: string, lines: { product_sid: string; counted_on_hand: number }[]) => call<ApiResult & { count: Record<string, unknown> }>(
    "/api/pos/stock/counts/" + encodeURIComponent(sid) + "/submit", "POST", { lines }),
  postStockCount: (sid: string, reason: string) => call<ApiResult & { count: Record<string, unknown> }>(
    "/api/pos/stock/counts/" + encodeURIComponent(sid) + "/post", "POST", { reason }),
  pair: (device_id: string) => call<ApiResult>("/api/pos/devices/pair", "POST", { device_id }),
  allocate: (device_id: string, product_sid: string, quantity: number) => call<ApiResult>(
    "/api/pos/offline/allocations", "PUT", { device_id, product_sid, quantity }),
  bootstrap: (deviceId: string) => call<ApiResult & Bootstrap>("/api/pos/offline/bootstrap?device_id=" + encodeURIComponent(deviceId)),
  syncSale: (sale: LocalSale) => call<ApiResult & { sale: unknown; duplicate: boolean }>(
    "/api/pos/offline/sales/sync", "POST", { device_id: sale.device_id, grant: sale.grant, sale }),
  checkout: (idempotency_key: string, lines: SaleLine[], cash_received_minor: number) => call<ApiResult & { sale: unknown }>(
    "/api/pos/sales/checkout", "POST", { idempotency_key, lines, cash_received_minor }),
  recognizeImage: (image: string) => call<ApiResult & { candidates: {
    product_sid: string; name: string; image: string; retail_price_minor: number | null;
    vat_rate_bps: number; score: number; explanation: string;
  }[] }>("/api/pos/images/recognize", "POST", { image }),
  sales: () => call<ApiResult & { items: unknown[] }>("/api/pos/sales"),
  refundSale: (saleSid: string, reason: string, lines: { product_sid: string; quantity: number; restock: boolean }[],
    idempotencyKey: string) => call<ApiResult>("/api/pos/sales/" + encodeURIComponent(saleSid) + "/returns", "POST",
    { idempotency_key: idempotencyKey, reason, lines }),
  voidSale: (saleSid: string, reason: string, idempotencyKey: string) => call<ApiResult>(
    "/api/pos/sales/" + encodeURIComponent(saleSid) + "/void", "POST", { idempotency_key: idempotencyKey, reason }),
  shifts: () => call<ApiResult & { items: Record<string, unknown>[] }>("/api/pos/shifts"),
  openShift: (opening_cash_minor: number) => call<ApiResult>("/api/pos/shifts/open", "POST", { opening_cash_minor }),
  closeShift: (sid: string, counted_cash_minor: number, pending_count: number) => call<ApiResult>(
    "/api/pos/shifts/" + encodeURIComponent(sid) + "/close", "POST", { counted_cash_minor, pending_count }),
  dashboard: () => call<ApiResult & { gross_minor: number; net_minor: number; refunds_minor: number; sales_count: number; low_stock: unknown[] }>("/api/pos/dashboard"),
  previewImport: (csv: string) => call<ApiResult & { count: number; errors: string[]; preview: Record<string, unknown>[] }>(
    "/api/pos/imports/preview", "POST", { csv }),
  commitImport: (csv: string) => call<ApiResult & { run: { count: number }; duplicate: boolean }>(
    "/api/pos/imports", "POST", { csv }),
  reportSales: (groupBy: string, from = "", to = "") => call<ApiResult & { items: {
    key: string; sales_count: number; quantity: number; base_minor: number; vat_minor: number; gross_minor: number;
  }[] }>("/api/pos/reports/sales?" + new URLSearchParams({ group_by: groupBy, from, to })),
};
