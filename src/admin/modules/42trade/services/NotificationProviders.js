import {
  HUB_BROADCAST_CHANNEL,
  HUB_MAX_VISIBLE,
  clearNotificationEntries,
  getNotificationBadgeCount,
  loadNotificationEntries,
  markAllNotificationsSeen,
  markNotificationSeen,
  mergeNotificationEntries,
  normalizeHubEntry,
  normalizeNotificationServerItems,
  persistNotificationEntry,
  replaceNotificationEntry,
  saveNotificationEntries,
} from "./NotificationManager.js";

function createBroadcastChannelSafe() {
  try {
    return new BroadcastChannel(HUB_BROADCAST_CHANNEL);
  } catch {
    return null;
  }
}

export function createNotificationStorageProvider() {
  return {
    key: "local-storage",
    maxVisible: HUB_MAX_VISIBLE,
    load() {
      return loadNotificationEntries();
    },
    save(entries) {
      return saveNotificationEntries(entries);
    },
    normalize(entry) {
      return normalizeHubEntry(entry);
    },
    persist(entry) {
      return persistNotificationEntry(entry);
    },
    replace(entry) {
      return replaceNotificationEntry(entry);
    },
    clear() {
      clearNotificationEntries();
    },
    markSeen(requestId) {
      return markNotificationSeen(requestId);
    },
    markAllSeen() {
      return markAllNotificationsSeen();
    },
    merge(localEntries, serverEntries) {
      return mergeNotificationEntries(localEntries, serverEntries);
    },
    normalizeServerItems(items) {
      return normalizeNotificationServerItems(items);
    },
    getBadgeCount(entries) {
      return getNotificationBadgeCount(entries);
    },
  };
}

export function createNotificationBroadcastProvider() {
  return {
    key: "broadcast-channel",
    publish(detail) {
      try {
        window.dispatchEvent(new CustomEvent("hub-result", { detail }));
      } catch {}
      const bc = createBroadcastChannelSafe();
      if (bc) {
        try {
          bc.postMessage({ type: "hub-result", entry: detail });
        } catch {}
        bc.close();
      }
    },
    subscribe(onChange) {
      const handler = () => onChange?.();
      window.addEventListener("hub-status", handler);
      window.addEventListener("hub-result", handler);
      const bc = createBroadcastChannelSafe();
      if (bc) bc.onmessage = handler;
      return () => {
        window.removeEventListener("hub-status", handler);
        window.removeEventListener("hub-result", handler);
        if (bc) bc.close();
      };
    },
    openSharedChannel() {
      return createBroadcastChannelSafe();
    },
  };
}

export function createNotificationHistoryProvider(storageProvider) {
  return {
    key: "server-history",
    async listMerged(listFn, limit = HUB_MAX_VISIBLE) {
      const localEntries = storageProvider.load();
      try {
        const response = await listFn(limit);
        const serverEntries = storageProvider.normalizeServerItems(
          response?.items,
        );
        const merged = storageProvider.merge(localEntries, serverEntries);
        storageProvider.save(merged);
        return merged;
      } catch {
        return storageProvider.merge(localEntries, []);
      }
    },
  };
}

export function createNotificationProviders() {
  const storage = createNotificationStorageProvider();
  const broadcast = createNotificationBroadcastProvider();
  const history = createNotificationHistoryProvider(storage);
  return {
    storage,
    broadcast,
    history,
  };
}

export const defaultNotificationProviders = createNotificationProviders();
