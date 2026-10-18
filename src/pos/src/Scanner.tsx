import { useState, type ReactNode } from "react";
import PhotoCamera from "./PhotoCamera";
import { readBarcodePhoto } from "./barcodeReader";
import { t, type Language } from "./i18n";

export default function Scanner({ onCode, onClose, onRecognize, language, initialMode = "barcode", errorAction }: {
  onCode: (value: string) => void; onClose: () => void; onRecognize: (file: File) => Promise<void>;
  language: Language; initialMode?: "barcode" | "recognize";
  errorAction?: ReactNode;
}) {
  const [manualCode, setManualCode] = useState("");
  const [mode, setMode] = useState<"barcode" | "recognize">(initialMode);
  const tr = (text: string) => t(language, text);
  return <PhotoCamera purpose={mode} language={language} onClose={onClose} errorAction={errorAction}
    onCapture={async (file, detectedCode) => {
      if (mode === "recognize") { await onRecognize(file); return; }
      const code = detectedCode || await readBarcodePhoto(file);
      if (!code) throw new Error("No readable barcode in this photo. Try a sharper close-up or enter the printed number below.");
      onCode(code);
    }} modeActions={<div className="pos-scanner-modes" role="group" aria-label={tr("Scan mode")}>
      <button type="button" className={mode === "barcode" ? "primary-button" : "secondary-button"} aria-pressed={mode === "barcode"} onClick={() => setMode("barcode")}>{tr("Scan barcode")}</button>
      <button type="button" className={mode === "recognize" ? "primary-button" : "secondary-button"} aria-pressed={mode === "recognize"} onClick={() => setMode("recognize")}>{tr("Recognize product")}</button>
    </div>}>
    {mode === "barcode" && <form className="stack-layout" onSubmit={(event) => { event.preventDefault(); if (manualCode.trim()) onCode(manualCode.trim()); }}>
      <label>{tr("Barcode / product code")}<input value={manualCode} onChange={(event) => setManualCode(event.target.value)} autoComplete="off" /></label>
      <button type="submit" className="secondary-button" disabled={!manualCode.trim()}>{tr("Use this code")}</button>
    </form>}
  </PhotoCamera>;
}
