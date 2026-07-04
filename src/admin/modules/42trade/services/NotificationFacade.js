import { NotificationHub } from "./NotificationHub.js";
import {
  HUB_BROADCAST_CHANNEL,
  HUB_MAX_VISIBLE,
  clearNotificationEntries,
  getNotificationBadgeCount,
  loadNotificationEntries,
  markAllNotificationsSeen,
  markNotificationSeen,
  mergeNotificationEntries,
  normalizeNotificationServerItems,
  persistNotificationEntry,
  saveNotificationEntries,
} from "./NotificationManager.js";

function createBroadcastChannel() {
  try {
    return new BroadcastChannel(HUB_BROADCAST_CHANNEL);
  } catch {
    return null;
  }
}

async function listMerged(listFn, limit = HUB_MAX_VISIBLE) {
  const localEntries = loadNotificationEntries();
  try {
    const response = await listFn(limit);
    const serverEntries = normalizeNotificationServerItems(response?.items);
    const merged = mergeNotificationEntries(localEntries, serverEntries);
    saveNotificationEntries(merged);
    return merged;
  } catch {
    return mergeNotificationEntries(localEntries, []);
  }
}

function subscribe(onChange) {
  const handler = () => onChange?.();
  window.addEventListener("hub-status", handler);
  window.addEventListener("hub-result", handler);
  const bc = createBroadcastChannel();
  if (bc) bc.onmessage = handler;
  return () => {
    window.removeEventListener("hub-status", handler);
    window.removeEventListener("hub-result", handler);
    if (bc) bc.close();
  };
}

function publish(detail) {
  try {
    window.dispatchEvent(new CustomEvent("hub-result", { detail }));
  } catch {}
  const bc = createBroadcastChannel();
  if (bc) {
    try {
      bc.postMessage({ type: "hub-result", entry: detail });
    } catch {}
    bc.close();
  }
}

const NotificationFacade = {
  listMerged,
  loadLocal: loadNotificationEntries,
  getBadgeCount: getNotificationBadgeCount,
  markSeen(requestId) {
    const next = markNotificationSeen(requestId);
    publish({ requestId, action: "seen" });
    return next;
  },
  markAllSeen() {
    const next = markAllNotificationsSeen();
    publish({ action: "seen-all" });
    return next;
  },
  clearAll() {
    clearNotificationEntries();
    publish({ action: "clear-all" });
    return [];
  },
  async clearAllRemote(clearFn) {
    this.clearAll();
    await clearFn?.().catch(() => {});
  },
  record(entry) {
    return NotificationHub.record(entry);
  },
  track(type, payload, fetchFn) {
    return NotificationHub.track(type, payload, fetchFn);
  },
  getResult(requestId) {
    return NotificationHub.getResult(requestId);
  },
  listResults(type) {
    return NotificationHub.listResults(type);
  },
  emit(eventName, subType, payload) {
    return NotificationHub.emit(eventName, subType, payload);
  },
  persist(entry) {
    const normalized = persistNotificationEntry(entry);
    publish(normalized);
    return normalized;
  },
  subscribe,
};

export { NotificationFacade };
