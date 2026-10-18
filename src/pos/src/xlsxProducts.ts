import type { Product } from "./storage";
import { sendToAndroid } from "./androidBridge";

export type ProductImportRow = {
  row_number: number;
  sku: string;
  name: string;
  barcodes: string[];
  category: string;
  supplier: string;
  unit: string;
  family_sku: string;
  group_code: string;
  price_minor: unknown;
  cost_minor: unknown;
  min_stock: unknown;
  vat_rate_bps: number;
  source_on_hand: unknown;
  opening_stock: unknown;
};

function normalizedHeader(value: unknown): string {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sourceValue(row: Record<string, unknown>, aliases: string[]): unknown {
  const keys = new Map(Object.entries(row).map(([key, value]) => [normalizedHeader(key), value]));
  for (const alias of aliases) {
    const value = keys.get(normalizedHeader(alias));
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function cellText(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function numberCell(value: unknown): number | string {
  if (value === "" || value === null || value === undefined) return "";
  const result = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(result) ? result : String(value);
}

export async function parseXlsxProducts(file: File): Promise<ProductImportRow[]> {
  if (file.size > 10 * 1024 * 1024) throw new Error("XLSX file must be under 10 MB");
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheet = workbook.Sheets.Product || workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Workbook has no product sheet");
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  if (rawRows.length > 10000) throw new Error("Import at most 10,000 products at a time");
  const output: ProductImportRow[] = [];
  for (const [index, raw] of rawRows.entries()) {
    const sku = cellText(sourceValue(raw, ["sku", "product_number", "product_code", "Mã sản phẩm"]));
    const name = cellText(sourceValue(raw, ["name", "product_name", "Tên sản phẩm"]));
    if (!sku && !name && Object.values(raw).every((value) => value === "" || value === null)) continue;
    const barcode = cellText(sourceValue(raw, ["barcode", "barcodes", "Mã vạch"]));
    const sourceOnHand = numberCell(sourceValue(raw, ["source_on_hand", "on_hand", "On hand", "stock", "Tồn kho", "Số lượng tồn đầu"]));
    const price = numberCell(sourceValue(raw, ["price_minor", "retail_price", "price", "Price VND", "Giá"]));
    const cost = numberCell(sourceValue(raw, ["cost_minor", "cost", "Cost VND", "purchase_price", "Giá nhập hàng", "Giá vốn"]));
    const openingStock = typeof sourceOnHand === "number" && Number.isSafeInteger(sourceOnHand) && sourceOnHand >= 0
      ? sourceOnHand : "";
    output.push({
      row_number: index + 2,
      sku,
      name,
      barcodes: barcode ? [barcode] : [],
      category: cellText(sourceValue(raw, ["category", "group_name", "Tên nhóm sản phẩm"])),
      supplier: cellText(sourceValue(raw, ["supplier", "vendor", "supplier_name", "Nhà cung cấp", "Tên nhà cung cấp"])),
      unit: cellText(sourceValue(raw, ["unit", "unit_name", "Đơn vị tính"])) || "each",
      family_sku: cellText(sourceValue(raw, ["family_sku", "Mã sản phẩm cùng loại"])),
      group_code: cellText(sourceValue(raw, ["group_code", "Mã nhóm sản phẩm"])),
      price_minor: price,
      cost_minor: cost,
      min_stock: numberCell(sourceValue(raw, ["min_stock", "minimum_stock", "Minimum stock", "Tồn kho tối thiểu"])),
      vat_rate_bps: Number(numberCell(sourceValue(raw, ["vat_rate_bps"])) || 0),
      source_on_hand: sourceOnHand,
      opening_stock: openingStock,
    });
  }
  if (!output.length) throw new Error("No product rows found in workbook");
  return output;
}

export async function downloadProductsXlsx(products: Product[]): Promise<void> {
  const XLSX = await import("xlsx");
  const rows = products.map((product) => ({
    SKU: product.sku,
    "Product name": product.name,
    Barcodes: product.barcodes.join("|"),
    Category: product.category,
    Supplier: product.supplier,
    Unit: product.unit,
    "Price VND": product.price_minor ?? "",
    "Cost VND": product.cost_minor ?? "",
    "VAT rate (bps)": product.vat_rate_bps,
    "On hand": product.on_hand,
    "Minimum stock": product.min_stock,
    "Source stock": product.source_on_hand ?? "",
    "Stock needs review": product.stock_import_warning ? "YES" : "",
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Products");
  const filename = `42trade-pos-products-${new Date().toISOString().slice(0, 10)}.xlsx`;
  if (sendToAndroid(() => ({ type: "saveFile", filename,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: XLSX.write(workbook, { type: "base64", bookType: "xlsx" }) as string }))) return;
  XLSX.writeFileXLSX(workbook, filename);
}
