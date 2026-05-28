import React, { createContext, useCallback, useContext, useState } from "react";

const ConfirmDialogContext = createContext(null);

export function ConfirmDialogProvider({ children }) {
  const [state, setState] = useState(null);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  const close = (value) => {
    const resolver = state?.resolve;
    setState(null);
    resolver?.(value);
  };

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      {state ? (
        <div
          className="modal-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 10000,
            display: "grid",
            placeItems: "center",
          }}
        >
          <div className="panel" style={{ width: "min(420px, 92vw)", padding: 18 }}>
            <h3 style={{ marginTop: 0 }}>{state.title || "Confirm"}</h3>
            <p className="minor-text" style={{ whiteSpace: "pre-wrap" }}>
              {state.message || "Are you sure?"}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="secondary-button" onClick={() => close(false)}>
                {state.cancelLabel || "Cancel"}
              </button>
              <button
                type="button"
                className={`secondary-button ${state.tone === "danger" ? "danger" : ""}`}
                onClick={() => close(true)}
              >
                {state.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) {
    return async (options = {}) =>
      window.confirm(options.message || options.title || "Are you sure?");
  }
  return ctx;
}
