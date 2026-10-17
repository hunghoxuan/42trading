import { useEffect, useMemo, useRef, useState } from "react";
import { posApi } from "./api";
import { changePage, VND_DENOMINATIONS, type CashNote } from "./cashChange";
import PhotoCamera from "./PhotoCamera";
import { t, type Language } from "./i18n";

async function cashPhotoData(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error("Choose a PNG, JPEG, or WebP image under 12 MB");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read cash photo");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally { URL.revokeObjectURL(url); }
}

function ChangeOptions({ amount, denominations, language }: { amount: number; denominations: number[]; language: Language }) {
  const [page, setPage] = useState(0);
  const result = useMemo(() => changePage(amount, denominations, page), [amount, denominations, page]);
  const number = (value: number) => value.toLocaleString(language === "vi" ? "vi-VN" : "en-US");
  const tr = (text: string) => t(language, text);
  return <div className="pos-change-options">
    {!result.items.length ? <p className="pos-error" role="status">{tr("These denominations cannot make exact change. Select more denominations.")}</p>
      : <><ol start={page * 5 + 1} className="pos-change-list" aria-label={tr("Ways to return change")}>
        {result.items.map((notes, index) => <li key={page * 5 + index}>
          {notes.map(note => `${note.quantity} × ${number(note.denomination)}`).join(" + ")} <span className="minor-text">VND</span>
        </li>)}
      </ol><div className="pos-row">
        <small className="minor-text">{tr("Page")} {page + 1}</small>
        <div className="pay42-inline-actions">
          <button type="button" className="secondary-button" disabled={!page} onClick={() => setPage(value => value - 1)}>{tr("Previous")}</button>
          <button type="button" className="secondary-button" disabled={!result.hasMore} onClick={() => setPage(value => value + 1)}>{tr("More ways")}</button>
        </div>
      </div></>}
  </div>;
}

