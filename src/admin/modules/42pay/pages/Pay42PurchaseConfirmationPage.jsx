import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import Pay42MediaThumb from "./Pay42MediaThumb";
import { showDateTime } from "../../../shared/utils/format";
import { formatMoney, statusTone } from "./pay42Ui";

export default function Pay42PurchaseConfirmationPage() {
  const { orderSid = "" } = useParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError("");
        const ordersOut = await api.pay42Orders();
        if (cancelled) return;
        setItems(Array.isArray(ordersOut?.items) ? ordersOut.items : []);
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError?.message || "Failed to load purchase confirmation");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const order = useMemo(
    () => items.find((item) => String(item.sid || "") === String(orderSid || "")) || null,
    [items, orderSid],
  );

  return (
    <section className="logs-page-container trades-page-container pay42-page-container stack-layout fadeIn">
      <PageHeader
        className="trades-page-header"
        title="Booking Confirmation"
        actions={
          <div className="pay42-inline-actions">
            <Link className="secondary-button" to="/admin/42pay/orders">
              My Purchases
            </Link>
            <Link className="secondary-button" to="/admin/42pay/scan">
              Back to Scan
            </Link>
          </div>
        }
      />

      {error ? <div className="error">{error}</div> : null}

      <ResponsivePanel
        title={loading ? "Loading purchase..." : order ? order.sid : "Purchase not found"}
        subtitle={loading ? "Preparing your booking confirmation" : "Payment completed successfully"}
        showToggle={false}
      >
        {loading ? (
          <div className="minor-text">Loading purchase confirmation...</div>
        ) : !order ? (
          <div className="stack-layout">
            <div className="error">We could not find that purchase in your wallet history.</div>
            <div className="pay42-inline-actions">
              <Link className="primary-button" to="/admin/42pay/orders">
                Open My Purchases
              </Link>
            </div>
          </div>
        ) : (
          <div className="stack-layout" style={{ gap: 18 }}>
            <div
              className="pay42-offer-hero"
              style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 16, alignItems: "center" }}
            >
              <Pay42MediaThumb
                src={order.product_image}
                alt={order.product_name || order.sid}
                label={order.product_name || order.sid}
                className="pay42-thumb"
              />
              <div className="stack-layout" style={{ gap: 8 }}>
                <strong style={{ fontSize: "24px" }}>{order.product_name || "-"}</strong>
                <span className="minor-text">{order.offer_name || "-"}</span>
                <span
                  className="minor-text"
                  style={{ color: statusTone(order.status), fontWeight: 700, letterSpacing: "0.08em" }}
                >
                  {String(order.status || "").toUpperCase()}
                </span>
              </div>
            </div>

            <div className="pay42-stat-card">
              <span className="minor-text">BUYER CONFIRMATION</span>
              <strong>Your payment has been completed and your booking is now in My Purchases.</strong>
              <span className="minor-text">
                Order reference: {order.sid}. You can reopen this purchase anytime from the buyer purchase history.
              </span>
            </div>

            <div className="pay42-inline-actions">
              <Link className="primary-button" to={`/admin/42pay/orders?focus=${encodeURIComponent(order.sid)}`}>
                View My Purchases
              </Link>
              <Link className="secondary-button" to="/admin/42pay/scan">
                Scan Another QR
              </Link>
              <Link className="secondary-button" to="/admin/42pay/topup">
                Top Up Wallet
              </Link>
            </div>
          </div>
        )}
      </ResponsivePanel>
    </section>
  );
}
