import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import Pay42MediaThumb from "./Pay42MediaThumb";
import Pay42PageShell from "./Pay42PageShell";
import { showDateTime } from "../../../shared/utils/format";
import { formatMoney, statusTone } from "./pay42Ui";

const LOCAL_PAY_DRAFT_KEY = "pay42.local-pay-draft";

export default function Pay42PurchaseConfirmationPage() {
  const { orderSid = "" } = useParams();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [localDraft, setLocalDraft] = useState(null);

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

  useEffect(() => {
    if (searchParams.get("draft") !== "1") return;
    try {
      const raw = sessionStorage.getItem(LOCAL_PAY_DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (String(parsed?.sid || "") === String(orderSid || "")) {
        setLocalDraft(parsed);
      }
    } catch {
      // ignore storage errors
    }
  }, [orderSid, searchParams]);

  const order = useMemo(
    () => items.find((item) => String(item.sid || "") === String(orderSid || "")) || null,
    [items, orderSid],
  );
  const displayStatus = String(
    order?.status || localDraft?.status || "COMPLETED",
  ).toUpperCase();

  return (
    <Pay42PageShell>
      <PageHeader
        className="trades-page-header"
        title="Booking Confirmation"
        actions={
          <div className="pay42-inline-actions">
            <Link className="secondary-button" to="/admin/42pay/orders">
              My Purchases
            </Link>
            <Link className="secondary-button" to="/admin/42pay/scan">
              Back to Pay
            </Link>
          </div>
        }
      />

      {error ? <div className="error">{error}</div> : null}

      <ResponsivePanel
        title={
          loading
            ? "Loading payment..."
            : order
              ? order.sid
              : localDraft
                ? localDraft.sid
                : "Payment not found"
        }
        subtitle={loading ? "Preparing your payment confirmation" : "Payment completed successfully"}
        showToggle={false}
      >
        {loading ? (
          <div className="minor-text">Loading purchase confirmation...</div>
        ) : !order && !localDraft ? (
          <div className="stack-layout">
            <div className="error">We could not find that payment in your history.</div>
            <div className="pay42-inline-actions">
              <Link className="primary-button" to="/admin/42pay/orders">
                Open My Purchases
              </Link>
            </div>
          </div>
        ) : (
          <div className="stack-layout" style={{ gap: 18 }}>
            {order ? (
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
            ) : (
              <div className="pay42-stat-card">
                <span className="minor-text">PAYMENT METHOD</span>
                <strong>{localDraft?.label || "Wallet payment"}</strong>
                <span
                  className="minor-text"
                  style={{ color: statusTone(displayStatus), fontWeight: 700, letterSpacing: "0.08em" }}
                >
                  {displayStatus}
                </span>
              </div>
            )}

            <div className="pay42-stat-card">
              <span className="minor-text">PAYMENT CONFIRMATION</span>
              <strong>
                {order
                  ? "Your payment has been completed and your booking is now in My Purchases."
                  : localDraft?.subtitle || "Your payment request has been prepared successfully."}
              </strong>
              <span className="minor-text">
                Reference: {order?.sid || localDraft?.sid}. You can reopen this payment anytime from the purchase history.
              </span>
            </div>

            {!order && localDraft ? (
              <div className="stack-layout" style={{ gap: 10 }}>
                <div className="pay42-stat-card">
                  <span className="minor-text">AMOUNT</span>
                  <strong>{formatMoney(localDraft.amount || 0)}</strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">NOTE</span>
                  <strong>{localDraft.note || "-"}</strong>
                </div>
                <div className="pay42-stat-card">
                  <span className="minor-text">CREATED</span>
                  <strong>{showDateTime(localDraft.createdAt)}</strong>
                </div>
              </div>
            ) : null}

            <div className="pay42-inline-actions">
              <Link
                className="primary-button"
                to={
                  order
                    ? `/admin/42pay/orders?focus=${encodeURIComponent(order.sid)}`
                    : "/admin/42pay/orders"
                }
              >
                View My Purchases
              </Link>
              <Link className="secondary-button" to="/admin/42pay/scan">
                Back to Pay
              </Link>
              <Link className="secondary-button" to="/admin/42pay/topup">
                Top Up Wallet
              </Link>
            </div>
          </div>
        )}
      </ResponsivePanel>
    </Pay42PageShell>
  );
}
