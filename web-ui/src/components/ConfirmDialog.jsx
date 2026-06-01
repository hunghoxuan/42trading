import React, { createContext, useCallback, useContext, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

const ConfirmDialogContext = createContext(null);

export function ConfirmDialogProvider({ children }) {
  const [state, setState] = useState(null);
  const [inputValue, setInputValue] = useState("");

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      setInputValue(String(options?.inputDefaultValue || ""));
      setState({ ...options, resolve });
    });
  }, []);

  const close = (value) => {
    const resolver = state?.resolve;
    const result =
      state?.input && value === true
        ? { ok: true, value: String(inputValue || "") }
        : value;
    setState(null);
    setInputValue("");
    resolver?.(result);
  };

  const open = !!state;
  const confirmClass = state?.tone === "danger" ? "danger-button" : "secondary-button";

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close(false); }}>
        {open && (
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="panel dialog-content">
            <Dialog.Title className="dialog-title">
              {state?.title || "Confirm"}
            </Dialog.Title>
            <Dialog.Description className="minor-text dialog-description">
              {state?.message || "Are you sure?"}
            </Dialog.Description>
            {state?.input ? (
              <div style={{ marginTop: 10 }}>
                <input
                  type="text"
                  className="text-input"
                  placeholder={state?.inputPlaceholder || ""}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  autoFocus
                />
              </div>
            ) : null}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="secondary-button">
                  {state?.cancelLabel || "Cancel"}
                </button>
              </Dialog.Close>
              <button type="button" className={confirmClass} onClick={() => close(true)}>
                {state?.confirmLabel || "Confirm"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
        )}
      </Dialog.Root>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) {
    return async (options = {}) => {
      if (options?.input) {
        const val = window.prompt(
          options?.inputPlaceholder || options?.message || options?.title || "Reason",
          options?.inputDefaultValue || "",
        );
        if (val == null) return false;
        const ok = window.confirm(options.message || options.title || "Are you sure?");
        if (!ok) return false;
        return { ok: true, value: String(val || "") };
      }
      return window.confirm(options.message || options.title || "Are you sure?");
    };
  }
  return ctx;
}
