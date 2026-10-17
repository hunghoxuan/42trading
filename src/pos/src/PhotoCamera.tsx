import { useEffect, useRef, useState } from "react";
// @ts-expect-error shared JS component has no declaration file
import MobileFullscreenModal from "../../admin/shared/components/MobileFullscreenModal";
import { t, type Language } from "./i18n";

export default function PhotoCamera({ language, onClose, onCapture, onUpload }: {
  language: Language;
  onClose: () => void;
  onCapture: (file: File) => void;
  onUpload: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const tr = (value: string) => t(language, value);

  useEffect(() => {
    if (!photo) { setPreview(""); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    if (photo) return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    setError(""); setReady(false);
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera requires HTTPS or localhost.");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
      } catch (cause) {
        stream?.getTracks().forEach((track) => track.stop());
        if (!cancelled) {
          const name = cause instanceof Error ? cause.name : "";
          setError(tr(name === "NotAllowedError" ? "Allow camera access or upload an image."
            : name === "NotFoundError" ? "No camera found. Upload an image instead."
              : "Camera unavailable. Check camera access or upload an image."));
        }
      }
    };
    void start();
    return () => { cancelled = true; stream?.getTracks().forEach((track) => track.stop()); };
  }, [facingMode, photo, language]);

  function capture() {
    const frame = video.current;
    if (!frame?.videoWidth || !frame.videoHeight) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / Math.max(frame.videoWidth, frame.videoHeight));
    canvas.width = Math.round(frame.videoWidth * scale);
    canvas.height = Math.round(frame.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(frame, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) setPhoto(new File([blob], "pos-camera.jpg", { type: "image/jpeg" }));
      else setError(tr("Could not capture photo. Try again."));
    }, "image/jpeg", 0.85);
  }

  return <MobileFullscreenModal open title={tr("Recognize photo")} subtitle={tr("Point the camera at the product, then take a photo.")} onClose={onClose}>
    <div className="stack-layout pos-photo-camera">
      {preview ? <img src={preview} alt={tr("Captured photo")} /> : <video ref={video} autoPlay muted playsInline
        aria-label={tr("Camera preview")} onLoadedData={() => setReady(true)} />}
      {!photo && !ready && !error && <p className="minor-text" role="status">{tr("Allow camera access to see the preview.")}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="pay42-inline-actions">
        {photo ? <>
          <button type="button" className="primary-button" onClick={() => onCapture(photo)}>{tr("Use photo")}</button>
          <button type="button" className="secondary-button" onClick={() => setPhoto(null)}>{tr("Retake photo")}</button>
        </> : <>
          <button type="button" className="primary-button" disabled={!ready || !!error} onClick={capture}>{tr("Take photo")}</button>
          <button type="button" className="secondary-button" disabled={!!error} onClick={() => setFacingMode((mode) => mode === "environment" ? "user" : "environment")}>{tr("Switch camera")}</button>
        </>}
        <button type="button" className="secondary-button" onClick={onUpload}>{tr("Upload image")}</button>
      </div>
    </div>
  </MobileFullscreenModal>;
}
