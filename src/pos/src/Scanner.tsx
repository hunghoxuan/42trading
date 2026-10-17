import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { t, type Language } from "./i18n";

function cameraError(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Allow camera access in your browser settings, then try again.";
  if (name === "NotFoundError") return "No camera found. Connect a camera and try again.";
  if (name === "NotReadableError" || name === "AbortError") return "Camera is busy. Close other apps using it, then try again.";
  return "Camera unavailable. Check camera access and try again.";
}

export default function Scanner({ onCode, onClose, language }: {
  onCode: (value: string) => void;
  onClose: () => void;
  language: Language;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onCode);
  callback.current = onCode;
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const tr = (value: string) => t(language, value);

  useEffect(() => {
    const frame = video.current;
    if (!frame) return;
    let cancelled = false;
    let delivered = false;
    let stream: MediaStream | undefined;
    let controls: IScannerControls | undefined;
    const stop = () => {
      controls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      // A late startup from a previous session must not detach the new camera.
      if (stream && frame.srcObject === stream) frame.srcObject = null;
    };
    setReady(false);
    setError("");

    const start = async () => {
      if (!window.isSecureContext) {
        setError("Camera requires HTTPS or localhost. Open POS using a secure URL.");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser does not support camera access. Use Safari or Chrome.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 },
        } });
        if (cancelled) { stop(); return; }
        frame.srcObject = stream;
        await frame.play();
        if (cancelled) { stop(); return; }
        const reader = new BrowserMultiFormatReader();
        // Own the stream ourselves so closing while camera permission/playback
        // is pending still releases it, including React StrictMode restarts.
        controls = await reader.decodeFromVideoElement(frame, (result, _error, activeControls) => {
          if (cancelled || delivered) { activeControls.stop(); return; }
          const code = result?.getText().trim();
          if (!code) return;
          delivered = true;
          activeControls.stop();
          stop();
          callback.current(code);
        });
        if (cancelled || delivered) { stop(); return; }
        setReady(true);
      } catch (cause) {
        stop();
        if (!cancelled) { setReady(false); setError(cameraError(cause)); }
      }
    };
    void start();
    return () => { cancelled = true; stop(); };
  }, [facingMode, attempt]);

  return <div className="pos-scanner" role="dialog" aria-modal="true" aria-label={tr("Scan code")}>
    <div className="pos-scanner-card">
      <div className="pos-row"><h2>{tr("Scan code")}</h2><button type="button" onClick={onClose}>{tr("Close")}</button></div>
      <video ref={video} autoPlay muted playsInline aria-label={tr("Camera preview")} />
      {!error && <p className="pos-muted" role="status">{tr(ready
        ? "Point the camera at a QR code or barcode."
        : "Allow camera access to see the preview.")}</p>}
      {error && <p className="pos-error" role="alert">{tr(error)} {tr("Type the product number in the search box instead.")}</p>}
      <div className="pay42-inline-actions">
        <button type="button" className="secondary-button" onClick={() => setFacingMode((mode) => mode === "environment" ? "user" : "environment")}>{tr("Switch camera")}</button>
        {error && <button type="button" className="primary-button" onClick={() => setAttempt((value) => value + 1)}>{tr("Try camera again")}</button>}
      </div>
    </div>
  </div>;
}
