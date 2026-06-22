import { getRuntimeActiveUserId, getRuntimeApiKey } from "../../admin/api";

const BRIDGE_SOURCE_APP = "42trade-miniapp";
const BRIDGE_SOURCE_HOST = "42trade-host";

function normalizeOrigin(rawUrl = "") {
  try {
    return new URL(String(rawUrl || "")).origin;
  } catch {
    return "*";
  }
}

function normalizePath(rawPath = "") {
  const value = String(rawPath || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) {
    throw new Error("Absolute URLs are not allowed through the mini app bridge.");
  }
  return value.startsWith("/") ? value : `/${value}`;
}

function isAllowedBridgeApiPath(pathname = "", method = "GET") {
  const methodUpper = String(method || "GET").toUpperCase();
  if (pathname.startsWith("/auth/")) return true;
  if (
    methodUpper === "POST" &&
    /\/api\/trades\/[^/]+\/files\/upload$/i.test(pathname)
  ) {
    return true;
  }
  if (
    methodUpper === "POST" &&
    pathname === "/api/ai/claude/files/upload-snapshots"
  ) {
    return true;
  }
  return false;
}

function dataUrlToFile(dataUrl = "", filename = "upload.bin", mimeType = "") {
  const raw = String(dataUrl || "");
  const match = raw.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("Unsupported file payload format.");
  const mime = mimeType || match[1] || "application/octet-stream";
  const buffer = Uint8Array.from(atob(match[3] || ""), (char) =>
    char.charCodeAt(0),
  );
  return new File([buffer], filename, { type: mime });
}

function reviveBridgeBody(bodySpec) {
  if (!bodySpec) return null;
  if (bodySpec.kind === "json") {
    return JSON.stringify(bodySpec.data ?? {});
  }
  if (bodySpec.kind === "text") {
    return String(bodySpec.data || "");
  }
  if (bodySpec.kind === "form-data") {
    const formData = new FormData();
    for (const entry of bodySpec.entries || []) {
      const name = String(entry?.name || "").trim();
      if (!name) continue;
      const value = entry?.value;
      if (value && value.__bridgeType === "file") {
        formData.append(
          name,
          dataUrlToFile(value.dataUrl, value.name, value.mime),
        );
      } else if (value == null) {
        formData.append(name, "");
      } else {
        formData.append(name, String(value));
      }
    }
    return formData;
  }
  return null;
}

function buildBridgeHeaders(customHeaders = {}, bodySpec = null) {
  const headers = new Headers();
  Object.entries(customHeaders || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    headers.set(key, String(value));
  });
  const apiKey = getRuntimeApiKey();
  const activeUserId = getRuntimeActiveUserId();
  if (apiKey && !headers.has("x-api-key")) headers.set("x-api-key", apiKey);
  if (activeUserId && !headers.has("x-active-user-id")) {
    headers.set("x-active-user-id", activeUserId);
  }
  if (
    bodySpec?.kind === "json" &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

async function parseBridgeResponse(response) {
  const contentType = String(response.headers.get("content-type") || "");
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export function createMiniAppBridgeHost(options) {
  const {
    app,
    authUser,
    iframeRef,
    onToast,
    onLog,
    onEvent,
    onHeightChange,
    theme = "dark",
    locale = "English",
  } = options;

  function post(type, payload = {}, requestId = null) {
    const frameWindow = iframeRef?.current?.contentWindow;
    if (!frameWindow) return false;
    frameWindow.postMessage(
      {
        source: BRIDGE_SOURCE_HOST,
        type,
        requestId,
        payload,
      },
      "*",
    );
    return true;
  }

  function buildContext(overrides = {}) {
    return {
      embedded: true,
      appId: String(app?.id || "").trim(),
      appName: String(app?.name || "").trim(),
      theme: String(overrides.theme || theme || "dark").trim() || "dark",
      locale: String(overrides.locale || locale || "English").trim() || "English",
      userRole: String(authUser?.role || "").trim().toLowerCase(),
      userId: String(authUser?.user_id || "").trim(),
    };
  }

  async function proxyApiRequest(requestPayload = {}) {
    const path = normalizePath(requestPayload.path);
    const method = String(requestPayload.method || "GET").toUpperCase();
    if (!isAllowedBridgeApiPath(path, method)) {
      throw new Error(`Path not allowed through bridge: ${path}`);
    }
    const body = reviveBridgeBody(requestPayload.body);
    const headers = buildBridgeHeaders(requestPayload.headers, requestPayload.body);
    const response = await fetch(path, {
      method,
      credentials: "include",
      headers,
      body:
        method === "GET" || method === "HEAD"
          ? undefined
          : body,
    });
    const data = await parseBridgeResponse(response);
    if (!response.ok) {
      const errorMessage =
        typeof data === "string"
          ? data
          : data?.error || `Bridge request failed with status ${response.status}`;
      throw new Error(errorMessage);
    }
    return {
      ok: true,
      status: response.status,
      data,
    };
  }

  async function handleMessage(event) {
    const payload = event?.data;
    const frameWindow = iframeRef?.current?.contentWindow;
    if (!frameWindow || event.source !== frameWindow) return;
    if (!payload || payload.source !== BRIDGE_SOURCE_APP || !payload.type) return;
    const targetOrigin = normalizeOrigin(app?.entry?.url || "");
    if (targetOrigin !== "*" && event.origin !== targetOrigin) return;

    if (payload.type === "ready") {
      post("context", buildContext());
      return;
    }

    if (payload.type === "toast") {
      onToast?.(payload.payload || {});
      return;
    }

    if (payload.type === "log") {
      onLog?.({
        ...(payload.payload || {}),
        appId: String(app?.id || "").trim(),
        appName: String(app?.name || "").trim(),
      });
      return;
    }

    if (payload.type === "content-height") {
      onHeightChange?.(payload.payload || {});
      return;
    }

    if (payload.type === "api-request" && payload.requestId) {
      try {
        const result = await proxyApiRequest(payload.payload || {});
        post("api-response", result, payload.requestId);
      } catch (err) {
        post(
          "api-response",
          {
            ok: false,
            error: err?.message || "Bridge request failed.",
          },
          payload.requestId,
        );
      }
      return;
    }

    if (payload.type === "event") {
      onEvent?.({
        ...(payload.payload || {}),
        appId: String(app?.id || "").trim(),
        appName: String(app?.name || "").trim(),
      });
      onLog?.({
        level: "info",
        message: `bridge event:${String(payload?.payload?.action || "unknown")}`,
        meta: payload?.payload || null,
        appId: String(app?.id || "").trim(),
        appName: String(app?.name || "").trim(),
      });
    }
  }

  return {
    handleMessage,
    syncContext(next = {}) {
      post("context", buildContext(next));
    },
    syncTheme(nextTheme) {
      post("theme", {
        theme: String(nextTheme || theme || "dark").trim() || "dark",
      });
    },
    syncLocale(nextLocale) {
      post("locale", {
        locale:
          String(nextLocale || locale || "English").trim() || "English",
      });
    },
    relayEvent(action, payload = {}, extra = {}) {
      const normalizedAction = String(action || "").trim();
      if (!normalizedAction) return false;
      return post("event", {
        action: normalizedAction,
        payload:
          payload && typeof payload === "object" ? payload : { value: payload },
        ...(extra && typeof extra === "object" ? extra : {}),
      });
    },
  };
}
