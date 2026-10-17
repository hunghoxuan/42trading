export function normalizeSearch(value: unknown): string {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

type SearchableProduct = { name: string; sid: string; sku: string; category: string; supplier: string; barcodes: string[];
  description?: string; search_keywords?: string[]; label_texts?: string[] };

// Spaces, OR, | and commas all mean "match any word"; better matches come first.
export function searchProducts<T extends SearchableProduct>(products: T[], query: string): T[] {
  const phrase = normalizeSearch(query).trim();
  const words = [...new Set(phrase.split(/\s+|[|,;]+/).filter((word) => word && word !== "or"))];
  if (!words.length) return products;
  return products.map((product, index) => {
    const name = normalizeSearch(product.name);
    const codes = [product.sid, product.sku, ...product.barcodes].map(normalizeSearch);
    const fields = [name, ...codes, normalizeSearch(product.category), normalizeSearch(product.supplier),
      normalizeSearch(product.description), ...(product.search_keywords || []).map(normalizeSearch),
      ...(product.label_texts || []).map(normalizeSearch)];
    const matched = words.filter((word) => fields.some((value) => value.includes(word)));
    const score = matched.length * 10 + (name.includes(phrase) ? 15 : 0) + (words.some((word) => codes.includes(word)) ? 100 : 0)
      + matched.filter((word) => name.includes(word)).length;
    return { product, index, score, found: matched.length > 0 };
  }).filter((item) => item.found).sort((a, b) => b.score - a.score || a.index - b.index).map((item) => item.product);
}
