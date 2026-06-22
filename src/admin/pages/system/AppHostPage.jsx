import { useEffect, useMemo, useRef } from "react";
import { Navigate, useParams } from "react-router-dom";
import { getAppById } from "../../apps/appsRegistry";
import { showToast } from "../../../shared/components/ToastContainer";
import { createMiniAppBridgeHost } from "../../../shared/bridge/miniappBridgeHost";
import { getRuntimeActiveUserId, getRuntimeApiKey } from "../../api";

function buildEmbeddedUrl(app) {
  const entryUrl = String(app?.entry?.url || "").trim();
  const embeddedQueryParam = String(
    app?.entry?.embeddedQueryParam || "embedded=1",
  ).trim();
  if (!entryUrl) return "";
  const params = [];
  if (embeddedQueryParam) params.push(embeddedQueryParam);
  params.push("bridge=main");
  params.push(`appId=${encodeURIComponent(String(app?.id || "").trim())}`);
  return `${entryUrl}${entryUrl.includes("?") ? "&" : "?"}${params.join("&")}`;
}

export default function AppHostPage({ authUser, theme = "dark", locale = "English" }) {
  const { appId } = useParams();
  const app = useMemo(() => getAppById(appId), [appId]);
  const iframeRef = useRef(null);
  const frameShellRef = useRef(null);
  const bridgeHostRef = useRef(null);

  if (!app) {
    return <Navigate to="/dashboard" replace />;
  }

  const userRole = String(authUser?.role || "").toLowerCase();
  const requiredRole = String(app.access?.requiredRole || "").toLowerCase();
  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to="/dashboard" replace />;
  }

  const entryUrl = String(app.entry?.url || "").trim();
  const embeddedUrl = buildEmbeddedUrl(app);
  const isIframe = app.entry?.type === "iframe";
  const displayMode = String(app.display?.mode || "container");
  const showHeader = app.display?.showHeader !== false;
  const wrapperClassName = [
    "app-host-page",
    `app-host-page--${displayMode}`,
    `app-host-page--mobile-${String(app.display?.mobileMode || "fullscreen")}`,
    showHeader ? "" : "app-host-page--headerless",
  ].join(" ");

  async function persistMiniAppEvent(action, payload = {}, extra = {}) {
    const headers = {
      "Content-Type": "application/json",
    };
    const apiKey = getRuntimeApiKey();
    const activeUserId = getRuntimeActiveUserId();
    if (apiKey) headers["x-api-key"] = apiKey;
    if (activeUserId) headers["x-active-user-id"] = activeUserId;
    try {
      await fetch("/api/miniapps/event", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          appId: app.id,
          action,
          payload,
          ...extra,
        }),
      });
    } catch {}
  }

  useEffect(() => {
    if (!isIframe) return undefined;
    const bridgeHost = createMiniAppBridgeHost({
      app,
      authUser,
      iframeRef,
      theme,
      locale,
      onToast(payload = {}) {
        const message = String(payload?.message || "").trim();
        if (!message) return;
        showToast({
          message,
          type: String(payload?.type || "info").trim() || "info",
          position:
            String(payload?.position || "bottom-right").trim() ||
            "bottom-right",
          duration:
            typeof payload?.duration === "number" ? payload.duration : 5000,
        });
      },
      onLog(payload = {}) {
        const level = String(payload?.level || "info").toLowerCase();
        const message = String(payload?.message || "").trim();
        if (!message) return;
        const logMeta = payload?.meta || null;
        const prefix = `[miniapp:${payload.appId || app.id}]`;
        const logger =
          level === "error"
            ? console.error
            : level === "warn"
              ? console.warn
              : console.log;
        logger(prefix, message, logMeta || {});
        try {
          window.dispatchEvent(
            new CustomEvent("miniapp-log", {
              detail: {
                level,
                message,
                meta: logMeta,
                appId: payload.appId || app.id,
                appName: payload.appName || app.name,
              },
            }),
          );
        } catch {}
        persistMiniAppEvent(
          "log",
          {
            message,
            level,
            meta: logMeta,
          },
          { target: "backend", source: "miniapp" },
        );
      },
      onEvent(payload = {}) {
        const action = String(payload?.action || "").trim();
        if (!action) return;
        persistMiniAppEvent(
          action,
          payload?.payload && typeof payload.payload === "object"
            ? payload.payload
            : {},
          {
            target: String(payload?.target || "backend"),
            source: String(payload?.source || "miniapp"),
            requestId: payload?.requestId || null,
          },
        );
      },
      onHeightChange(payload = {}) {
        const nextHeight = Math.max(
          480,
          Math.ceil(Number(payload?.height || 0) || 0),
        );
        if (iframeRef.current) {
          iframeRef.current.style.height = `${nextHeight}px`;
          iframeRef.current.style.minHeight = `${nextHeight}px`;
        }
        if (frameShellRef.current) {
          frameShellRef.current.style.minHeight = `${nextHeight}px`;
        }
      },
    });
    bridgeHostRef.current = bridgeHost;

    const onMessage = (event) => {
      bridgeHost.handleMessage(event);
    };

    window.addEventListener("message", onMessage);
    const syncTimer = window.setTimeout(() => {
      bridgeHost.syncContext({ theme, locale });
    }, 150);

    return () => {
      bridgeHostRef.current = null;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(syncTimer);
    };
  }, [app, authUser, isIframe, locale, theme]);

  useEffect(() => {
    bridgeHostRef.current?.syncTheme(theme);
  }, [theme]);

  useEffect(() => {
    bridgeHostRef.current?.syncLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (!isIframe) return undefined;
    const apiKey = getRuntimeApiKey();
    const activeUserId = getRuntimeActiveUserId();
    const eventSourceUrl = new URL("/api/miniapps/stream", window.location.origin);
    eventSourceUrl.searchParams.set("appId", app.id);
    if (apiKey) eventSourceUrl.searchParams.set("apiKey", apiKey);
    if (activeUserId) eventSourceUrl.searchParams.set("activeUserId", activeUserId);
    const eventSource = new EventSource(eventSourceUrl.toString(), {
      withCredentials: true,
    });
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data || "{}");
        const action = String(data?.action || "").trim();
        if (!action) return;
        bridgeHostRef.current?.relayEvent(action, data?.payload || {}, {
          requestId: data?.requestId || null,
          source: String(data?.source || "backend"),
          target: String(data?.target || "app"),
        });
      } catch (err) {
        console.warn("[miniapp-bridge] failed to parse backend event", err);
      }
    };
    return () => {
      eventSource.close();
    };
  }, [app.id, isIframe]);

  return (
    <section className={wrapperClassName}>
      {showHeader ? (
        <header className="app-host-page__header">
          <div>
            <p className="app-host-page__eyebrow">App</p>
            <h1 className="app-host-page__title">{app.name}</h1>
            <p className="app-host-page__description">{app.description}</p>
          </div>
          <div className="app-host-page__actions">
            <a
              href={entryUrl}
              target="_blank"
              rel="noreferrer"
              className="secondary-button"
            >
              Open Standalone
            </a>
          </div>
        </header>
      ) : null}

      <div className="app-host-page__frame-shell" ref={frameShellRef}>
        {isIframe ? (
          <iframe
            ref={iframeRef}
            title={app.name}
            src={embeddedUrl}
            className="app-host-page__frame"
            loading="lazy"
          />
        ) : (
          <div className="app-host-page__placeholder">
            <strong>{app.name}</strong>
            <span>JS app mounting is not implemented yet.</span>
          </div>
        )}
      </div>
    </section>
  );
}
