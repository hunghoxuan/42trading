"use strict";

function normalizeTradeFolderSymbol(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9_-]+:/, "")
    .replace(/[^A-Z0-9]/g, "");
}

function looksLikeTradeRefSymbol(value = "") {
  const sym = normalizeTradeFolderSymbol(value);
  return Boolean(sym) && /[A-Z]/.test(sym) && sym.length >= 3;
}

function extractSymbolFromTradeRef(value = "") {
  const ref = String(value || "").trim();
  const lastDash = ref.lastIndexOf("-");
  if (lastDash <= 0 || lastDash >= ref.length - 1) return "";
  const suffix = ref.slice(lastDash + 1);
  return looksLikeTradeRefSymbol(suffix)
    ? normalizeTradeFolderSymbol(suffix)
    : "";
}

function normalizeTradeFolderSid(value = "", symbol = "") {
  let safeSid = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_");
  if (!safeSid) return "";
  const suffixSymbol =
    normalizeTradeFolderSymbol(symbol) || extractSymbolFromTradeRef(safeSid);
  if (suffixSymbol && safeSid.endsWith(`-${suffixSymbol}`)) {
    safeSid = safeSid.slice(0, -(suffixSymbol.length + 1));
  }
  return safeSid;
}

module.exports = {
  extractSymbolFromTradeRef,
  normalizeTradeFolderSid,
  normalizeTradeFolderSymbol,
};
