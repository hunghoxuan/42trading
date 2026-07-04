import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import { showDateTime } from "../../../shared/utils/format";
import { formatMoney, statusTone } from "./pay42Ui";

const TOPUP_METHODS = [
  { value: "SEPA", label: "SEPA Bank Transfer" },
  { value: "PAYPAL", label: "PayPal" },
  { value: "CARD", label: "Credit Card" },
];

const PRESET_AMOUNTS = [50, 100, 250, 500];

export default function Pay42TopupPage() {
  const [wallet, setWallet] = useState(null);
  const [topups, setTopups] = useState([]);
  const [form, setForm] = useState({
    amount: "100",
    method: "SEPA",
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
    <section className="logs-page-container trades-page-container pay42-page-container stack-layout fadeIn">
      <PageHeader
        className="trades-page-header"
        title="Top Up Wallet"
        actions={
          <div className="pay42-inline-actions">
            <Link className="secondary-button" to="/admin/42pay/scan">
              Scan to Pay
            </Link>
            <Link className="secondary-button" to="/admin/42pay/orders">
              My Purchases
            </Link>
          </div>
        }
      />

      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success-msg">{success}</div> : null}

      <div className="pay42-split-layout">
        <ResponsivePanel
          title="Add Funds"
          subtitle="Choose a funding method and add money to the wallet"
          showToggle={false}
        >
          <form className="stack-layout" onSubmit={submit}>
            <div className="pay42-inline-actions" style={{ flexWrap: "wrap" }}>
              {PRESET_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={`secondary-button${String(form.amount) === String(amount) ? " is-active" : ""}`}
                  onClick={() => setForm((current) => ({ ...current, amount: String(amount) }))}
                >
                  {formatMoney(amount)}
                </button>
              ))}
            </div>

            <label className="pay42-form-field">
              <span className="minor-text">AMOUNT</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={form.amount}
                onChange={(event) =>
                  setForm((current) => ({ ...current, amount: event.target.value }))
                }
                placeholder="100"
              />
            </label>

            <label className="pay42-form-field">
              <span className="minor-text">PAYMENT METHOD</span>
              <InputComboSelect
                value={form.method}
                onChange={(event) =>
                  setForm((current) => ({ ...current, method: event.target.value }))
                }
              >
                {TOPUP_METHODS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </InputComboSelect>
            </label>

            <label className="pay42-form-field">
              <span className="minor-text">NOTE</span>
              <textarea
                rows={4}
                value={form.note}
                onChange={(event) =>
                  setForm((current) => ({ ...current, note: event.target.value }))
                }
                placeholder="Prototype reference or memo"
              />
            </label>

            <div className="pay42-stat-card">
              <span className="minor-text">FUNDING METHOD</span>
              <strong>
                {TOPUP_METHODS.find((item) => item.value === form.method)?.label || form.method}
              </strong>
              <span className="minor-text">
                Prototype mode applies funds immediately after confirmation. We can connect the real provider flow later.
              </span>
            </div>

            <div className="pay42-inline-actions">
              <button type="submit" className="primary-button" disabled={submitting}>
                {submitting ? "Adding Funds..." : "Top Up Wallet"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setForm({ amount: "100", method: "SEPA", note: "" })}
              >
                Clear
              </button>
            </div>
          </form>
        </ResponsivePanel>

        <ResponsivePanel
          title="Funding History"
          subtitle="Most recent wallet top-ups"
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
    </section>
  );
}
