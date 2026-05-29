import React, { createContext, useCallback, useContext, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

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
    return async (options = {}) =>
      window.confirm(options.message || options.title || "Are you sure?");
  }
  return ctx;
}
