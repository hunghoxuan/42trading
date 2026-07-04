"use strict";

function extractRawChatMessageText(rawMessage = {}) {
  if (typeof rawMessage?.content === "string") {
    return String(rawMessage.content || "").trim();
  }
  const parts = Array.isArray(rawMessage?.parts)
    ? rawMessage.parts
    : Array.isArray(rawMessage?.content)
      ? rawMessage.content
      : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text") return String(part.text || "");
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeCandidateSymbol(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function looksLikeTradeSymbol(value = "") {
  const symbol = normalizeCandidateSymbol(value);
  if (!symbol) return false;
  if (/^[A-Z]{2,10}(USD|USDT|EUR|GBP|JPY|AUD|NZD|CAD|CHF)$/.test(symbol)) {
    return true;
  }
  return /^(XAUUSD|XAGUSD|BTCUSD|ETHUSD|US30|NAS100|SPX500|GER40|UK100|USOIL|DXY)$/.test(
    symbol,
  );
}

function inferRequestedSymbolFromText(text = "") {
  const matches = String(text || "").match(/[A-Za-z0-9._/-]{3,20}/g) || [];
  for (const token of matches) {
    const symbol = normalizeCandidateSymbol(token);
    if (looksLikeTradeSymbol(symbol)) {
      return symbol;
    }
  }
  return "";
}

function buildFallbackTradeContextFromMessage(rawMessage = {}) {
  const text = extractRawChatMessageText(rawMessage);
  const symbol = inferRequestedSymbolFromText(text);
  if (!symbol) return null;
  return {
    symbol,
    inferred_from_user_message: true,
  };
}

module.exports = {
  buildFallbackTradeContextFromMessage,
  extractRawChatMessageText,
  inferRequestedSymbolFromText,
};
