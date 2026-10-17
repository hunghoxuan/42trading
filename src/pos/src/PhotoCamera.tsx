import { useEffect, useRef, useState } from "react";
// @ts-expect-error shared JS component has no declaration file
import MobileFullscreenModal from "../../admin/shared/components/MobileFullscreenModal";
import { StablePhotoTrigger, cameraCrop, captureCameraPhoto } from "./cameraCapture";
import { t, type Language } from "./i18n";

export default function PhotoCamera({ language, purpose = "recognize", onClose, onCapture, onUpload }: {
  language: Language;
  purpose?: "product" | "recognize" | "cash";
  onClose: () => void;
  onCapture: (file: File) => Promise<void>;
  onUpload: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(2);
  const [clear, setClear] = useState(true);
  const [error, setError] = useState("");
  const captureLock = useRef(false);
  const stopCamera = useRef(() => {});
  const mounted = useRef(false);
  const callbacks = useRef({ onClose, onCapture });
  callbacks.current = { onClose, onCapture };
  const tr = (value: string) => t(language, value);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function capture() {
    if (captureLock.current || !video.current) return;
    captureLock.current = true;
    setBusy(true); setError("");
    try {
      const file = await captureCameraPhoto(video.current);
      stopCamera.current();
      if (!mounted.current) return;
      setPreview(URL.createObjectURL(file));
      await callbacks.current.onCapture(file);
      if (mounted.current) callbacks.current.onClose();
    } catch (cause) {
      if (mounted.current) {
        stopCamera.current();
        setError(cause instanceof Error ? cause.message : "Could not capture photo. Try again.");
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    captureLock.current = false;
    setError(""); setReady(false); setBusy(false); setPreview(""); setCountdown(2); setClear(true);
    const stop = () => { clearInterval(timer); stream?.getTracks().forEach((track) => track.stop()); };
    stopCamera.current = stop;
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera requires HTTPS or localhost.");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
        });
        if (cancelled) { stop(); return; }
        const frame = video.current;
        if (!frame) { stop(); return; }
        frame.srcObject = stream;
        await frame.play();
        if (cancelled) { stop(); return; }
        setReady(true);
        const sample = document.createElement("canvas"); sample.width = sample.height = 48;
        const context = sample.getContext("2d", { willReadFrequently: true });
        const trigger = new StablePhotoTrigger(performance.now());
        timer = setInterval(() => {
          if (cancelled || captureLock.current || !frame.videoWidth || !context) return;
          if (document.hidden) { trigger.reset(performance.now()); return; }
          const crop = cameraCrop(frame.videoWidth, frame.videoHeight);
          context.drawImage(frame, crop.x, crop.y, crop.side, crop.side, 0, 0, 48, 48);
          const state = trigger.update(context.getImageData(0, 0, 48, 48).data, performance.now());
          setCountdown(Math.ceil(state.remaining / 1000)); setClear(state.clear);
          if (state.capture) void capture();
        }, 200);
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
    void start();
    return () => { cancelled = true; stop(); };
  }, [facingMode, attempt]);

  return <MobileFullscreenModal open title={tr(purpose === "cash" ? "Photograph cash" : purpose === "product" ? "Update product photo" : "Recognize photo")}
    subtitle={tr(purpose === "cash" ? "Lay the notes flat, separated, entirely inside the frame. Hold still to capture."
      : "Place one product inside the frame. Hold still; the camera takes the photo for you.")} onClose={onClose}>
    <div className="stack-layout pos-photo-camera">
      {preview ? <img src={preview} alt={tr("Captured photo")} /> : <div className="pos-camera-frame">
        <video ref={video} autoPlay muted playsInline aria-label={tr("Camera preview")} />
        <div className="pos-camera-guide" aria-hidden="true" />
        {ready && !error && !busy && <span className="pos-camera-countdown" aria-hidden="true">{countdown || 1}</span>}
      </div>}
      <p className="pos-camera-instruction" role="status" aria-live="polite">{tr(busy
        ? purpose === "cash" ? "Counting visible banknotes…" : purpose === "product" ? "Preparing and saving your product photo…" : "Finding the product…"
        : !ready && !error ? "Allow camera access to see the preview."
          : !clear ? purpose === "cash" ? "Use better light and keep every note visible." : "Bring the product closer and use better light."
            : "Hold still. Taking the photo automatically…")}</p>
      {error && <p className="error" role="alert">{tr(error)}</p>}
      <div className="pay42-inline-actions">
        {error ? <button type="button" className="primary-button" onClick={() => setAttempt((value) => value + 1)}>{tr("Try camera again")}</button>
          : <button type="button" className="secondary-button" disabled={!ready || busy} onClick={() => void capture()}>{tr("Capture now")}</button>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setFacingMode((mode) => mode === "environment" ? "user" : "environment")}>{tr("Switch camera")}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onUpload}>{tr("Choose existing photo")}</button>
      </div>
    </div>
  </MobileFullscreenModal>;
}
