import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import { showDateTime } from "../../../shared/utils/format";
import Pay42PageShell from "./Pay42PageShell";
import { formatMoney, statusTone } from "./pay42Ui";

const TOPUP_METHODS = [
  {
    value: "SEPA",
    label: "SEPA IBAN •• 0148",
    subtitle: "1–3 business days · No fee",
    arrival: "1–3 business days",
    fee: "$0.00",
    icon: "🏦",
  },
  {
    value: "CARD",
    label: "Visa •• 4291",
    subtitle: "Instant · No fee",
    arrival: "Instantly",
    fee: "$0.00",
    icon: "💳",
  },
  {
    value: "PAYPAL",
    label: "Gift Card Topup",
    subtitle: "USDC · ~10 min · Network fee applies",
    arrival: "~10 min",
    fee: "Network fee",
    icon: "◈",
  },
];

const PRESET_AMOUNTS = [10, 50, 100, 250];

export default function Pay42TopupPage() {
  const amountInputRef = useRef(null);
  const [wallet, setWallet] = useState(null);
  const [topups, setTopups] = useState([]);
  const [form, setForm] = useState({
    amount: "50",
    method: "CARD",
    note: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError("");
      const [walletOut, topupOut] = await Promise.all([
        api.pay42Wallet(),
        api.pay42WalletTopups(),
      ]);
      setWallet(walletOut?.wallet || null);
      setTopups(Array.isArray(topupOut?.items) ? topupOut.items : []);
    } catch (nextError) {
      setError(nextError?.message || "Failed to load wallet");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!amountInputRef.current) return;
    amountInputRef.current.style.setProperty("font-size", "42px", "important");
  }, []);

  const selectedMethod = useMemo(
    () => TOPUP_METHODS.find((item) => item.value === form.method) || TOPUP_METHODS[0],
    [form.method],
  );

  async function submit(event) {
    event.preventDefault();
    try {
      setSubmitting(true);
      setError("");
      setSuccess("");
      const out = await api.pay42TopupWallet({
        amount: Number(form.amount || 0),
        method: form.method,
        metadata: {
          note: form.note,
          provider_label:
            TOPUP_METHODS.find((item) => item.value === form.method)?.label || form.method,
        },
      });
      setWallet(out?.wallet || null);
      setTopups((current) => [out?.topup, ...current].filter(Boolean));
      setSuccess(
        `Top up completed via ${
          TOPUP_METHODS.find((item) => item.value === form.method)?.label || form.method
        }. New balance: ${formatMoney(out?.wallet?.balance || 0)}.`,
      );
      setForm((current) => ({ ...current, note: "" }));
    } catch (nextError) {
      setError(nextError?.message || "Failed to top up wallet");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Pay42PageShell>
      <PageHeader
        className="trades-page-header"
        title="TOP UP"
      />

      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success-msg">{success}</div> : null}

      <div className="pay42-split-layout">
        <ResponsivePanel
          title=""
          subtitle=""
          showToggle={false}
          className="pay42-topup-panel"
        >
          <form className="stack-layout pay42-topup-form" onSubmit={submit}>
            <label className="pay42-topup-amount-display" aria-label="Top up amount">
              <span className="pay42-topup-amount-currency" style={{ fontSize: "26px" }}>
                $
              </span>
              <input
                ref={amountInputRef}
                type="number"
                min="1"
                step="0.01"
                value={form.amount}
                onChange={(event) =>
                  setForm((current) => ({ ...current, amount: event.target.value }))
                }
                className="pay42-topup-amount-input"
                placeholder="50"
                style={{
                  lineHeight: 0.92,
                  fontWeight: 900,
                  minHeight: 0,
                  height: "auto",
                  padding: 0,
                  border: 0,
                  background: "transparent",
                }}
              />
            </label>

            <div className="pay42-topup-chip-row">
              {PRESET_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={`pay42-topup-chip${String(form.amount) === String(amount) ? " is-active" : ""}`}
                  onClick={() => setForm((current) => ({ ...current, amount: String(amount) }))}
                >
                  {`$${amount}`}
                </button>
              ))}
              <button
                type="button"
                className={`pay42-topup-chip${!PRESET_AMOUNTS.includes(Number(form.amount)) ? " is-active" : ""}`}
                onClick={() => setForm((current) => ({ ...current, amount: "" }))}
              >
                Custom
              </button>
            </div>

            <div className="minor-text pay42-topup-section-label">FUNDING SOURCE</div>

            <div className="pay42-topup-method-list">
              {TOPUP_METHODS.map((item) => {
                const active = item.value === form.method;
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={`pay42-topup-method-card${active ? " is-active" : ""}`}
                    onClick={() =>
                      setForm((current) => ({ ...current, method: item.value }))
                    }
                  >
                    <span className="pay42-topup-method-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="pay42-topup-method-copy">
                      <span className="pay42-topup-method-name">{item.label}</span>
                      <span className="pay42-topup-method-subtitle">{item.subtitle}</span>
                    </span>
                    <span className="pay42-topup-method-radio" aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            <div className="pay42-topup-meta-row">
              <span>Fee</span>
              <span>{selectedMethod?.fee || "$0.00"}</span>
            </div>
            <div className="pay42-topup-meta-row">
              <span>Arrives</span>
              <span>{selectedMethod?.arrival || "Instantly"}</span>
            </div>

            <button
              type="submit"
              className="pay42-topup-confirm"
              disabled={submitting}
            >
              {submitting
                ? "Confirming top up..."
                : `Confirm top up of ${formatMoney(Number(form.amount || 0))}`}
            </button>
          </form>
        </ResponsivePanel>

        <ResponsivePanel
          title="Recent Top Ups"
          subtitle="Wallet funding activity"
          showToggle={false}
        >
          <div className="stack-layout">
            {topups.length === 0 ? (
              <div className="minor-text">No top up records yet.</div>
            ) : (
              topups.map((topup) => (
                <article
                  key={topup.sid}
                  className="pay42-list-row"
                  style={{
                    border: "1px solid var(--panel-border, rgba(120,140,180,.2))",
                    borderRadius: 14,
                    padding: 14,
                  }}
                >
                  <div className="pay42-inline-actions" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div className="cell-wrap">
                      <strong>{formatMoney(topup.amount || 0)}</strong>
                      <span className="minor-text">{topup.sid}</span>
                    </div>
                    <span
                      className="minor-text"
                      style={{ color: statusTone(topup.status), fontWeight: 700, letterSpacing: "0.08em" }}
                    >
                      {String(topup.status || "").toUpperCase()}
                    </span>
                  </div>
                  <div className="pay42-inline-actions" style={{ justifyContent: "space-between", marginTop: 8 }}>
                    <span className="minor-text">{String(topup.method || "").toUpperCase()}</span>
                    <span className="minor-text">{showDateTime(topup.create_at)}</span>
                  </div>
                  {topup.metadata?.note ? (
                    <div className="minor-text" style={{ marginTop: 8 }}>
                      {topup.metadata.note}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </ResponsivePanel>
      </div>
    </Pay42PageShell>
  );
}
