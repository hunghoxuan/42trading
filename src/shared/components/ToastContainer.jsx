import { useEffect, useState, useCallback } from "react";
import "./ToastContainer.css";

let toastId = 0;

export function showToast({ message, type = "info", position = "bottom-right", duration = 5000 }) {
  window.dispatchEvent(new CustomEvent("toast-show", {
    detail: { id: ++toastId, message, type, position, duration },
  }));
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
        const isTop = pos.startsWith("top");
        const isRight = pos.endsWith("right");
        return (
          <div key={pos} className={`toast-container toast-${pos}`}>
            {items.map((t) => (
              <div
                key={t.id}
                className={`toast-item toast-${t.type}`}
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              >
                {t.message}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
