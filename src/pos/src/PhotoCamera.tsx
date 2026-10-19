import { useEffect, useRef, useState, type ReactNode } from "react";
// @ts-expect-error shared JS component has no declaration file
import MobileFullscreenModal from "../../admin/shared/components/MobileFullscreenModal";
import { StablePhotoTrigger, cameraCrop, captureCameraPhoto } from "./cameraCapture";
import { ProductBarcodeReader } from "./barcodeReader";
import { t, type Language } from "./i18n";

export default function PhotoCamera({ language, purpose = "recognize", onClose, onCapture, onUpload, extraActions, errorAction, modeActions, children }: {
  language: Language; purpose?: "product" | "recognize" | "cash" | "barcode";
  onClose: () => void; onCapture: (file: File, detectedCode?: string) => Promise<void>;
  onUpload?: () => void; extraActions?: ReactNode; modeActions?: ReactNode; children?: ReactNode;
  errorAction?: ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null), upload = useRef<HTMLInputElement>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [deviceId, setDeviceId] = useState(""), [activeDevice, setActiveDevice] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [torchAvailable, setTorchAvailable] = useState(false), [torch, setTorch] = useState(false);
  const [attempt, setAttempt] = useState(0), [preview, setPreview] = useState("");
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(1), [clear, setClear] = useState(true), [error, setError] = useState("");
  const captureLock = useRef(false), stopCamera = useRef(() => {}), mounted = useRef(false);
  const callbacks = useRef({ onClose, onCapture }); callbacks.current = { onClose, onCapture };
  const tr = (value: string) => t(language, value);
  const barcode = purpose === "barcode";
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function process(file: File, code?: string) {
    captureLock.current = true; setBusy(true); setError(""); stopCamera.current(); setReady(false);
    setPreview(URL.createObjectURL(file));
    try {
      await callbacks.current.onCapture(file, code);
      if (mounted.current) callbacks.current.onClose();
    } catch (cause) {
      if (mounted.current) { setError(cause instanceof Error ? cause.message : "Could not capture photo. Try again."); setBusy(false); }
    }
  }

  async function capture(code?: string) {
    if (captureLock.current || !video.current) return;
    captureLock.current = true; setBusy(true); setError("");
    try {
      const file = await captureCameraPhoto(video.current, barcode);
      if (mounted.current) await process(file, code);
    } catch (cause) {
      stopCamera.current();
      if (mounted.current) { setReady(false); setError(cause instanceof Error ? cause.message : "Could not capture photo. Try again."); setBusy(false); }
    }
  }

  useEffect(() => {
    let cancelled = false, stream: MediaStream | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const frame = video.current;
    const stop = () => {
      clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop());
      if (stream && frame?.srcObject === stream) frame.srcObject = null;
    };
    stopCamera.current = stop; captureLock.current = false;
    setError(""); setReady(false); setBusy(false); setPreview(""); setCountdown(1); setClear(true); setTorch(false); setTorchAvailable(false);
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera requires HTTPS or localhost.");
        stream = await navigator.mediaDevices.getUserMedia({ video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facingMode } }),
          width: { ideal: 1920 }, height: { ideal: 1080 },
        }, audio: false });
        if (cancelled || captureLock.current || !frame) { stop(); return; }
        frame.srcObject = stream; await frame.play();
        if (cancelled || captureLock.current) { stop(); return; }
        const track = stream.getVideoTracks()[0];
        let capabilities: (MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean }) | undefined;
        try { capabilities = track?.getCapabilities?.(); } catch { /* Optional browser capability. */ }
        if (capabilities?.focusMode?.includes("continuous")) {
          try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }); } catch { /* Optional autofocus. */ }
        }
        if (cancelled || captureLock.current) { stop(); return; }
        setTorchAvailable(Boolean(capabilities?.torch)); setActiveDevice(track?.getSettings().deviceId || deviceId);
        void navigator.mediaDevices.enumerateDevices?.().then((items) => { if (!cancelled) setDevices(items.filter((item) => item.kind === "videoinput")); }).catch(() => {});
        setReady(true);
        const sample = document.createElement("canvas"); sample.width = sample.height = 48;
        const context = sample.getContext("2d", { willReadFrequently: true });
        // Product/code photos capture quickly; cash retains the longer settling period.
        const trigger = purpose === "cash" ? new StablePhotoTrigger(performance.now(), 1400, 1100)
          : new StablePhotoTrigger(performance.now());
        const reader = barcode ? new ProductBarcodeReader() : null; let pass = 0;
        const step = async () => {
          if (cancelled || captureLock.current) return;
          if (document.hidden) trigger.reset(performance.now());
          else if (frame.videoWidth && context) {
            try {
              const crop = cameraCrop(frame.videoWidth, frame.videoHeight);
              if (barcode) context.drawImage(frame, 0, 0, 48, 48);
              else context.drawImage(frame, crop.x, crop.y, crop.side, crop.side, 0, 0, 48, 48);
              const state = trigger.update(context.getImageData(0, 0, 48, 48).data, performance.now());
              setCountdown(Math.ceil(state.remaining / 1000)); setClear(state.clear);
              const code = reader ? await reader.read(frame, frame.videoWidth, frame.videoHeight, pass++) : "";
              if (cancelled || captureLock.current) return;
              if (code || state.capture) { void capture(code || undefined); return; }
            } catch { /* Try the next frame while the camera settles. */ }
          }
          timer = setTimeout(() => { void step(); }, 200);
        };
        void step();
      } catch (cause) {
        stop();
        if (!cancelled) {
          const name = cause instanceof Error ? cause.name : "";
          setError(name === "NotAllowedError" ? "Allow camera access or choose an existing photo."
            : name === "NotFoundError" ? "No camera found. Choose an existing photo instead."
              : "Camera unavailable. Check camera access or choose an existing photo.");
        }
      }
    };
    void start(); return () => { cancelled = true; stop(); };
  }, [facingMode, deviceId, attempt, purpose, barcode]);

  return <MobileFullscreenModal open className="pos-camera-modal" closeLabel={tr("Close")}
    title={tr(barcode ? "Scan code" : purpose === "cash" ? "Photograph cash" : purpose === "product" ? "Update product photo" : "Recognize photo")}
    subtitle={tr(barcode ? "Keep the whole barcode inside the frame. Hold still to scan automatically, or press Scan now."
      : purpose === "cash" ? "Lay the notes flat, separated, entirely inside the frame. Hold still to capture."
        : "Place one product inside the frame. Hold still; the camera takes the photo for you.")} onClose={onClose}>
    <div className="stack-layout pos-photo-camera">
      {modeActions}
      <div className={"pos-camera-frame" + (barcode ? " pos-camera-frame--barcode" : "")}>
        <video ref={video} hidden={!!preview} autoPlay muted playsInline aria-label={tr("Camera preview")} />
        {preview && <img src={preview} alt={tr("Captured photo")} />}
        {!preview && <div className={barcode ? "pos-barcode-guide" : "pos-camera-guide"} aria-hidden="true" />}
        {ready && !error && !busy && <span className="pos-camera-countdown" aria-hidden="true">{countdown || 1}</span>}
      </div>
      <p className="pos-camera-instruction" role="status" aria-busy={busy}>{busy && !error && <span className="spinner pos-inline-spinner" aria-hidden="true" />}{error ? tr(preview ? "Review the captured photo, then try again." : "Try camera again or choose an existing photo.") : tr(busy
        ? barcode ? "Reading barcode photo…" : purpose === "cash" ? "Counting visible banknotes…" : purpose === "product" ? "Preparing and saving your product photo…" : "Finding the product…"
        : !ready ? "Allow camera access to see the preview." : !clear ? "Bring the product closer and use better light." : "Hold still. Taking the photo automatically…")}</p>
      {error && <div className="pos-alert pos-warning stack-layout" role="alert">
        <span>{tr(error)}</span>{!busy && errorAction}
      </div>}
      {devices.length > 1 && <label>{tr("Camera")}<select value={activeDevice} disabled={busy} onChange={(event) => setDeviceId(event.target.value)}>
        {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || (tr("Camera") + " " + (index + 1))}</option>)}
      </select></label>}
      <div className="pay42-inline-actions">
        {error ? <button type="button" className="primary-button" onClick={() => setAttempt((value) => value + 1)}>{tr("Try camera again")}</button>
          : <button type="button" className="primary-button" disabled={!ready || busy} onClick={() => void capture()}>{tr(barcode ? "Scan" : "Capture now")}</button>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => {
          if (devices.length > 1) setDeviceId(devices[(devices.findIndex((item) => item.deviceId === activeDevice) + 1) % devices.length].deviceId);
          else { setDeviceId(""); setFacingMode((mode) => mode === "environment" ? "user" : "environment"); }
        }}>{tr("Switch camera")}</button>
        {torchAvailable && ready && <button type="button" className="secondary-button" disabled={busy} onClick={async () => {
          const stream = video.current?.srcObject as MediaStream | null;
          try { await stream?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { setTorchAvailable(false); }
        }}>{tr(torch ? "Light off" : "Light on")}</button>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => onUpload ? onUpload() : upload.current?.click()}>{tr("Choose existing photo")}</button>
        {!busy && extraActions}
      </div>
      {!busy && children}
      <input ref={upload} className="pos-photo-upload" type="file" accept="image/png,image/jpeg,image/webp" aria-label={tr("Choose existing photo")} onChange={(event) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
        if (file && !busy) void process(file);
      }} />
    </div>
  </MobileFullscreenModal>;
}
