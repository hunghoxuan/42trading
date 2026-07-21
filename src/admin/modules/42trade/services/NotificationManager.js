import {
  isMeaningfulEntry,
  normalizeServerEntry,
} from "../../../shared/utils/notificationDisplay.js";
import { normalizeActivityResult } from "../../../shared/utils/activityResult.js";

export const HUB_KEY = "hub:results";
export const HUB_TTL_MS = 3600000;
export const HUB_MAX_VISIBLE = 50;
export const HUB_BROADCAST_CHANNEL = "notification-hub";

export function loadNotificationEntries() {
  try {
    const raw = localStorage.getItem(HUB_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveNotificationEntries(list) {
  try {
    const filtered = (Array.isArray(list) ? list : [])
      .filter((entry) => Date.now() - Number(entry?.createdAt || 0) < HUB_TTL_MS)
      .slice(-HUB_MAX_VISIBLE);
    localStorage.setItem(HUB_KEY, JSON.stringify(filtered));
    return filtered;
  } catch {
    return [];
  }
}

export function normalizeHubEntry(entry = {}) {
  const now = Date.now();
  const createdAt = Number(entry?.createdAt) || now;
  const completedAt =
    Number(entry?.completedAt) ||
    (entry?.status !== "running" ? now : null);
  const durationMsRaw =
    entry?.durationMs !== undefined
      ? Number(entry.durationMs)
      : completedAt
        ? Math.max(0, completedAt - createdAt)
        : null;
  return {
    requestId:
      entry?.requestId ||
      `hub_${now}_${Math.random().toString(36).slice(2, 6)}`,
    type: entry?.type || "system_event",
    symbol: entry?.symbol || "",
    status: entry?.status || "info",
    createdAt,
    completedAt,
    durationMs: Number.isFinite(durationMsRaw) ? durationMsRaw : null,
    dbDurationMs: Number(entry?.dbDurationMs) || null,
    extra: entry?.extra || "",
    error: entry?.error || "",
    result: normalizeActivityResult(entry?.result || entry || {}, {
      ok: entry?.status !== "error",
    }),
    data: entry?.data || null,
    meta: entry?.meta || null,
    event: entry?.event || "",
    level: entry?.level || "",
    source: entry?.source || "local",
    _seen: entry?._seen === true,
  };
}

export function persistNotificationEntry(entry) {
  const normalized = normalizeHubEntry(entry);
  const current = loadNotificationEntries();
  const existingIndex = current.findIndex(
    (item) => item?.requestId === normalized.requestId,
  );
  const next =
    existingIndex >= 0
      ? current.map((item, index) =>
          index === existingIndex ? { ...item, ...normalized } : item,
        )
      : [...current, normalized];
  saveNotificationEntries(next);
  return normalized;
}

export function replaceNotificationEntry(nextEntry) {
  const normalized = normalizeHubEntry(nextEntry);
  const next = loadNotificationEntries().map((entry) =>
    entry?.requestId === normalized.requestId ? normalized : entry,
  );
  saveNotificationEntries(next);
  return normalized;
}

export function mergeNotificationEntries(localEntries, serverEntries) {
  const byId = new Map();
  (Array.isArray(serverEntries) ? serverEntries : []).forEach((entry) => {
    if (entry?.requestId) byId.set(entry.requestId, entry);
  });
  (Array.isArray(localEntries) ? localEntries : []).forEach((entry) => {
    if (!entry?.requestId) return;
    const existing = byId.get(entry.requestId) || {};
    byId.set(entry.requestId, { ...existing, ...entry });
  });
  return Array.from(byId.values())
    .filter((entry) => Date.now() - Number(entry?.createdAt || 0) < HUB_TTL_MS)
    .filter(isMeaningfulEntry)
    .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))
    .slice(0, HUB_MAX_VISIBLE);
}

export function normalizeNotificationServerItems(items) {
  return (Array.isArray(items) ? items : []).map(normalizeServerEntry);
}

export function markNotificationSeen(requestId) {
  const next = loadNotificationEntries().map((entry) =>
    entry?.requestId === requestId ? { ...entry, _seen: true } : entry,
  );
  return saveNotificationEntries(next);
}

export function markAllNotificationsSeen() {
  const next = loadNotificationEntries().map((entry) => ({
    ...entry,
    _seen: true,
  }));
  return saveNotificationEntries(next);
}

export function clearNotificationEntries() {
  try {
    localStorage.removeItem(HUB_KEY);
  } catch {}
}

export function getNotificationBadgeCount(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const unread = list.filter((entry) => !entry?._seen);
  const pending = list.filter((entry) => entry?.status === "running");
  return unread.length || pending.length || 0;
}
