"use strict";

function resolveUiSessionSameSite(req = {}) {
  const origin = String(req?.headers?.origin || req?.headers?.referer || "");
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(origin)) {
    return "Lax";
  }
  return "Lax";
}

module.exports = {
  resolveUiSessionSameSite,
};
