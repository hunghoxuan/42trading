import { useEffect } from "react";
import "./MobileFullscreenModal.css";

export default function MobileFullscreenModal({
  open,
  title,
  subtitle = "",
  onClose,
  children,
}) {
  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="mobile-fullscreen-modal" role="dialog" aria-modal="true">
      <button
        type="button"
        className="mobile-fullscreen-modal__backdrop"
        aria-label="Close detail form"
        onClick={onClose}
      />
      <section className="mobile-fullscreen-modal__panel">
        <header className="mobile-fullscreen-modal__header">
          <div className="mobile-fullscreen-modal__copy">
            <div className="panel-label">{title}</div>
            {subtitle ? <div className="minor-text">{subtitle}</div> : null}
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="mobile-fullscreen-modal__body">{children}</div>
      </section>
    </div>
  );
}
