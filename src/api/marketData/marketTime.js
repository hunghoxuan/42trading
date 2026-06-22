"use strict";

function parseTimeToUnixSec(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  const explicitMs = Date.parse(s);
  const hasExplicitZone = /(?:z|[+-]\d{2}:\d{2}|[+-]\d{4})$/i.test(s);
  if (Number.isFinite(explicitMs) && hasExplicitZone) {
    return Math.floor(explicitMs / 1000);
  }

  const utcCandidate = s.includes("T")
    ? `${s.replace(/\s+/g, "")}Z`
    : `${s.replace(" ", "T")}Z`;
  const utcMs = Date.parse(utcCandidate);
  if (Number.isFinite(utcMs)) {
    return Math.floor(utcMs / 1000);
  }

  if (Number.isFinite(explicitMs)) {
    return Math.floor(explicitMs / 1000);
  }
  return null;
}

function formatUnixSecForProvider(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Date(sec * 1000).toISOString().replace(".000Z", "");
}

module.exports = {
  parseTimeToUnixSec,
  formatUnixSecForProvider,
};
