import type { ProductObservation } from "./api";
import type { Product } from "./storage";
import type { ProductForm } from "./workspace";

export function productToForm(product: Product): ProductForm {
  return { sid: product.sid, name: product.name, sku: product.sku, barcodes: product.barcodes.join(", "),
    category: product.category, supplier: product.supplier, status: product.status, unit: product.unit,
    price: String(product.price_minor ?? ""), cost: String(product.cost_minor ?? ""), minStock: String(product.min_stock),
    vat: String(product.vat_rate_bps / 100), image: product.image };
}

export function recognitionToForm(product: Product | null, observed: ProductObservation | null, image: string,
  defaults: { category: string; supplier: string }, newSku: string): ProductForm {
  const form: ProductForm = product ? productToForm(product) : {
    sid: "", name: "", sku: "", barcodes: "", category: defaults.category, supplier: defaults.supplier,
    status: "ACTIVE", unit: "cái", price: "", cost: "", minStock: "0", vat: "0", image: "",
  };
  const codes = [...new Set([...form.barcodes.split(","), observed?.barcode || ""].map(value => value.trim()).filter(Boolean))];
  const visiblePrice = observed?.visible_price;
  return { ...form,
    name: form.name || observed?.product_name || observed?.object_name || "",
    sku: form.sku || observed?.barcode || newSku,
    barcodes: codes.join(", "), supplier: form.supplier || observed?.brand || "",
    image: image || form.image,
    // Catalog values remain authoritative. A visible VND price can prefill a new product for review.
    price: !product && visiblePrice?.currency === "VND" && Number.isSafeInteger(visiblePrice.amount) && visiblePrice.amount! >= 0
      ? String(visiblePrice.amount) : form.price,
  };
}

export function recognitionMetadata(product: Product | null, observed: ProductObservation | null, keywords: string[], colors: string[]) {
  const unique = (items: (string | undefined)[]) => [...new Set(items.map(value => value?.trim()).filter(Boolean))];
  const texts = unique([...(product?.label_texts || []), ...(observed?.texts || [])]);
  return { description: product?.description || texts.join(" · "), label_texts: texts,
    search_keywords: unique([...(product?.search_keywords || []), observed?.product_name, observed?.brand, ...keywords, ...colors]) };
}
