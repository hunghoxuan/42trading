import type { SaleLine } from "./storage";

export type ProductForm = {
  sid: string; name: string; sku: string; barcodes: string; category: string; supplier: string;
  status: string; unit: string; price: string; cost: string; minStock: string; vat: string; image: string;
};
export type PosWorkspace = {
  tab: "sale" | "inventory" | "reports" | "register";
  query: string; inventoryStatusFilter: string; inventoryCategoryFilter: string; inventorySupplierFilter: string;
  cart: SaleLine[]; cash: string; checkoutKey: string | null;
  form: ProductForm; selectedSid: string; detailOpen: boolean;
  catalogMode: string; catalogPage: number; catalogPageSize: number;
  catalogSorting: { key: string; dir: "asc" | "desc" } | null;
  reportGroup: string; reportFrom: string; reportTo: string;
  stockDelta: string; stockReason: string; allocation: string; openingCash: string; countedCash: string;
};

export function emptyWorkspace(): PosWorkspace {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  return {
    tab: "sale", query: "", inventoryStatusFilter: "ALL", inventoryCategoryFilter: "", inventorySupplierFilter: "",
    cart: [], cash: "", checkoutKey: null, selectedSid: "", detailOpen: false,
    form: { sid: "", name: "", sku: "", barcodes: "", category: "", supplier: "", status: "ACTIVE", unit: "cái",
      price: "", cost: "", minStock: "0", vat: "0", image: "" },
    catalogMode: "table", catalogPage: 1, catalogPageSize: 25, catalogSorting: null,
    reportGroup: "day", reportFrom: today, reportTo: today,
    stockDelta: "", stockReason: "", allocation: "", openingCash: "", countedCash: "",
  };
}

export function workspaceKey(userId: string, deviceId: string): string {
  return `42trade-pos-workspace-v1:${encodeURIComponent(userId)}:${encodeURIComponent(deviceId)}`;
}

// Restore only known fields. Transient errors, camera permissions and server prices are never restored.
export function parseWorkspace(raw: string | null): PosWorkspace {
  const result = emptyWorkspace();
  if (!raw) return result;
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !value.state || typeof value.state !== "object") return result;
    const saved = value.state;
    for (const key of Object.keys(result) as (keyof PosWorkspace)[]) {
      if (typeof result[key] === "string" && typeof saved[key] === "string") {
        Object.assign(result, { [key]: saved[key] });
      }
    }
    if (!["sale", "inventory", "reports", "register"].includes(result.tab)) result.tab = "sale";
    result.cart = Array.isArray(saved.cart) ? saved.cart.filter((line: SaleLine) => line && typeof line.product_sid === "string"
      && Number.isSafeInteger(line.quantity) && line.quantity > 0).map((line: SaleLine) => ({ product_sid: line.product_sid, quantity: line.quantity })) : [];
    result.checkoutKey = typeof saved.checkoutKey === "string" ? saved.checkoutKey : null;
    if (saved.form && typeof saved.form === "object") {
      for (const key of Object.keys(result.form) as (keyof ProductForm)[]) {
        if (typeof saved.form[key] === "string") result.form[key] = saved.form[key];
      }
    }
    result.detailOpen = saved.detailOpen === true;
    if (Number.isSafeInteger(saved.catalogPage) && saved.catalogPage > 0) result.catalogPage = saved.catalogPage;
    if ([10, 25, 50, 100].includes(saved.catalogPageSize)) result.catalogPageSize = saved.catalogPageSize;
    if (saved.catalogSorting && typeof saved.catalogSorting.key === "string" && ["asc", "desc"].includes(saved.catalogSorting.dir)) {
      result.catalogSorting = { key: saved.catalogSorting.key, dir: saved.catalogSorting.dir };
    }
    return result;
  } catch { return result; }
}

export function readWorkspace(storage: Storage, key: string): PosWorkspace {
  const state = parseWorkspace(storage.getItem(key));
  state.form.image = storage.getItem(`${key}:image`) || "";
  return state;
}

export function writeWorkspace(storage: Storage, key: string, state: PosWorkspace): void {
  // Keep large product photos separate, so typing a field does not rewrite an image.
  const imageKey = `${key}:image`;
  if (storage.getItem(imageKey) !== (state.form.image || null)) {
    if (state.form.image) storage.setItem(imageKey, state.form.image);
    else storage.removeItem(imageKey);
  }
  storage.setItem(key, JSON.stringify({ version: 1, state: { ...state, form: { ...state.form, image: "" } } }));
}
