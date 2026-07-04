import { useEffect, useState, useCallback } from "react";
import "./ToastContainer.css";

let toastId = 0;

function normalizeToastPayload(input, fallbackType = "info") {
  if (typeof input === "string") {
    return {
      message: input,
      type: fallbackType,
      position: "bottom-right",
      duration: 5000,
    };
  }
  const payload = input && typeof input === "object" ? input : {};
  return {
    ...payload,
    message: String(payload.message || "").trim(),
    fullMessage: String(payload.fullMessage || payload.message || "").trim(),
    type: String(payload.type || "info").trim().toLowerCase() || "info",
    position: String(payload.position || "bottom-right").trim() || "bottom-right",
    duration: Number(payload.duration ?? 5000),
    createdAt: Number(payload.createdAt) || Date.now(),
    durationMs: Number(payload.durationMs) || null,
    resultLabel: String(
      payload.resultLabel ||
        (String(payload.type || "info").trim().toLowerCase() === "error"
          ? "fail"
          : String(payload.type || "info").trim().toLowerCase() === "warning"
            ? "warning"
            : "ok"),
    )
      .trim()
      .toLowerCase(),
    sourceLabel: String(payload.sourceLabel || "event - toast").trim(),
    sourceType: String(payload.sourceType || "").trim(),
    sourceId: String(payload.sourceId || "").trim(),
    status: String(payload.status || "").trim().toUpperCase(),
    target: String(payload.target || "").trim(),
  };
}

function navigateToastTarget(target) {
  if (!target || typeof window === "undefined") return;
  window.history.pushState({}, "", target);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function showToast(input, fallbackType = "info") {
  const payload = normalizeToastPayload(input, fallbackType);
  window.dispatchEvent(
    new CustomEvent("toast-show", {
      detail: { id: ++toastId, ...payload },
    }),
  );
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  const handleShow = useCallback((e) => {
    const t = e.detail;
    setToasts((prev) => [...prev, t]);
    if (t.duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, t.duration);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("toast-show", handleShow);
    return () => window.removeEventListener("toast-show", handleShow);
  }, [handleShow]);

  if (!toasts.length) return null;

  const groups = {};
  toasts.forEach((t) => {
    const pos = t.position || "bottom-right";
    if (!groups[pos]) groups[pos] = [];
    groups[pos].push(t);
  });

  return (
    <>
      {Object.entries(groups).map(([pos, items]) => {
        return (
          <div key={pos} className={`toast-container toast-${pos}`}>
            {items.map((t) => (
              <div
                key={t.id}
                className={`toast-item toast-${t.type}`}
                onClick={() => {
                  if (t.target) {
                    navigateToastTarget(t.target);
                  }
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                }}
              >
                <div className="toast-item__type">{String(t.type || "info")}</div>
                {t.sourceType || t.status || t.sourceId ? (
                  <div className="toast-item__top">
                    <div className="toast-item__badges">
                      {t.sourceType ? (
                        <span className="toast-item__badge toast-item__badge-source">
                          {t.sourceType}
                        </span>
                      ) : null}
                      {t.status ? (
                        <span className="toast-item__badge toast-item__badge-status">
                          {t.status}
                        </span>
                      ) : null}
                    </div>
                    {t.sourceId ? (
                      <div className="toast-item__source" title={t.sourceId}>
                        {t.sourceId}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="toast-item__message" title={t.fullMessage || t.message}>
                  {t.message}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
