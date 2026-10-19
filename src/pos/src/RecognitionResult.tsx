import type { ProductObservation } from "./api";
import type { Product } from "./storage";
import { t, type Language } from "./i18n";

export type RecognitionCandidate = {
  product_sid: string; name: string; retail_price_minor: number | null; score: number;
  explanation: string; matched_keywords?: string[]; confidence?: string;
};

export default function RecognitionResult({ language, candidates, products, selectedSid, observation, image,
  backgroundRemoved, keywords, colors, online, busy, onSelect, onAddToCart, onMatch, onCreate, onClose, onPreview }: {
  language: Language; candidates: RecognitionCandidate[]; products: Product[]; selectedSid: string;
  observation: ProductObservation | null; image: string; backgroundRemoved: boolean;
  keywords: string[]; colors: string[]; online: boolean; busy: boolean;
  onSelect: (sid: string) => void; onAddToCart: () => void; onMatch: () => void;
  onCreate: () => void; onClose: () => void; onPreview: () => void;
}) {
  const tr = (value: string) => t(language, value);
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const primary = ranked.find((item) => item.product_sid === selectedSid) || ranked[0];
  const others = ranked.filter((item) => item.product_sid !== primary?.product_sid);
  const product = primary && products.find((item) => item.sid === primary.product_sid);
  const money = (value: number) => new Intl.NumberFormat(language === "vi" ? "vi-VN" : "en-US", {
    style: "currency", currency: "VND", maximumFractionDigits: 0,
  }).format(value);
  const captureName = observation?.product_name || observation?.object_name || tr("Recognition result");
  const price = (item: RecognitionCandidate) => {
    const current = products.find((p) => p.sid === item.product_sid);
    return current?.price_minor === null || current?.price_minor === undefined ? tr("No Price") : money(current.price_minor);
  };

  return <section className="card-flat pos-recognition-result" aria-label={tr("Image recognition result")}>
    <header className="pos-recognition-result__header">
      {image && <button type="button" className="pos-recognition-thumbnail" aria-label={tr("View captured product image")} onClick={onPreview}>
        <img src={image} alt="" />
      </button>}
      <div className="pos-recognition-heading"><strong>{captureName}</strong>
        <small className="minor-text">{primary ? tr("Potential inventory matches") : tr(busy ? "Finding the product…" : "No matching products.")}</small>
      </div>
      <button type="button" className="secondary-button pos-recognition-result__close" aria-label={tr("Close")} onClick={onClose}>×</button>
    </header>

    {primary && <div className="pos-recognition-primary" aria-label={tr("Selected inventory match")}>
      <div className="pos-recognition-primary__product">
        {product?.image && <img className="pos-product-image" src={product.image} alt="" />}
        <div className="pos-recognition-primary__copy">
          <strong>{primary.name}</strong>
          <small>{price(primary)}{product?.sku ? ` · ${product.sku}` : ""}</small>
          <small className="minor-text">{primary.confidence === "high" ? tr("Strong label match") : tr("Please check the product")}</small>
        </div>
      </div>
      <div className="pos-recognition-primary__actions">
        {observation && image && <button type="button" className="primary-button" disabled={!online || busy || !selectedSid} onClick={onMatch}>{tr("Match and save image")}</button>}
        <button type="button" className="secondary-button" disabled={busy || !selectedSid} onClick={onAddToCart}>{tr("Add to cart")}</button>
      </div>
    </div>}

    {others.length > 0 && <details key={primary?.product_sid} className="pos-recognition-disclosure">
      <summary>{tr("Other matches")} ({others.length})</summary>
      <div className="pos-recognition-alternatives">
        {others.map((candidate) => <button key={candidate.product_sid} type="button" className="secondary-button"
          onClick={() => onSelect(candidate.product_sid)}>
          <span>{candidate.name}</span><small>{price(candidate)}</small>
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
        <small className="minor-text">{tr("Register prices come from inventory.")}</small>
        <button type="button" className="secondary-button" disabled={!online || busy || !observation.product_name && !observation.object_name}
          onClick={onCreate}>{tr("Add as product")}</button>
      </div>
    </details>}
  </section>;
}
