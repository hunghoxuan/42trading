import { useState } from "react";
import type { ProductObservation } from "./api";
import type { Product } from "./storage";
import type { ProductForm } from "./workspace";
import { productToForm, recognitionToForm } from "./productEdit";
import ProductEditFields, { type ProductOptions } from "./ProductEditFields";
import { t, type Language } from "./i18n";

export type RecognitionCandidate = {
  product_sid: string; name: string; retail_price_minor: number | null; score: number;
  explanation: string; matched_keywords?: string[]; confidence?: string;
};
type EditorProps = {
  product: Product | null; observation: ProductObservation | null; image: string; language: Language;
  options: ProductOptions; defaults: { category: string; supplier: string }; online: boolean; busy: boolean;
  onSave: (form: ProductForm, product: Product | null) => Promise<void>;
  onNew: () => void; onAddToCart: () => void; onRecapture: () => void;
};

function RecognitionEditor({ product, observation, image, language, options, defaults, online, busy,
  onSave, onNew, onAddToCart, onRecapture }: EditorProps) {
  const tr = (value: string) => t(language, value);
  const [form, setForm] = useState(() => recognitionToForm(product, observation, image, defaults, "POSIMG" + Date.now()));
  const [saved, setSaved] = useState(() => product ? productToForm(product) : null);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  return <form className="pos-recognition-editor" onSubmit={async event => {
    event.preventDefault(); setError("");
    try { await onSave(form, product); setSaved(form); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }}>
    <div className="pay42-form-grid pos-form">
      <ProductEditFields form={form} onChange={setForm} options={options} language={language} stock={product?.on_hand || 0} compact />
    </div>
    {error && <div className="pos-alert pos-error" role="alert">{tr(error)}</div>}
    <div className="pos-recognition-editor__actions">
      <button type="submit" className="primary-button" disabled={!online || busy || !form.name.trim()}>
        <span aria-hidden="true">{product ? "↻" : "＋"}</span>{tr(product ? "Update" : "Add new")}
      </button>
      {product && <>
        <button type="button" className="secondary-button" disabled={busy} onClick={onNew}
          title={tr("Add as product")}><span aria-hidden="true">＋</span>{tr("Add new")}</button>
        <button type="button" className="secondary-button" disabled={busy || dirty || product.status !== "ACTIVE" || product.price_minor === null}
          title={tr(dirty ? "Save changes before adding to cart." : "Add to cart")} onClick={onAddToCart}>
          <span aria-hidden="true">🛒</span>{tr("Cart")}
        </button>
      </>}
      <button type="button" className="secondary-button" disabled={busy} onClick={onRecapture}>
        <span aria-hidden="true">▣</span>{tr("Photo")}
      </button>
    </div>
  </form>;
}

export default function RecognitionResult({ language, candidates, products, selectedSid, observation, image,
  backgroundRemoved, keywords, colors, options, defaults, online, busy, onSelect, onAddToCart, onSave, onRecapture, onClose, onPreview }: {
  language: Language; candidates: RecognitionCandidate[]; products: Product[]; selectedSid: string;
  observation: ProductObservation | null; image: string; backgroundRemoved: boolean;
  keywords: string[]; colors: string[]; options: ProductOptions; defaults: { category: string; supplier: string };
  online: boolean; busy: boolean; onSelect: (sid: string) => void; onAddToCart: () => void;
  onSave: EditorProps["onSave"]; onRecapture: () => void; onClose: () => void; onPreview: () => void;
}) {
  const tr = (value: string) => t(language, value);
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const primary = ranked.find(item => item.product_sid === selectedSid);
  const others = ranked.filter(item => item.product_sid !== primary?.product_sid);
  const product = products.find(item => item.sid === selectedSid) || null;
  const captureName = observation?.product_name || observation?.object_name || tr("Recognition result");
  const money = (value: number) => new Intl.NumberFormat(language === "vi" ? "vi-VN" : "en-US", {
    style: "currency", currency: "VND", maximumFractionDigits: 0,
  }).format(value);

  return <section className="card-flat pos-recognition-result" aria-label={tr("Image recognition result")}>
    <header className="pos-recognition-result__header">
      {image && <button type="button" className="pos-recognition-thumbnail" aria-label={tr("View captured product image")} onClick={onPreview}>
        <img src={image} alt={tr("Captured photo")} />
      </button>}
      <div className="pos-recognition-heading"><strong>{product?.name || captureName}</strong>
        <small className="minor-text">{primary ? tr("Potential inventory matches") : tr(busy ? "Finding the product…" : "New product")}</small>
      </div>
      <button type="button" className="secondary-button pos-recognition-result__close" aria-label={tr("Close")} disabled={busy} onClick={onClose}>×</button>
    </header>

    {(!busy || observation || ranked.length > 0) && <RecognitionEditor key={selectedSid || "new"}
      product={product} observation={observation} image={image} language={language} options={options} defaults={defaults}
      online={online} busy={busy} onSave={onSave} onNew={() => onSelect("")} onRecapture={onRecapture} onAddToCart={onAddToCart} />}

    {others.length > 0 && <details key={selectedSid} className="pos-recognition-disclosure">
      <summary>{tr("Other matches")} ({others.length})</summary>
      <div className="pos-recognition-alternatives">
        {others.map(candidate => <button key={candidate.product_sid} type="button" className="secondary-button" disabled={busy}
          onClick={() => onSelect(candidate.product_sid)}><span>{candidate.name}</span>
          <small>{candidate.retail_price_minor === null ? tr("No Price") : money(candidate.retail_price_minor)}</small>
        </button>)}
      </div>
    </details>}

    {observation && <details className="pos-recognition-disclosure">
      <summary>{tr("Photo details")}</summary>
      <div className="pos-recognition-capture__details">
        <span><strong>{tr("Keywords")}:</strong> {keywords.join(" · ") || tr("No keywords detected")}</span>
        <span><strong>{tr("Label text")}:</strong> {observation.texts.join(" · ") || tr("No label text detected")}</span>
        <span><strong>{tr("Price on label")}:</strong> {observation.visible_price?.text || tr("No visible price")}</span>
        {observation.brand && <span>{tr("Brand")}: {observation.brand}</span>}
        {colors.length > 0 && <span>{tr("Capture color")}: {colors.map(tr).join(" · ")}</span>}
        <small className="minor-text">{backgroundRemoved ? tr("Background removed from capture") : tr("Capture kept with its original background")}</small>
      </div>
    </details>}
  </section>;
}
