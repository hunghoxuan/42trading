import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import jsQR from "jsqr";
import { api } from "../../../app/api";
import { showDateTime } from "../../../shared/utils/format";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import { showToast } from "../../../shared/components/ToastContainer";
import Pay42MediaThumb from "./Pay42MediaThumb";
import { formatMetric, formatMoney } from "./pay42Ui";

function cameraStateLabel({ settling, cameraOpen, cameraReady }) {
  if (settling) return "Processing payment...";
  if (cameraOpen && cameraReady) return "Scanning live camera feed";
  if (cameraOpen) return "Opening camera...";
  return "Camera idle";
}

function waitForNextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function decodeQrFromCanvas(canvas, detector = null) {
  if (!canvas) return "";
  if (detector) {
    const codes = await detector.detect(canvas);
    const first = Array.isArray(codes) ? codes[0] : null;
    const rawValue = String(first?.rawValue || "").trim();
    if (rawValue) return rawValue;
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "";
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
  return String(result?.data || "").trim();
}

export default function Pay42ScanPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const videoRef = useRef(null);
  const frameCanvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(0);
  const autoStartTimerRef = useRef(0);
  const detectorRef = useRef(null);
  const settlingRef = useRef(false);
  const scanLockRef = useRef(false);
  const cameraOpenRef = useRef(false);
  const previewingRef = useRef(false);
  const cameraRequestRef = useRef(0);
  const cameraStartInFlightRef = useRef(false);
  const isMountedRef = useRef(false);
  const prefilledQrRef = useRef("");

  const [wallet, setWallet] = useState(null);
  const [manualQr, setManualQr] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [detectorSupported, setDetectorSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [paymentPreview, setPaymentPreview] = useState(null);
  const [previewSource, setPreviewSource] = useState("");
  const [lastOrder, setLastOrder] = useState(null);
  const [scanFeed, setScanFeed] = useState({
    frames: 0,
    decoder: "idle",
    lastPayload: "",
    lastEvent: "Camera idle",
    lastAt: "",
  });
  const cameraStatus = cameraStateLabel({ settling, cameraOpen, cameraReady });

  function updateScanFeed(patch = {}) {
    setScanFeed((current) => ({
      ...current,
      ...patch,
      lastAt: showDateTime(new Date().toISOString()),
    }));
  }

  function cameraFailureMessage(nextError) {
    const name = String(nextError?.name || "").trim();
    const message = String(nextError?.message || "").trim();
    if (
      name === "AbortError" ||
      message.toLowerCase().includes("play() request was interrupted by a new load request")
    ) {
      return "";
    }
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      return "Live camera needs HTTPS or localhost. On mobile, open this app with a secure URL or use the Camera Photo fallback below.";
    }
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Camera permission was blocked. Allow camera access in the browser and try again.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No camera device was found on this phone or browser.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "The camera is busy in another app. Close other camera apps and try again.";
    }
    return message || "Failed to open camera.";
  }

  function releaseStream(stream = null) {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
  }

  async function loadWallet() {
    try {
      setLoading(true);
      const out = await api.pay42Wallet();
      setWallet(out?.wallet || null);
    } catch (nextError) {
      setError(nextError?.message || "Failed to load wallet");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    isMountedRef.current = true;
    loadWallet();
    return () => {
      isMountedRef.current = false;
      cameraRequestRef.current += 1;
      cameraStartInFlightRef.current = false;
      window.clearTimeout(autoStartTimerRef.current);
      window.cancelAnimationFrame(frameRef.current);
      releaseStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    cameraOpenRef.current = cameraOpen;
  }, [cameraOpen]);

  useEffect(() => {
    previewingRef.current = previewing;
  }, [previewing]);

  useEffect(() => {
    if (paymentPreview) return undefined;
    window.clearTimeout(autoStartTimerRef.current);
    autoStartTimerRef.current = window.setTimeout(() => {
      startCamera();
    }, 80);
    return () => {
      window.clearTimeout(autoStartTimerRef.current);
    };
  }, [paymentPreview]);

  async function previewQrCode(
    qrCode,
    { stopAfterPreview = false, source = "manual" } = {},
  ) {
    const payload = String(qrCode || "").trim();
    const canContinue = source === "camera" ? !settlingRef.current : !settlingRef.current && !scanLockRef.current;
    if (!payload || !canContinue) return;
    let previewResolved = false;
    try {
      scanLockRef.current = true;
      previewingRef.current = true;
      setPreviewing(true);
      setError("");
      setCameraError("");
      updateScanFeed({
        decoder: source,
        lastPayload: payload,
        lastEvent: "QR detected. Loading payment preview...",
      });
      const out = await api.pay42PreviewQrCode({
        qr_code: payload,
      });
      setManualQr(payload);
      setPaymentPreview(out || null);
      setPreviewSource(source);
      previewResolved = true;
      if (stopAfterPreview) {
        await stopCamera();
      }
    } catch (nextError) {
      setPaymentPreview(null);
      setError(nextError?.message || "Failed to preview payment");
      updateScanFeed({
        lastEvent: nextError?.message || "Preview failed",
      });
    } finally {
      previewingRef.current = false;
      setPreviewing(false);
      if (!previewResolved || !stopAfterPreview) {
        scanLockRef.current = false;
      }
    }
  }

  async function confirmPayment() {
    const payload = String(paymentPreview?.qr_code || manualQr || "").trim();
    if (!payload || settlingRef.current) return;
    try {
      settlingRef.current = true;
      setSettling(true);
      setError("");
      const out = await api.pay42ScanQrCode({
        qr_code: payload,
        metadata: {
          payment_method: previewSource === "camera" ? "QR_SCAN_CAMERA" : "QR_SCAN",
        },
      });
      setLastOrder(out?.order || null);
      setPaymentPreview(null);
      setPreviewSource("");
      setManualQr("");
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("qr");
      prefilledQrRef.current = "";
      setSearchParams(nextParams);
      showToast({
        type: "success",
        message: "Payment completed. Order created and wallet updated.",
      });
      updateScanFeed({
        lastEvent: "Payment completed. Camera closed.",
        lastPayload: payload,
      });
      await loadWallet();
      await stopCamera();
      navigate(`/admin/42pay/orders/${encodeURIComponent(out?.order?.sid || "")}/confirmation`);
    } catch (nextError) {
      setError(nextError?.message || "Failed to complete payment");
    } finally {
      settlingRef.current = false;
      setSettling(false);
    }
  }

  function cancelPaymentPreview() {
    setPaymentPreview(null);
    setPreviewSource("");
    setError("");
    scanLockRef.current = false;
    updateScanFeed({
      lastEvent: "Payment preview cancelled. Ready to scan again.",
    });
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("qr");
    prefilledQrRef.current = "";
    setSearchParams(nextParams);
  }

  async function stopCamera() {
    cameraRequestRef.current += 1;
    cameraStartInFlightRef.current = false;
    cameraOpenRef.current = false;
    setCameraOpen(false);
    setCameraReady(false);
    window.cancelAnimationFrame(frameRef.current);
    releaseStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause?.();
      video.srcObject = null;
    }
    updateScanFeed({
      decoder: "idle",
      lastEvent: "Camera stopped",
    });
  }

  async function scanFrame() {
    if (!cameraOpenRef.current || settlingRef.current || scanLockRef.current) return;
    const video = videoRef.current;
    const detector = detectorRef.current;
    const canvas = frameCanvasRef.current;
    if (!video || !canvas) {
      frameRef.current = window.requestAnimationFrame(scanFrame);
      return;
    }
    if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      frameRef.current = window.requestAnimationFrame(scanFrame);
      return;
    }
    try {
      let nextFrameCount = 0;
      setScanFeed((current) => {
        nextFrameCount = current.frames + 1;
        return {
          ...current,
          frames: nextFrameCount,
        };
      });
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const context = canvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!context) {
        frameRef.current = window.requestAnimationFrame(scanFrame);
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const decoder = detector ? "BarcodeDetector + jsQR fallback" : "jsQR fallback";
      const rawValue = await decodeQrFromCanvas(canvas, detector);
      if (rawValue) {
        updateScanFeed({
          decoder,
          lastPayload: rawValue,
          lastEvent: "QR detected from live camera frame.",
        });
        await previewQrCode(rawValue, {
          stopAfterPreview: true,
          source: "camera",
        });
        return;
      }
      if (nextFrameCount > 0 && nextFrameCount % 20 === 0) {
        updateScanFeed({
          decoder,
          lastEvent: "Scanning frames... no QR detected yet.",
        });
      }
    } catch {
      // Ignore transient detector errors while the camera warms up.
      updateScanFeed({
        lastEvent: "Camera frame decode error. Retrying...",
      });
    }
    frameRef.current = window.requestAnimationFrame(scanFrame);
  }

  async function startCamera() {
    if (
      cameraOpenRef.current ||
      previewingRef.current ||
      settlingRef.current ||
      cameraStartInFlightRef.current
    ) {
      return;
    }
    setCameraError("");
    setError("");
    scanLockRef.current = false;
    const requestId = cameraRequestRef.current + 1;
    cameraRequestRef.current = requestId;
    cameraStartInFlightRef.current = true;
    if (
      typeof window === "undefined" ||
      !("mediaDevices" in navigator) ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCameraError("Camera access is not available in this browser.");
      updateScanFeed({
        lastEvent: "Camera API is not available in this browser.",
      });
      cameraStartInFlightRef.current = false;
      return;
    }
    try {
      const canDetect = typeof window.BarcodeDetector !== "undefined";
      setDetectorSupported(true);
      detectorRef.current = canDetect
        ? new window.BarcodeDetector({ formats: ["qr_code"] })
        : null;
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
          },
          audio: false,
        });
      } catch (primaryError) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }
      if (requestId !== cameraRequestRef.current || !isMountedRef.current) {
        releaseStream(stream);
        return;
      }
      releaseStream(streamRef.current);
      streamRef.current = stream;
      cameraOpenRef.current = true;
      setCameraOpen(true);
      setCameraReady(false);
      updateScanFeed({
        decoder: canDetect ? "BarcodeDetector + jsQR fallback" : "jsQR fallback",
        lastEvent: "Opening rear camera...",
      });
      if (!videoRef.current) {
        await waitForNextFrame();
      }
      if (requestId !== cameraRequestRef.current || !isMountedRef.current) {
        releaseStream(stream);
        return;
      }
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview failed to mount.");
      video.setAttribute("playsinline", "true");
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      if (requestId !== cameraRequestRef.current || !isMountedRef.current) {
        releaseStream(stream);
        return;
      }
      setCameraReady(true);
      updateScanFeed({
        lastEvent: "Camera live. Scanning frames now.",
      });
      frameRef.current = window.requestAnimationFrame(scanFrame);
    } catch (nextError) {
      if (requestId !== cameraRequestRef.current || !isMountedRef.current) {
        return;
      }
      const failureMessage = cameraFailureMessage(nextError);
      setCameraError(failureMessage);
      scanLockRef.current = false;
      if (failureMessage) {
        updateScanFeed({
          lastEvent: failureMessage,
        });
        await stopCamera();
      }
    } finally {
      if (requestId === cameraRequestRef.current) {
        cameraStartInFlightRef.current = false;
      }
    }
  }

  async function handleCaptureFile(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    setCameraError("");
    setError("");
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!context) {
        setCameraError("Failed to prepare the QR photo for scanning.");
        return;
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const detector =
        typeof window.BarcodeDetector !== "undefined"
          ? new window.BarcodeDetector({ formats: ["qr_code"] })
          : null;
      const rawValue = await decodeQrFromCanvas(canvas, detector);
      if (!rawValue) {
        setCameraError("No QR code was found in that photo. Try a clearer image.");
        updateScanFeed({
          decoder: detector ? "photo + BarcodeDetector/jsQR" : "photo + jsQR",
          lastEvent: "No QR code found in selected photo.",
        });
        return;
      }
      await previewQrCode(rawValue, { source: "photo" });
    } catch (nextError) {
      setCameraError(nextError?.message || "Failed to read the QR photo.");
      updateScanFeed({
        lastEvent: nextError?.message || "Failed to read QR photo.",
      });
    } finally {
      if (event?.target) {
        event.target.value = "";
      }
    }
  }

  useEffect(() => {
    const qr = String(searchParams.get("qr") || "").trim();
    if (!qr || qr === prefilledQrRef.current) return;
    prefilledQrRef.current = qr;
    setManualQr(qr);
    previewQrCode(qr, { source: "offer" });
  }, [searchParams]);

  return (
    <section className="logs-page-container trades-page-container pay42-page-container stack-layout fadeIn">
      <PageHeader
        className="trades-page-header"
        title="Scan QR 2 Pay"
        actions={
          <div className="pay42-inline-actions">
            <Link className="secondary-button" to="/admin/42pay/orders">
              Orders
            </Link>
            {cameraOpen ? (
              <button type="button" className="secondary-button" onClick={stopCamera}>
                Close Camera
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              onClick={() => fileInputRef.current?.click()}
            >
              Use Camera Photo
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={handleCaptureFile}
            />
          </div>
        }
      />

      {error ? <div className="error">{error}</div> : null}
      {cameraError ? <div className="error">{cameraError}</div> : null}

      <div className="pay42-split-layout">
        <ResponsivePanel
          title="Camera Scan"
          subtitle="Mobile-first QR payment entry"
          showToggle={false}
        >
          <div className="stack-layout">
            <div className="pay42-scan-stage">
              <div className="pay42-scan-viewport">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className={`pay42-scan-video${cameraOpen ? " is-live" : ""}`}
                />
                <canvas
                  ref={frameCanvasRef}
                  aria-hidden="true"
                  style={{ display: "none" }}
                />
                {!cameraOpen ? (
                  <div className="pay42-scan-placeholder">
                    <div className="pay42-scan-window pay42-scan-window--placeholder">
                      <span className="pay42-scan-corner pay42-scan-corner--tl" />
                      <span className="pay42-scan-corner pay42-scan-corner--tr" />
                      <span className="pay42-scan-corner pay42-scan-corner--bl" />
                      <span className="pay42-scan-corner pay42-scan-corner--br" />
                    </div>
                    <strong>Open the rear camera to scan a 42Pay QR code.</strong>
                    <span className="minor-text pay42-scan-copy">
                      The camera opens automatically and will preview payment details after a QR is detected.
                    </span>
                  </div>
                ) : null}
                <div className="pay42-scan-overlay" aria-hidden="true">
                  <div className="pay42-scan-window pay42-scan-window--placeholder">
                    <span className="pay42-scan-corner pay42-scan-corner--tl" />
                    <span className="pay42-scan-corner pay42-scan-corner--tr" />
                    <span className="pay42-scan-corner pay42-scan-corner--bl" />
                    <span className="pay42-scan-corner pay42-scan-corner--br" />
                    {cameraOpen ? <span className="pay42-scan-beam" /> : null}
                  </div>
                </div>
              </div>
            </div>
            <div className="pay42-scan-controls">
              <div className="pay42-inline-actions">
                <button type="button" className="secondary-button" onClick={stopCamera}>
                  Close Camera
                </button>
              </div>
              <div className="pay42-scan-status-card">
                <div className="pay42-scan-status-row">
                  <span className="minor-text">SCAN USING CAMERA</span>
                  <span
                    className={`pay42-scan-status-pill${cameraOpen ? " is-live" : ""}${settling || previewing ? " is-busy" : ""}`}
                  >
                    {previewing ? "Previewing payment..." : cameraStatus}
                  </span>
                </div>
                <p className="minor-text pay42-scan-hint">
                  {detectorSupported
                    ? "Keep the QR code inside the frame. The live feed below will show frame activity and the last decoded payload."
                    : "Live camera preview is available here. The debug feed below will show whether fallback scanning is running."}
                </p>
                <div className="pay42-scan-debug-grid">
                  <div className="summary-item">
                    <span className="minor-text" style={{ fontSize: "10px" }}>FRAMES</span>
                    <div style={{ fontSize: "16px" }}>{formatMetric(scanFeed.frames)}</div>
                  </div>
                  <div className="summary-item">
                    <span className="minor-text" style={{ fontSize: "10px" }}>DECODER</span>
                    <div style={{ fontSize: "12px" }}>{scanFeed.decoder || "-"}</div>
                  </div>
                </div>
                <label className="pay42-form-field">
                  <span className="minor-text">LIVE SCAN FEED</span>
                  <textarea
                    rows={5}
                    readOnly
                    value={`Status: ${scanFeed.lastEvent || "-"}\nLast payload: ${scanFeed.lastPayload || "-"}\nLast update: ${scanFeed.lastAt || "-"}`}
                  />
                </label>
              </div>
            </div>
          </div>
        </ResponsivePanel>

        <ResponsivePanel
          title={paymentPreview ? "Payment Confirmation" : "Fallback / Result"}
          subtitle={
            paymentPreview
              ? previewSource === "camera"
                ? "Camera scan complete. Review this offer before payment."
                : "Review this offer before payment."
              : "Manual QR paste and latest payment"
          }
          showToggle={false}
        >
          <div className="stack-layout">
            <label className="pay42-form-field">
              <span className="minor-text">MANUAL QR PAYLOAD</span>
              <textarea
                rows={6}
                value={manualQr}
                onChange={(e) => setManualQr(e.target.value)}
                placeholder="Paste 42pay:{...}"
              />
            </label>
            <div className="pay42-inline-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={settling || previewing || !manualQr.trim()}
                onClick={() => previewQrCode(manualQr, { source: "manual" })}
              >
                {previewing ? "Previewing..." : "Preview QR Payment"}
              </button>
              {paymentPreview ? (
                <>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={settling || previewing || paymentPreview?.payment?.can_pay === false}
                    onClick={confirmPayment}
                  >
                    {settling ? "Paying..." : "Pay Now"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={settling || previewing}
                    onClick={cancelPaymentPreview}
                  >
                    Cancel
                  </button>
                </>
              ) : null}
            </div>

            {paymentPreview ? (
              <div className="minor-text">
                Offer preview is open. Review it, then confirm payment or cancel to return to the scanner.
              </div>
            ) : lastOrder ? (
              <div className="stack-layout" style={{ gap: 10 }}>
                <div className="pay42-stat-card">
                  <span className="minor-text">ORDER</span>
                  <strong>{lastOrder.sid}</strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">PRODUCT</span>
                  <strong>{lastOrder.product_name || "-"}</strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">STATUS</span>
                  <strong>{String(lastOrder.status || "").toUpperCase()}</strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">TOTAL</span>
                  <strong>{formatMetric(lastOrder.total_amount || 0)}</strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">CREATED</span>
                  <strong>{showDateTime(lastOrder.create_at)}</strong>
                </div>
              </div>
            ) : (
              <div className="minor-text">No payment completed yet in this session.</div>
            )}
          </div>
        </ResponsivePanel>
      </div>

      {paymentPreview ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(6, 10, 16, 0.84)",
            zIndex: 1000,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            className="panel"
            style={{
              width: "100%",
              maxWidth: "560px",
              borderRadius: "22px 22px 12px 12px",
              padding: "18px",
              display: "grid",
              gap: "16px",
              boxShadow: "0 30px 80px rgba(0,0,0,.45)",
            }}
          >
            <div className="stack-layout" style={{ gap: 6 }}>
              <span className="minor-text">PAYMENT PREVIEW</span>
              <strong style={{ fontSize: "24px" }}>
                {paymentPreview.offer?.metadata?.offer_name || paymentPreview.offer?.sid || "-"}
              </strong>
              <span className="minor-text">
                {previewSource === "camera"
                  ? "QR scanned successfully. Review this offer before paying."
                  : "Review this offer before paying from your wallet."}
              </span>
            </div>

            <div
              className="pay42-offer-hero"
              style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 14, alignItems: "center" }}
            >
              <Pay42MediaThumb
                src={paymentPreview.offer?.product_image}
                alt={paymentPreview.offer?.product_name || paymentPreview.offer?.sid || "offer"}
                label={paymentPreview.offer?.product_name || paymentPreview.offer?.sid || "offer"}
                className="pay42-thumb"
              />
              <div className="stack-layout" style={{ gap: 6 }}>
                <strong>{paymentPreview.offer?.product_name || "-"}</strong>
                <span className="minor-text">{paymentPreview.offer?.seller_id || "-"}</span>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 12,
              }}
            >
              <div className="pay42-stat-card">
                <span className="minor-text">SUBTOTAL</span>
                <strong>{formatMoney(paymentPreview.payment?.subtotal || 0)}</strong>
              </div>
              <div className="pay42-stat-card">
                <span className="minor-text">TAX</span>
                <strong>{formatMoney(paymentPreview.payment?.tax || 0)}</strong>
              </div>
              <div className="pay42-stat-card">
                <span className="minor-text">TOTAL</span>
                <strong>{formatMoney(paymentPreview.payment?.total_amount || 0)}</strong>
              </div>
              <div className="pay42-stat-card">
                <span className="minor-text">AVAILABLE AFTER PAYMENT</span>
                <strong>{formatMoney(paymentPreview.payment?.balance_after || 0)}</strong>
              </div>
            </div>

            {paymentPreview?.payment?.can_pay === false ? (
              <div className="error">
                Not enough wallet balance. Shortfall: {formatMoney(paymentPreview.payment?.shortfall || 0)}
              </div>
            ) : null}

            <div className="pay42-inline-actions" style={{ justifyContent: "stretch" }}>
              <button
                type="button"
                className="primary-button"
                disabled={settling || previewing || paymentPreview?.payment?.can_pay === false}
                onClick={confirmPayment}
                style={{ flex: 1 }}
              >
                {settling ? "Paying..." : "Pay Now"}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={settling || previewing}
                onClick={cancelPaymentPreview}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              {paymentPreview?.payment?.can_pay === false ? (
                <Link className="secondary-button" to="/admin/42pay/topup" style={{ flex: 1, textAlign: "center" }}>
                  Top Up Wallet
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