export default function CashPayment({ cash, total, language, online, disabled, onCashChange }: {
  cash: string; total: number; language: Language; online: boolean; disabled: boolean; onCashChange: (cash: string) => void;
}) {
  const tr = (text: string) => t(language, text);
  const money = (value: number) => new Intl.NumberFormat(language === "vi" ? "vi-VN" : "en-US", {
    style: "currency", currency: "VND", maximumFractionDigits: 0,
  }).format(value);
  const [camera, setCamera] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ image: string; notes: CashNote[]; uncertain: boolean; unrecognized: number } | null>(null);
  const [denominations, setDenominations] = useState(() => VND_DENOMINATIONS.filter(value => value >= 1000));
  const upload = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  useEffect(() => {
    requestId.current++; setReview(null); setRecognizing(false); setError("");
  }, [cash, total, online]);
  useEffect(() => () => { requestId.current++; }, []);
  const received = Number(cash);
  const valid = Boolean(cash.trim()) && Number.isSafeInteger(received) && received >= 0;
  const change = valid && received >= total && total > 0 ? received - total : 0;
  const reviewedTotal = review?.notes.reduce((sum, note) => sum + note.denomination * note.quantity, 0) ?? 0;
  const reviewValid = !!review?.notes.length && review.notes.every(note => Number.isSafeInteger(note.quantity) && note.quantity >= 0)
    && Number.isSafeInteger(reviewedTotal) && reviewedTotal > 0;

  async function recognize(file: File) {
    const request = ++requestId.current;
    setRecognizing(true); setError(""); setReview(null);
    try {
      const image = await cashPhotoData(file);
      if (request !== requestId.current) return;
      const result = await posApi.recognizeCash(image);
      if (request !== requestId.current) return;
      setReview({ image, notes: result.notes, uncertain: result.uncertain, unrecognized: result.unrecognized_count });
    } catch (cause) {
      if (request === requestId.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (request === requestId.current) setRecognizing(false); }
  }

  return <div className="pos-cash-payment">
    <label>{tr("Cash received")}<input type="number" min="0" step="1" value={cash}
      disabled={disabled} onChange={event => onCashChange(event.target.value)} /></label>
    <div className="pay42-inline-actions">
      <button type="button" className="secondary-button" disabled={disabled || !online || recognizing} onClick={() => setCamera(true)}>{tr("Photograph cash")}</button>
      <button type="button" className="secondary-button" disabled={disabled || !online || recognizing} onClick={() => upload.current?.click()}>{tr("Upload cash photo")}</button>
    </div>
    {!online && <small className="minor-text">{tr("Cash photo recognition needs a connection. You can enter the amount manually.")}</small>}
    {recognizing && <p role="status">{tr("Counting visible banknotes…")}</p>}
    {error && <p className="pos-error" role="alert">{tr(error)}</p>}
    {review && <section className="card-flat pos-cash-review" aria-label={tr("Review recognized cash")}>
      <div className="pos-row"><strong>{tr("Review recognized cash")}</strong>
        <button type="button" className="secondary-button" aria-label={tr("Dismiss cash photo")} onClick={() => setReview(null)}>×</button></div>
      <img src={review.image} alt={tr("Cash photo")} className="pos-cash-photo" />
      <small className="minor-text">{tr("Check each denomination and count before using this amount.")}</small>
      {review.uncertain && <p className="pos-cash-warning" role="status">{tr("Some notes may be unclear or hidden. Review the counts.")}
        {review.unrecognized > 0 && ` (${review.unrecognized} ${tr("unrecognized notes")})`}</p>}
      {!review.notes.length && <p>{tr("No VND banknotes identified. Try a clearer photo or enter the amount manually.")}</p>}
      {review.notes.map((note, index) => <div className="pos-cash-note-row" key={index}>
        <select aria-label={`${tr("Denomination")} ${index + 1}`} value={note.denomination} onChange={event => {
          const denomination = Number(event.target.value);
          setReview(current => current && ({ ...current, notes: current.notes.map((item, i) => i === index ? { ...item, denomination } : item) }));
        }}>{VND_DENOMINATIONS.map(value => <option key={value} value={value}>{money(value)}</option>)}</select>
        <span aria-hidden="true">×</span>
        <input type="number" min="0" step="1" aria-label={`${tr("Note count")} ${index + 1}`} value={Number.isNaN(note.quantity) ? "" : note.quantity}
          onChange={event => { const quantity = event.target.value === "" ? NaN : Number(event.target.value);
            setReview(current => current && ({ ...current, notes: current.notes.map((item, i) => i === index ? { ...item, quantity } : item) })); }} />
      </div>)}
      <button type="button" className="secondary-button" onClick={() => setReview(current => current && ({ ...current,
        notes: [...current.notes, { denomination: 1000, quantity: 1 }] }))}>{tr("Add denomination")}</button>
      <strong>{tr("Detected total")}: {reviewValid ? money(reviewedTotal) : "—"}</strong>
      <button type="button" className="primary-button" disabled={!reviewValid || disabled} onClick={() => {
        onCashChange(String(reviewedTotal)); setReview(null);
      }}>{tr("Use this amount")}</button>
    </section>}
    {cash.trim() && !valid && <small className="pos-error">{tr("Enter a non-negative whole VND amount.")}</small>}
    {valid && received < total && <small className="pos-error">{tr("Still due")}: {money(total - received)}</small>}
    <p className="pos-cash-change">{tr("Change")}: <strong>{money(change)}</strong></p>
    {change > 0 && <section className="pos-change-breakdown" aria-label={tr("Change breakdown")}>
      <strong>{tr("Ways to return change")}</strong>
      <details><summary>{tr("Available denominations")}</summary>
        <div className="pos-cash-denominations">{VND_DENOMINATIONS.map(value => <label key={value}>
          <input type="checkbox" checked={denominations.includes(value)} onChange={event => setDenominations(current => event.target.checked
            ? [...current, value] : current.filter(item => item !== value))} />{money(value)}
        </label>)}</div>
        <small className="minor-text">{tr("Choose denominations you have. Note quantities in the drawer are not tracked.")}</small>
      </details>
      <small className="minor-text">{tr("All combinations, in pages. Larger denominations first.")}</small>
      <ChangeOptions key={`${change}:${denominations.join(",")}`} amount={change} denominations={denominations} language={language} />
    </section>}
    <input ref={upload} className="pos-photo-upload" type="file" accept="image/png,image/jpeg,image/webp" aria-label={tr("Upload cash photo")}
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void recognize(file); }} />
    {camera && <PhotoCamera purpose="cash" language={language} onClose={() => setCamera(false)} onCapture={recognize}
      onUpload={() => { setCamera(false); upload.current?.click(); }} />}
  </div>;
}
