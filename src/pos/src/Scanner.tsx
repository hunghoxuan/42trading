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

export default function Scanner({ onCode, onClose, onRecognize, language }: {
  onCode: (value: string) => void;
  onClose: () => void;
  onRecognize: () => void;
  language: Language;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onCode);
  callback.current = onCode;
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(15);
  const [timedOut, setTimedOut] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const stopCamera = useRef(() => {});
  const tr = (value: string) => t(language, value);

  useEffect(() => {
    const frame = video.current;
    if (!frame) return;
    let cancelled = false;
    let delivered = false;
    let stream: MediaStream | undefined;
    let controls: IScannerControls | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      clearInterval(timer);
      controls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      // A late startup from a previous session must not detach the new camera.
      if (stream && frame.srcObject === stream) frame.srcObject = null;
    };
    stopCamera.current = () => { delivered = true; stop(); };
    setReady(false);
    setError("");
    setTimedOut(false);
    setRemaining(15);

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
        const deadline = Date.now() + 15000;
        timer = setInterval(() => {
          if (cancelled || delivered) return;
          const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
          setRemaining(seconds);
          if (!seconds) {
            delivered = true;
            stop();
            setReady(false);
            setTimedOut(true);
          }
        }, 250);
      } catch (cause) {
        stop();
        if (!cancelled && !delivered) { setReady(false); setError(cameraError(cause)); }
      }
    };
    void start();
    return () => { cancelled = true; stop(); };
  }, [facingMode, attempt]);

  return <div className="pos-scanner" role="dialog" aria-modal="true" aria-label={tr("Scan code")}>
    <div className="pos-scanner-card">
      <div className="pos-row"><h2>{tr("Scan code")}</h2><button type="button" onClick={onClose}>{tr("Close")}</button></div>
      <p className="minor-text">{tr("Point the printed barcode or QR code toward the camera. It scans automatically.")}</p>
      <div className="pos-barcode-preview">
        <video ref={video} autoPlay muted playsInline aria-label={tr("Camera preview")} />
        {ready && <div className="pos-barcode-guide" aria-hidden="true" />}
      </div>
      {!error && !timedOut && <p className="pos-muted" role="status">{ready
        ? `${tr("Scanning automatically")}… ${remaining}s`
        : tr("Allow camera access to see the preview.")}</p>}
      {timedOut && <p role="status">{tr("No barcode detected. Scanning paused. Move the barcode closer, improve the lighting, then try again. For the product's front label, use Recognize photo.")}</p>}
      {error && <p className="pos-error" role="alert">{tr(error)}</p>}
      <div className="pay42-inline-actions">
        <button type="button" className="secondary-button" onClick={() => setFacingMode((mode) => mode === "environment" ? "user" : "environment")}>{tr("Switch camera")}</button>
        {(error || timedOut) && <button type="button" className="primary-button" onClick={() => setAttempt((value) => value + 1)}>{tr("Try camera again")}</button>}
        <button type="button" className="secondary-button" onClick={() => { stopCamera.current(); onRecognize(); }}>{tr("Recognize photo")}</button>
      </div>
      <form className="stack-layout" onSubmit={(event) => {
        event.preventDefault();
        if (manualCode.trim()) { stopCamera.current(); callback.current(manualCode.trim()); }
      }}>
        <label>{tr("Barcode / product code")}<input value={manualCode} onChange={(event) => setManualCode(event.target.value)} autoComplete="off" /></label>
        <button type="submit" className="secondary-button" disabled={!manualCode.trim()}>{tr("Use this code")}</button>
      </form>
    </div>
  </div>;
}
