export function parseTradePriceNumber(value) {
  if (value == null) return null;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return parseTradePriceNumber(value.price ?? value.value ?? value.level);
  }
  const numeric = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

export function countTradePriceDecimals(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const normalized = numeric.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  const dotIndex = normalized.indexOf(".");
  return dotIndex >= 0 ? normalized.length - dotIndex - 1 : 0;
}

export function resolveTradePricePrecision(symbol = "", values = []) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const base = normalizedSymbol.slice(0, 3);
  const quote = normalizedSymbol.endsWith("USDT")
    ? "USDT"
    : normalizedSymbol.slice(-3);
  const forexCurrencies = new Set([
    "USD",
    "EUR",
    "GBP",
    "JPY",
    "AUD",
    "CAD",
    "CHF",
    "NZD",
    "SGD",
    "HKD",
    "CNH",
    "NOK",
    "SEK",
    "DKK",
    "ZAR",
    "TRY",
    "MXN",
    "PLN",
    "CZK",
    "HUF",
  ]);
  if (
    (quote === "USD" || quote === "USDT") &&
    normalizedSymbol &&
    !forexCurrencies.has(base)
  ) {
    return 2;
  }
  if (
    /^[A-Z]{6}$/.test(normalizedSymbol) &&
    forexCurrencies.has(base) &&
    forexCurrencies.has(quote)
  ) {
    return normalizedSymbol.endsWith("JPY") ? 3 : 5;
  }
  if (
    normalizedSymbol.startsWith("XAU") ||
    normalizedSymbol.startsWith("XAG")
  ) {
    return 2;
  }
  if (
    normalizedSymbol.startsWith("UK") ||
    normalizedSymbol.startsWith("US") ||
    normalizedSymbol.startsWith("DE") ||
    normalizedSymbol.startsWith("JP") ||
    normalizedSymbol.startsWith("AU")
  ) {
    return 3;
  }
  if (
    normalizedSymbol.endsWith("USD") ||
    normalizedSymbol.endsWith("USDT")
  ) {
    return 2;
  }
  let precision = 0;
  for (const value of Array.isArray(values) ? values : []) {
    precision = Math.max(precision, countTradePriceDecimals(value));
  }
  return Math.min(Math.max(precision, 0), 8);
}

export function formatTradePrice(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  const safePrecision = Math.min(Math.max(Number(precision) || 0, 0), 8);
  return numeric.toFixed(safePrecision);
}

export function formatTradePriceField(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return formatTradePrice(numeric, precision);
}
