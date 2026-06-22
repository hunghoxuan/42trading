import appsConfig from "../../config/apps.json";

function fallbackEntryUrl(rawUrl = "") {
  if (typeof window === "undefined") {
    return rawUrl || "/miniapps/db-manager/";
  }

  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return "/miniapps/db-manager/";

  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (!isLocalhost && /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(trimmed)) {
    return `${window.location.origin}/miniapps/db-manager/`;
  }
  return trimmed;
}

function normalizeApp(app = {}) {
  const id = String(app.id || "").trim();
  const localStorageKey = `app_${id}_url`;
  const explicit =
    typeof window !== "undefined"
      ? String(window.localStorage.getItem(localStorageKey) || "").trim()
      : "";
  const configuredUrl = String(app?.entry?.url || "").trim();
  const entryUrl = explicit || fallbackEntryUrl(configuredUrl);

  return {
    ...app,
    id,
    route: String(app.route || `/apps/${id}`).trim(),
    status: String(app.status || "disabled").trim().toLowerCase(),
    entry: {
      type: String(app?.entry?.type || "iframe").trim().toLowerCase(),
      url: entryUrl,
      embeddedQueryParam: String(
        app?.entry?.embeddedQueryParam || "embedded=1",
      ).trim(),
    },
    display: {
      mode: String(app?.display?.mode || "container").trim().toLowerCase(),
      mobileMode: String(app?.display?.mobileMode || "fullscreen")
        .trim()
        .toLowerCase(),
      showHeader: app?.display?.showHeader !== false,
    },
    access: {
      requiredRole: String(app?.access?.requiredRole || "").trim().toLowerCase(),
    },
    auth: {
      mode: String(app?.auth?.mode || "inherit-main").trim().toLowerCase(),
      standaloneRedirectLogin: app?.auth?.standaloneRedirectLogin !== false,
      loginUrl: String(app?.auth?.loginUrl || "/login").trim() || "/login",
    },
    apis: {
      mode: String(app?.apis?.mode || "hybrid").trim().toLowerCase(),
      commonBasePath: String(app?.apis?.commonBasePath || "/v2").trim(),
      standaloneBaseUrl: String(app?.apis?.standaloneBaseUrl || entryUrl).trim(),
    },
  };
}

export function listApps({ includeDisabled = false } = {}) {
  return (appsConfig.apps || [])
    .map(normalizeApp)
    .filter((app) => includeDisabled || app.status === "enabled");
}

export function getAppById(id = "") {
  return listApps({ includeDisabled: true }).find(
    (app) => app.id === String(id || "").trim(),
  ) || null;
}
