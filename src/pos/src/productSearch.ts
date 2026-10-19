import type { ProductObservation } from "./api";

export function normalizeSearch(value: unknown): string {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

// Canonical phrases match English labels to Vietnamese catalog names without
// adding a long list of translated words to the search box.
export function canonicalSearch(value: unknown): string {
  return normalizeSearch(value)
    .replace(/\bhand[\s-]*(?:saniti[sz]er|santizi?er|sanitzer)\b|\b(?:nuoc|gel|dung dich)\s+(?:rua tay kho|sat khuan(?: tay)?)\b/g, "sat khuan tay")
    .replace(/\bhand\s*(?:wash|soap)\b/g, "nuoc rua tay")
    .replace(/\bbody\s*wash\b|\bshower\s*gel\b/g, "sua tam")
    .replace(/\bshampoo\b/g, "dau goi")
    .replace(/\btoothpaste\b/g, "kem danh rang")
    .replace(/\bsoap\b/g, "xa phong");
}

export function recognitionSearchTerms(observed: ProductObservation | null): string[] {
  if (!observed) return [];
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const brand = clean(observed.brand || "");
  const withoutType = (value: string) => canonicalSearch(value)
    .replace(/\b(?:sat khuan tay|nuoc rua tay|sua tam|dau goi|kem danh rang|xa phong)\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|kg|g|l|%)\b/g, " ")
    .replace(/\b(?:hand|saniti[sz]er|santizi?er|sanitzer|unknown|unreadable|none|null|n\/?a)\b/g, " ");
  if (brand) {
    const identity = clean(withoutType(brand));
    if (identity) {
      // Preserve readable brand spelling while dropping a product type that the
      // recognizer accidentally included in the brand field.
      const words = new Set(identity.split(/\s+/));
      const label = brand.split(/\s+/).filter(word => words.has(normalizeSearch(word))).join(" ");
      return [label || identity];
    }
  }
  // A generic object, package size, color or advertising claim is not an identity.
  const name = withoutType(observed.product_name)
    .replace(/\b(?:the|and|for|with|new|bottle|product|antibacterial|sanitizer|hand|chinh hang|san pham|diet khuan|bao ve|chai|moi|red|white|blue|green|do|trang|xanh)\b/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ");
  return [...new Set(name.split(/\s+/).filter(word => word.length >= 3 && !/^\d/.test(word)))].slice(0, 3);
}

type SearchableProduct = { name: string; sid: string; sku: string; category: string; supplier: string; barcodes: string[];
  description?: string; search_keywords?: string[]; label_texts?: string[] };

const GENERIC_SEARCH_WORDS = new Set("nuoc rua tay sat khuan sua tam dau goi kem danh rang xa phong hand sanitizer body wash shower gel shampoo soap toothpaste new bottle product red white blue green do trang xanh".split(" "));

// Spaces, OR, | and commas all mean "match any word"; better matches come first.
export function searchProducts<T extends SearchableProduct>(products: T[], query: string): T[] {
  const phrase = normalizeSearch(query).trim();
  const canonicalPhrase = canonicalSearch(phrase);
  const words = [...new Set(canonicalPhrase.split(/\s+|[|,;]+/).filter((word) => word && word !== "or"))];
  if (!words.length) return products;
  const distinctive = words.filter(word => !GENERIC_SEARCH_WORDS.has(word));
  const ranked = products.map((product, index) => {
    const name = normalizeSearch(product.name);
    const codes = [product.sid, product.sku, ...product.barcodes].map(normalizeSearch);
    const fields = [name, ...codes, normalizeSearch(product.category), normalizeSearch(product.supplier),
      normalizeSearch(product.description), ...(product.search_keywords || []).map(normalizeSearch),
      ...(product.label_texts || []).map(normalizeSearch)].map(canonicalSearch);
    const matched = words.filter((word) => fields.some((value) => value.includes(word)));
    const exactCode = codes.includes(phrase);
    const identityMatches = matched.filter(word => distinctive.includes(word)).length;
    const score = identityMatches * 80 + matched.length * 10 + (canonicalSearch(name).includes(canonicalPhrase) ? 15 : 0) + (exactCode || words.some((word) => codes.includes(word)) ? 1000 : 0)
      + matched.filter((word) => name.includes(word)).length;
    return { product, index, score, identityMatches, exactCode, found: exactCode || matched.length > 0 };
  });
  const hasIdentityMatch = ranked.some(item => item.identityMatches > 0);
  return ranked.filter(item => item.found && (!hasIdentityMatch || item.identityMatches > 0 || item.exactCode))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.product);
}
