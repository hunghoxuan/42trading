import { useCallback, useEffect, useRef, useState } from "react";

export default function AsyncActionButton({
  onClick,
  timeoutMs = 30000,
  disabled = false,
  className = "secondary-button",
  type = "button",
  title,
  style,
  children,
  pendingLabel = null,
  spinnerSize = 12,
  onPendingChange,
  ...rest
}) {
  const [pending, setPending] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleClick = useCallback(
    async (event) => {
      if (pending || disabled) return;
      setPending(true);
      onPendingChange?.(true);
      let timeoutId = null;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`Action timeout after ${Math.round(timeoutMs / 1000)}s.`));
        }, timeoutMs);
      });
      try {
        await Promise.race([Promise.resolve(onClick?.(event)), timeoutPromise]);
      } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
        if (mountedRef.current) {
          setPending(false);
          onPendingChange?.(false);
        }
      }
    },
    [pending, disabled, onClick, timeoutMs, onPendingChange],
  );

  return (
    <button
      {...rest}
      type={type}
      title={pending ? pendingLabel || title || undefined : title}
      className={`${className}${pending ? " btn-busy" : ""}`}
      style={style}
      disabled={disabled || pending}
      onClick={handleClick}
    >
      {pending ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            className="spinner"
            style={{
              width: spinnerSize,
              height: spinnerSize,
            }}
          />
          <span>{pendingLabel || children}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
