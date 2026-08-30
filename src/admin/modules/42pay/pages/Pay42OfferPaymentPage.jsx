import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../app/api";
import { showDateTime } from "../../../shared/utils/format";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import Pay42MediaThumb from "./Pay42MediaThumb";
import Pay42PageShell from "./Pay42PageShell";
import { formatMoney } from "./pay42Ui";

export default function Pay42OfferPaymentPage() {
  const { sid } = useParams();
  const [offer, setOffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const out = await api.pay42Offers();
        const items = Array.isArray(out?.items) ? out.items : [];
        const match = items.find(
          (row) => String(row.sid || "") === String(sid || ""),
        );
        if (cancelled) return;
        if (!match) {
          setError("Offer not found.");
          return;
        }
        setOffer(match);
      } catch (nextError) {
        if (!cancelled) setError(nextError?.message || "Failed to load offer");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sid]);

  return (
    <Pay42PageShell>
      <PageHeader className="trades-page-header" title="Offer Payment" />

      {error ? <div className="error">{error}</div> : null}
      {loading ? <div className="loading">Loading offer…</div> : null}

      {!loading && offer ? (
        <div className="stack-layout pay42-payment-page">
          <ResponsivePanel
            title="Payment QR"
            subtitle={offer.sid}
            showToggle={false}
            className="pay42-form-field--full"
          >
            <div className="pay42-offer-hero pay42-offer-hero--qr-only">
              <Pay42MediaThumb
                src={offer.qr_code_image}
                alt={`${offer.sid} qr`}
                label={offer.sid}
                className="pay42-qr-thumb pay42-qr-thumb--detail"
                kind="qr"
              />
            </div>
          </ResponsivePanel>

          <ResponsivePanel
            title="Offer Overview"
            subtitle="Read-only summary"
            showToggle={false}
            className="pay42-form-field--full"
          >
            <div className="stack-layout">
              <div className="cell-wrap">
                <strong style={{ fontSize: "22px" }}>
                  {offer.metadata?.offer_name || offer.product_name || offer.sid}
                </strong>
                <span className="minor-text">{offer.product_name || "-"}</span>
              </div>
              <div className="pay42-offer-metrics">
                <div className="pay42-stat-card">
                  <span className="minor-text">BASE</span>
                  <strong>{formatMoney(offer.price)}</strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">TAX</span>
                  <strong>{formatMoney(offer.tax)}</strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">TOTAL</span>
                  <strong>
                    {formatMoney(Number(offer.price || 0) + Number(offer.tax || 0))}
                  </strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">STATUS</span>
                  <strong>{String(offer.status || "-").toUpperCase()}</strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">VALID UNTIL</span>
                  <strong>{showDateTime(offer.end_at)}</strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">INVENTORY</span>
                  <strong>{offer.metadata?.inventory || 0}</strong>
                </div>
              </div>
              <div className="pay42-inline-actions">
                <Link
                  className="primary-button"
                  to={`/admin/42pay/scan?qr=${encodeURIComponent(offer.qr_code || "")}`}
                >
                  Scan QR / Pay
                </Link>
                <Link className="secondary-button" to="/admin/42pay/offers">
                  Back to Offers
                </Link>
              </div>
            </div>
          </ResponsivePanel>
        </div>
      ) : null}
    </Pay42PageShell>
  );
}
