import { useEffect, useMemo, useState } from "react";
import { maskSecretPreview } from "../../admin/utils/secrets";

function isMaskedLike(value) {
  const raw = String(value || "");
  return raw.includes("****");
}

async function copyText(text) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const tmp = document.createElement("textarea");
  tmp.value = text;
  tmp.style.position = "fixed";
  tmp.style.opacity = "0";
  document.body.appendChild(tmp);
  tmp.focus();
  tmp.select();
  document.execCommand("copy");
  document.body.removeChild(tmp);
}

export default function SecretInput({
  value = "",
  onChange,
  placeholder = "",
  disabled = false,
  secretName = "Secret",
  revealSecret = null,
  onMessage = null,
  showPreview = true,
}) {
  const [visible, setVisible] = useState(false);
  const [revealedValue, setRevealedValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVisible(false);
    setRevealedValue("");
  }, [value]);

  const hiddenValue = String(value || "");
  const effectiveVisibleValue = useMemo(() => {
    if (revealedValue) return revealedValue;
    if (!isMaskedLike(hiddenValue)) return hiddenValue;
    return "";
  }, [hiddenValue, revealedValue]);

  const handleRevealToggle = async () => {
    if (visible) {
      setVisible(false);
      setRevealedValue("");
      return;
    }
    if (!revealSecret) {
      setVisible(true);
      return;
    }
    try {
      setBusy(true);
      const plain = String((await revealSecret()) || "");
      setRevealedValue(plain);
      setVisible(true);
    } catch (err) {
      onMessage?.(err?.message || `Failed to reveal ${secretName}.`, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      setBusy(true);
      let plain = effectiveVisibleValue;
      if (!plain && revealSecret) {
        plain = String((await revealSecret()) || "");
        setRevealedValue(plain);
      }
      if (!plain) {
        onMessage?.(`${secretName}: empty value, nothing copied.`, "info");
        return;
      }
      await copyText(plain);
      onMessage?.(`${secretName} copied to clipboard.`, "success");
    } catch (err) {
      onMessage?.(
        `${secretName} copy failed: ${err?.message || "clipboard error"}`,
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <input
          type={visible ? "text" : "password"}
          value={visible ? effectiveVisibleValue : hiddenValue}
          onChange={(e) => {
            if (visible) setRevealedValue(e.target.value);
            onChange?.(e.target.value);
          }}
          disabled={disabled}
          style={{ flex: 1 }}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="secondary-button"
          onClick={handleRevealToggle}
          disabled={disabled || busy}
          title={visible ? "Hide" : "Reveal"}
        >
          {visible ? "Hide" : "Eye"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={handleCopy}
          disabled={disabled || busy}
          title="Copy decrypted value"
        >
          Copy
        </button>
      </div>
      {showPreview && !visible && hiddenValue && (
        <span className="minor-text" style={{ fontSize: 10, opacity: 0.9 }}>
          {maskSecretPreview(hiddenValue)}
        </span>
      )}
    </>
  );
}
