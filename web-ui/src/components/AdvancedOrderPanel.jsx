import React, { useState, useEffect, useMemo } from "react";
import { api } from "../api";
import { NotificationHub } from "../services/NotificationHub";

export function AdvancedOrderPanel({
  accountId,
  initialSymbol = "",
  onOrderPlaced,
}) {
  const [accounts, setAccounts] = useState([]);
  const [selectedAid, setSelectedAid] = useState(accountId || "");
  const [symbol, setSymbol] = useState(initialSymbol || "");
  const [side, setSide] = useState("BUY");
  const [orderType, setOrderType] = useState("market");

  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");

  const [riskType, setRiskType] = useState("money"); // "money" or "percent"
  const [riskVal, setRiskVal] = useState("100");
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.v2Accounts().then((res) => {
      if (res.ok && Array.isArray(res.items)) {
        setAccounts(res.items);
        if (!selectedAid && res.items.length > 0) {
          setSelectedAid(res.items[0].account_id);
        }
      }
    });
  }, []);

  const account = useMemo(
    () => accounts.find((a) => a.account_id === selectedAid),
    [accounts, selectedAid],
  );
  const metricsList = useMemo(
    () => account?.metadata?.symbol_metrics || [],
    [account],
  );
  const metrics = useMemo(() => {
    if (!symbol) return null;
    const s = symbol.toUpperCase().replace("/", "");
    return (
      metricsList.find((m) => m.symbol.toUpperCase().replace("/", "") === s) ||
      null
    );
  }, [metricsList, symbol]);

  const calculate = () => {
    const e = parseFloat(entry);
    const s = parseFloat(sl);
    const r = parseFloat(riskVal);

    if (!metrics || !account || isNaN(r)) {
      setResult(null);
      return;
    }

    const balance = parseFloat(account.balance || 0);
    const riskAmount = riskType === "percent" ? (balance * r) / 100 : r;

    // Default to min volume if no SL
    if (!e || !s || Math.abs(e - s) === 0) {
      setResult({
        units: metrics.min_vol,
        lots: metrics.min_vol / 100000,
        actualRisk: 0,
        rr: null,
        riskAmount,
      });
      return;
    }

    const diff = Math.abs(e - s);
    const valueOfOnePriceUnit = metrics.pip_value / metrics.pip_size;
    const riskPerUnit = diff * valueOfOnePriceUnit;

    let units = riskAmount / riskPerUnit;

    // Apply broker constraints
    if (metrics.min_vol && units < metrics.min_vol) units = metrics.min_vol;
    if (metrics.step_vol) {
      units = Math.floor(units / metrics.step_vol) * metrics.step_vol;
    }

    const lots = units / 100000;
    const actualRisk = units * riskPerUnit;

    // RR
    let rr = null;
    const t = parseFloat(tp);
    if (t) {
      const reward = Math.abs(t - e);
      rr = reward / diff;
    }

    setResult({ units, lots, actualRisk, rr, riskAmount });
  };

  useEffect(() => {
    calculate();
  }, [entry, sl, tp, riskVal, riskType, metrics, account]);

  const handlePlaceOrder = async () => {
    if (!symbol || !result || busy) return;
    setError("");
    setBusy(true);
    try {
      const payload = {
        symbol: symbol.toUpperCase(),
        action: side,
        volume: result.lots,
        trade_type: orderType,
        entry: parseFloat(entry) || null,
        sl: parseFloat(sl) || null,
        tp: parseFloat(tp) || null,
        note: note,
        source: "MANUAL",
        account_id: selectedAid,
      };

      const { promise: signalPromise } = NotificationHub.track(
        "create_signal",
        { symbol: payload.symbol },
        () => api.createDraftTrade(payload),
      );
      const res = await signalPromise;
      if (res.ok) {
        if (onOrderPlaced) onOrderPlaced(res);
        // reset form partly?
      } else {
        setError(res.error || "Execution failed");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel fadeIn" style={{ minWidth: 320 }}>
      <div
        className="panel-label"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>Advanced Order</span>
        {busy && <div className="spinner" style={{ width: 12, height: 12 }} />}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Side & Type Selector */}
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "rgba(255,255,255,0.03)",
            padding: 2,
            borderRadius: 6,
          }}
        >
          <button
            className={side === "BUY" ? "primary-button" : "secondary-button"}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 4,
              background: side === "BUY" ? "#10b981" : "transparent",
              color: side === "BUY" ? "black" : "var(--text)",
            }}
            onClick={() => setSide("BUY")}
          >
            BUY
          </button>
          <button
            className={side === "SELL" ? "primary-button" : "secondary-button"}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 4,
              background: side === "SELL" ? "#ef4444" : "transparent",
              color: side === "SELL" ? "black" : "var(--text)",
            }}
            onClick={() => setSide("SELL")}
          >
            SELL
          </button>
        </div>

        <div className="toolbar-group">
          <select
            value={selectedAid}
            onChange={(e) => setSelectedAid(e.target.value)}
            style={{ flex: 1, fontSize: 12 }}
          >
            <option value="">Select Account</option>
            {accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.name || a.account_id} ($
                {parseFloat(a.balance || 0).toFixed(0)})
              </option>
            ))}
          </select>
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value)}
            style={{ width: 90, fontSize: 12 }}
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
            <option value="stop">Stop</option>
          </select>
        </div>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
        >
          <div className="cell-wrap">
            <span className="minor-text">Symbol</span>
            <input
              list="order-symbols"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. GBPJPY"
              style={{ padding: "6px" }}
            />
            <datalist id="order-symbols">
              {metricsList.map((m) => (
                <option key={m.symbol} value={m.symbol} />
              ))}
            </datalist>
          </div>
          <div className="cell-wrap">
            <span className="minor-text">
              Risk ({riskType === "money" ? "$" : "%"})
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <input
                type="number"
                value={riskVal}
                onChange={(e) => setRiskVal(e.target.value)}
                style={{ flex: 1, padding: "6px" }}
              />
              <button
                className="secondary-button"
                style={{ padding: "0 8px", fontSize: 10 }}
                onClick={() =>
                  setRiskType(riskType === "money" ? "percent" : "money")
                }
              >
                {riskType === "money" ? "$" : "%"}
              </button>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8,
          }}
        >
          <div className="cell-wrap">
            <span className="minor-text">Entry</span>
            <input
              type="number"
              step="any"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder={orderType === "market" ? "Auto" : ""}
              style={{ padding: "6px" }}
            />
          </div>
          <div className="cell-wrap">
            <span className="minor-text">Stop Loss</span>
            <input
              type="number"
              step="any"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
              style={{ padding: "6px" }}
            />
          </div>
          <div className="cell-wrap">
            <span className="minor-text">Take Profit</span>
            <input
              type="number"
              step="any"
              value={tp}
              onChange={(e) => setTp(e.target.value)}
              style={{ padding: "6px" }}
            />
          </div>
        </div>

        {/* Dynamic RR & Size Info */}
        {result && (
          <div
            style={{
              padding: 12,
              background: "rgba(255,255,255,0.02)",
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div>
                <div className="minor-text">ORDER SIZE</div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: side === "BUY" ? "#10b981" : "#ef4444",
                  }}
                >
                  {result.lots.toFixed(2)}{" "}
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 400,
                      color: "var(--muted)",
                    }}
                  >
                    lots
                  </span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="minor-text">EST. RISK</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>
                  ${result.actualRisk.toFixed(2)}
                </div>
              </div>
            </div>
            {result.rr && (
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: "1px solid var(--border)",
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                }}
              >
                <span className="minor-text">Reward Ratio</span>
                <span style={{ fontWeight: 700 }}>
                  1 : {result.rr.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="cell-wrap">
          <span className="minor-text">Order Note</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Strategy or context..."
            style={{
              height: 40,
              padding: 6,
              fontSize: 11,
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
            }}
          />
        </div>

        {error && (
          <div className="msg-error" style={{ fontSize: 10 }}>
            {error}
          </div>
        )}

        <button
          className="primary-button"
          disabled={!result || busy || !symbol}
          onClick={handlePlaceOrder}
          style={{
            height: 40,
            fontSize: 14,
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          {busy ? "Processing..." : `Place ${side} ${orderType}`}
        </button>

        {metrics && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              opacity: 0.5,
              fontSize: 9,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Spread: {metrics.spread}</span>
              <span>Pip Val: ${metrics.pip_value.toFixed(5)}</span>
            </div>
            {metrics.updated_at && (
              <div>
                Broker sync: {new Date(metrics.updated_at).toLocaleTimeString()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
