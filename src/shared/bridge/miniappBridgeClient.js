(function bootstrapMiniAppBridge(global) {
  const BRIDGE_SOURCE_APP = "42trade-miniapp";
  const BRIDGE_SOURCE_HOST = "42trade-host";
  const listeners = new Map();
  const pending = new Map();
  let requestSeq = 0;
  let lastReportedHeight = 0;
  let pendingHeightFrame = 0;
  let heightObserver = null;

  function emit(eventName, detail) {
    const handlers = listeners.get(eventName);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(detail);
        } catch (err) {
          console.error("[miniapp-bridge] listener failed", err);
        }
      });
    }
    try {
      global.dispatchEvent(
        new CustomEvent(`42trade:${eventName}`, {
          detail,
        }),
      );
    } catch {}
  }

  function on(eventName, handler) {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(handler);
    return () => off(eventName, handler);
  }

  function off(eventName, handler) {
    const handlers = listeners.get(eventName);
    if (!handlers) return;
    handlers.delete(handler);
    if (!handlers.size) listeners.delete(eventName);
  }

  function isEmbeddedMode() {
    try {
      if (!global.parent || global.parent === global) return false;
      const params = new URLSearchParams(global.location.search);
      return (
        params.get("embedded") === "1" ||
        params.get("bridge") === "main" ||
        global.self !== global.top
      );
    } catch {
      return false;
    }
  }

  function normalizeTheme(value) {
    return String(value || "").toLowerCase() === "light" ? "light" : "dark";
  }

  function normalizeLocale(value) {
    return String(value || "").trim() || "English";
  }

  const state = {
    embedded: isEmbeddedMode(),
    ready: false,
    context: {
      embedded: isEmbeddedMode(),
      theme: normalizeTheme(
        global.document?.documentElement?.getAttribute("data-theme") ||
          global.localStorage?.getItem("ui_theme") ||
          "dark",
      ),
      locale: normalizeLocale(
        global.localStorage?.getItem("ui_locale") ||
          global.document?.documentElement?.lang ||
          "English",
      ),
      appId: "",
      appName: "",
    },
  };

  function readContentHeight() {
    const doc = global.document;
    const body = doc?.body;
    const root = doc?.documentElement;
    if (!body && !root) return 0;
    return Math.max(
      body?.scrollHeight || 0,
      body?.offsetHeight || 0,
      body?.clientHeight || 0,
      root?.scrollHeight || 0,
      root?.offsetHeight || 0,
      root?.clientHeight || 0,
    );
  }

  function reportContentHeight(force = false) {
    if (!state.embedded) return;
    const height = Math.max(0, Math.ceil(readContentHeight()));
    if (!force && (!height || Math.abs(height - lastReportedHeight) < 2)) {
      return;
    }
    lastReportedHeight = height;
    postMessageToHost("content-height", {
      height,
      pathname: global.location?.pathname || "/",
    });
  }

  function scheduleHeightReport(force = false) {
    if (!state.embedded) return;
    if (pendingHeightFrame) {
      global.cancelAnimationFrame?.(pendingHeightFrame);
    }
    pendingHeightFrame = global.requestAnimationFrame(() => {
      pendingHeightFrame = 0;
      reportContentHeight(force);
    });
  }

  function setupHeightSync() {
    if (!state.embedded || heightObserver) return;
    const doc = global.document;
    const root = doc?.documentElement;
    const body = doc?.body;
    if (typeof ResizeObserver !== "undefined" && (root || body)) {
      heightObserver = new ResizeObserver(() => {
        scheduleHeightReport();
      });
      if (root) heightObserver.observe(root);
      if (body && body !== root) heightObserver.observe(body);
    }
    global.addEventListener("load", () => scheduleHeightReport(true), {
      once: true,
    });
    global.addEventListener("resize", () => scheduleHeightReport());
    global.setTimeout(() => scheduleHeightReport(true), 0);
    global.setTimeout(() => scheduleHeightReport(true), 120);
    global.setTimeout(() => scheduleHeightReport(true), 400);
  }

  function applyContext(nextContext) {
    state.context = {
      ...state.context,
      ...(nextContext || {}),
      theme: normalizeTheme(nextContext?.theme || state.context.theme),
      locale: normalizeLocale(nextContext?.locale || state.context.locale),
      embedded: state.embedded,
    };

    try {
      global.document?.documentElement?.setAttribute(
        "data-theme",
        state.context.theme,
      );
      global.document.documentElement.lang = state.context.locale;
      global.localStorage?.setItem("ui_theme", state.context.theme);
      global.localStorage?.setItem("ui_locale", state.context.locale);
    } catch {}

    emit("context", { ...state.context });
    emit("theme", { theme: state.context.theme });
    emit("locale", { locale: state.context.locale });
    scheduleHeightReport(true);
  }

  function postMessageToHost(type, payload, requestId) {
    if (!state.embedded || !global.parent || global.parent === global) {
      return false;
    }
    global.parent.postMessage(
      {
        source: BRIDGE_SOURCE_APP,
        type,
        requestId: requestId || null,
        payload: payload || {},
      },
      "*",
    );
    return true;
  }

  function localToast(payload) {
    try {
      global.dispatchEvent(
        new CustomEvent("toast-show", {
          detail: {
            id: Date.now(),
            message: payload?.message || "",
            type: payload?.type || "info",
            position: payload?.position || "bottom-right",
            duration:
              typeof payload?.duration === "number" ? payload.duration : 5000,
          },
        }),
      );
    } catch {}
  }

  function localLog(payload) {
    const level = String(payload?.level || "info").toLowerCase();
    const message = payload?.message || "";
    const logger =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : console.log;
    logger("[miniapp]", message, payload?.meta || {});
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  async function serializeBody(body) {
    if (!body) return null;
    if (body instanceof FormData) {
      const entries = [];
      for (const [name, value] of body.entries()) {
        if (
          typeof File !== "undefined" &&
          (value instanceof File || value instanceof Blob)
        ) {
          entries.push({
            name,
            value: {
              __bridgeType: "file",
              name: value.name || "upload.bin",
              mime: value.type || "application/octet-stream",
              dataUrl: await fileToDataUrl(value),
            },
          });
        } else {
          entries.push({ name, value });
        }
      }
      return { kind: "form-data", entries };
    }
    if (typeof body === "string") {
      return { kind: "text", data: body };
    }
    if (typeof body === "object") {
      return { kind: "json", data: body };
    }
    return { kind: "text", data: String(body) };
  }

  function request(requestOptions) {
    if (!state.embedded) {
      return Promise.reject(
        new Error("Mini app bridge API proxy is only available when embedded."),
      );
    }
    const requestId = `miniapp-${Date.now()}-${++requestSeq}`;
    return new Promise(async (resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      try {
        const body = await serializeBody(requestOptions?.body);
        postMessageToHost(
          "api-request",
          {
            path: String(requestOptions?.path || "").trim(),
            method: String(requestOptions?.method || "GET").toUpperCase(),
            headers:
              requestOptions?.headers &&
              typeof requestOptions.headers === "object"
                ? requestOptions.headers
                : {},
            body,
          },
          requestId,
        );
      } catch (err) {
        pending.delete(requestId);
        reject(err);
      }
    });
  }

  function toast(payload) {
    const normalized =
      typeof payload === "string"
        ? { message: payload, type: "info" }
        : {
            message: String(payload?.message || "").trim(),
            type: String(payload?.type || "info").trim() || "info",
            position: String(payload?.position || "bottom-right").trim(),
            duration:
              typeof payload?.duration === "number" ? payload.duration : 5000,
          };
    if (!normalized.message) return;
    if (!postMessageToHost("toast", normalized)) {
      localToast(normalized);
    }
  }

  function log(payload, level) {
    const normalized =
      typeof payload === "string"
        ? { message: payload, level: level || "info" }
        : {
            message: String(payload?.message || "").trim(),
            level: String(payload?.level || level || "info").trim(),
            meta: payload?.meta || null,
          };
    if (!normalized.message) return;
    if (!postMessageToHost("log", normalized)) {
      localLog(normalized);
    }
  }

  function handleHostMessage(event) {
    const data = event?.data;
    if (!data || data.source !== BRIDGE_SOURCE_HOST || !data.type) return;

    if (data.type === "context") {
      state.ready = true;
      applyContext(data.payload || {});
      return;
    }

    if (data.type === "theme") {
      applyContext({ theme: data.payload?.theme });
      return;
    }

    if (data.type === "locale") {
      applyContext({ locale: data.payload?.locale });
      return;
    }

    if (data.type === "api-response" && data.requestId) {
      const pendingRequest = pending.get(data.requestId);
      if (!pendingRequest) return;
      pending.delete(data.requestId);
      if (data.payload?.ok) {
        pendingRequest.resolve(data.payload);
      } else {
        pendingRequest.reject(
          new Error(data.payload?.error || "Mini app bridge request failed."),
        );
      }
      return;
    }

    if (data.type === "event") {
      const eventPayload = data.payload || {};
      const action = String(eventPayload.action || "").trim();
      emit("event", eventPayload);
      if (action) {
        emit(`event:${action}`, eventPayload.payload ?? {});
      }
    }
  }

  global.addEventListener("message", handleHostMessage);

  const bridge = {
    isEmbedded() {
      return state.embedded;
    },
    isReady() {
      return state.ready;
    },
    getContext() {
      return { ...state.context };
    },
    on,
    off,
    toast,
    log,
    request,
    publish(action, payload = {}, extra = {}) {
      const normalizedAction = String(action || "").trim();
      if (!normalizedAction) {
        throw new Error("Bridge publish action is required.");
      }
      const message = {
        action: normalizedAction,
        payload:
          payload && typeof payload === "object" ? payload : { value: payload },
        ...(extra && typeof extra === "object" ? extra : {}),
      };
      if (!postMessageToHost("event", message)) {
        emit("event", message);
        emit(`event:${normalizedAction}`, message.payload);
      }
    },
    init() {
      if (state.embedded) {
        setupHeightSync();
        postMessageToHost("ready", {
          pathname: global.location?.pathname || "/",
          search: global.location?.search || "",
        });
        scheduleHeightReport(true);
      } else {
        applyContext(state.context);
      }
      return bridge;
    },
  };

  global.__42tradeMiniAppBridge = bridge;
  bridge.init();
})(window);
