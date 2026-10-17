import { useEffect, useRef, useState } from "react";
import { ProductBarcodeReader, readBarcodePhoto } from "./barcodeReader";
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
  const [slow, setSlow] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [activeDeviceId, setActiveDeviceId] = useState("");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torch, setTorch] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const photoRequest = useRef(0);
  const stopCamera = useRef(() => {});
  const tr = (value: string) => t(language, value);
  useEffect(() => () => { photoRequest.current++; }, []);

  useEffect(() => {
    const frame = video.current;
    if (!frame) return;
    let cancelled = false;
    let delivered = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      // A late startup from a previous session must not detach the new camera.
      if (stream && frame.srcObject === stream) frame.srcObject = null;
    };
    stopCamera.current = () => { delivered = true; stop(); };
    setReady(false);
    setError("");
    setSlow(false);
    setTorch(false);
    setTorchSupported(false);

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
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facingMode } }),
          width: { ideal: 1920 }, height: { ideal: 1080 },
        } });
        if (cancelled || delivered) { stop(); return; }
        frame.srcObject = stream;
        await frame.play();
        if (cancelled || delivered) { stop(); return; }
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean }) | undefined;
        if (capabilities?.focusMode?.includes("continuous")) {
          try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }); } catch { /* Optional camera control. */ }
        }
        if (cancelled || delivered) { stop(); return; }
        setTorchSupported(Boolean(capabilities?.torch));
        setActiveDeviceId(track?.getSettings().deviceId || deviceId);
        void navigator.mediaDevices.enumerateDevices?.().then((items) => {
          if (!cancelled && !delivered) setDevices(items.filter((item) => item.kind === "videoinput"));
        }).catch(() => {});
        setReady(true);
        const reader = new ProductBarcodeReader();
        const started = performance.now();
        let pass = 0, warned = false;
        const scan = async () => {
          if (cancelled || delivered) return;
          // Await each frame so native detection and preprocessing never overlap.
          let code = "";
          try { if (!document.hidden) code = await reader.read(frame, frame.videoWidth, frame.videoHeight, pass++); }
          catch { /* A frame may be unavailable while the camera adjusts. */ }
          if (cancelled || delivered) return;
          if (code) {
            delivered = true;
            stop();
            callback.current(code);
            return;
          }
          if (!warned && performance.now() - started >= 8000) { warned = true; setSlow(true); }
          timer = setTimeout(() => { void scan(); }, 180);
        };
        void scan();
      } catch (cause) {
        stop();
        if (!cancelled && !delivered) { setReady(false); setError(cameraError(cause)); }
      }
    };
    void start();
    return () => { cancelled = true; stop(); };
  }, [facingMode, deviceId, attempt]);

  async function uploadPhoto(file: File) {
    const request = ++photoRequest.current;
    stopCamera.current(); setReady(false); setUploading(true); setError("");
    try {
      if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) throw new Error("Choose an image under 10 MB.");
      const code = await readBarcodePhoto(file);
      if (request !== photoRequest.current) return;
      if (code) callback.current(code);
      else setError("No readable barcode in this photo. Try a sharper close-up or enter the printed number below.");
    } catch { if (request === photoRequest.current) setError("Could not read the barcode photo. Choose a clear image under 10 MB or enter the number below."); }
    finally { if (request === photoRequest.current) setUploading(false); }
  }

  return <div className="pos-scanner" role="dialog" aria-modal="true" aria-label={tr("Scan code")}>
    <div className="pos-scanner-card">
      <div className="pos-row"><h2>{tr("Scan code")}</h2><button type="button" onClick={onClose}>{tr("Close")}</button></div>
      <p className="minor-text">{tr("Point the printed barcode or QR code toward the camera. It scans automatically.")}</p>
      <div className="pos-barcode-preview">
        <video ref={video} autoPlay muted playsInline aria-label={tr("Camera preview")} />
        {ready && <div className="pos-barcode-guide" aria-hidden="true" />}
      </div>
      {!error && <p className="pos-muted" role="status">{tr(uploading ? "Reading barcode photo…" : ready
        ? "Scanning automatically… Keep the whole barcode in view, including the white space on both sides."
        : "Allow camera access to see the preview.")}</p>}
      {slow && ready && <p role="status">{tr("Still scanning. Try another distance and avoid glare. If the preview faces you, switch cameras. You can also choose a sharper barcode photo.")}</p>}
      {error && <p className="pos-error" role="alert">{tr(error)}</p>}
      {devices.length > 1 && <label>{tr("Camera")}<select value={activeDeviceId} disabled={uploading} onChange={(event) => setDeviceId(event.target.value)}>
        {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${tr("Camera")} ${index + 1}`}</option>)}
      </select></label>}
      <div className="pay42-inline-actions">
        <button type="button" className="secondary-button" disabled={uploading} onClick={() => {
          if (devices.length > 1) setDeviceId(devices[(devices.findIndex((item) => item.deviceId === activeDeviceId) + 1) % devices.length].deviceId);
          else { setDeviceId(""); setFacingMode((mode) => mode === "environment" ? "user" : "environment"); }
        }}>{tr("Switch camera")}</button>
        {torchSupported && ready && <button type="button" className="secondary-button" onClick={async () => {
          const stream = video.current?.srcObject as MediaStream | null;
          try { await stream?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); }
          catch { setTorchSupported(false); }
        }}>{tr(torch ? "Light off" : "Light on")}</button>}
        {error && <button type="button" disabled={uploading} className="primary-button" onClick={() => setAttempt((value) => value + 1)}>{tr("Try camera again")}</button>}
        <button type="button" disabled={uploading} className="secondary-button" onClick={() => photoInput.current?.click()}>{tr("Read barcode photo")}</button>
        <button type="button" disabled={uploading} className="secondary-button" onClick={() => { stopCamera.current(); onRecognize(); }}>{tr("Recognize photo")}</button>
      </div>
      <form className="stack-layout" onSubmit={(event) => {
        event.preventDefault();
        if (uploading) return;
        if (manualCode.trim()) { stopCamera.current(); callback.current(manualCode.trim()); }
      }}>
        <label>{tr("Barcode / product code")}<input value={manualCode} onChange={(event) => setManualCode(event.target.value)} autoComplete="off" /></label>
        <button type="submit" className="secondary-button" disabled={uploading || !manualCode.trim()}>{tr("Use this code")}</button>
      </form>
      <input ref={photoInput} className="pos-photo-upload" type="file" accept="image/*" aria-label={tr("Read barcode photo")} onChange={(event) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
        if (file) void uploadPhoto(file);
      }} />
    </div>
  </div>;
}
