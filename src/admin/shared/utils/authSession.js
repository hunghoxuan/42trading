export function shouldApplyBootstrapAuthResult({
  cancelled = false,
  startedAuthVersion = 0,
  currentAuthVersion = 0,
} = {}) {
  if (cancelled) return false;
  return Number(startedAuthVersion) === Number(currentAuthVersion);
}

export const AUTH_USER_SNAPSHOT_STORAGE_KEY = "tvbridge_auth_user";

export function isExplicitAuthFailure(error) {
  if (!error) return false;
  if (error?.authRedirect === true) return true;
  const status = Number(error?.apiRequest?.status || 0);
  if (status === 401) return true;
  const message = String(error?.message || "").trim().toLowerCase();
  return (
    message === "auth_required" ||
    message === "session expired. redirecting to login." ||
    message.includes("unauthorized")
  );
}

export function loadStoredAuthUser(storage = null) {
  const target = storage || globalThis?.localStorage;
  if (!target) return null;
  try {
    const raw = String(target.getItem(AUTH_USER_SNAPSHOT_STORAGE_KEY) || "").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function storeAuthUserSnapshot(user, storage = null) {
  const target = storage || globalThis?.localStorage;
  if (!target) return;
  try {
    if (!user || typeof user !== "object") {
      target.removeItem(AUTH_USER_SNAPSHOT_STORAGE_KEY);
      return;
    }
    target.setItem(AUTH_USER_SNAPSHOT_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // ignore storage issues
  }
}
