import { useState } from "react";
import PhotoCamera from "./PhotoCamera";
import { readBarcodePhoto } from "./barcodeReader";
import { t, type Language } from "./i18n";

export default function Scanner({ onCode, onClose, onRecognize, language }: {
  onCode: (value: string) => void; onClose: () => void; onRecognize: () => void; language: Language;
}) {
  const [manualCode, setManualCode] = useState("");
  const tr = (text: string) => t(language, text);
  return <PhotoCamera purpose="barcode" language={language} onClose={onClose}
    onCapture={async (file, detectedCode) => {
      const code = detectedCode || await readBarcodePhoto(file);
      if (!code) throw new Error("No readable barcode in this photo. Try a sharper close-up or enter the printed number below.");
      onCode(code);
    }} extraActions={<button type="button" className="secondary-button" onClick={onRecognize}>{tr("Recognize photo")}</button>}>
    <form className="stack-layout" onSubmit={(event) => { event.preventDefault(); if (manualCode.trim()) onCode(manualCode.trim()); }}>
      <label>{tr("Barcode / product code")}<input value={manualCode} onChange={(event) => setManualCode(event.target.value)} autoComplete="off" /></label>
      <button type="submit" className="secondary-button" disabled={!manualCode.trim()}>{tr("Use this code")}</button>
    </form>
  </PhotoCamera>;
}
