import React, { useState, useEffect, useMemo } from "react";
import { api } from "../../../app/api";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import InputComboSelect from "../../../shared/components/InputComboSelect";

export function SizeCalculator({ accountId, initialSymbol = "" }) {
  const [accounts, setAccounts] = useState([]);
  const [selectedAid, setSelectedAid] = useState(accountId || "");
  const [symbol, setSymbol] = useState(initialSymbol || "");
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [riskType, setRiskType] = useState("money"); // "money" or "percent"
  const [riskVal, setRiskVal] = useState("100");
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.v2Accounts().then(res => {
      if (res.ok && Array.isArray(res.items)) {
        setAccounts(res.items);
        if (!selectedAid && res.items.length > 0) {
          setSelectedAid(res.items[0].account_id);
        }
      }
    });
  }, []);

  const account = useMemo(() => accounts.find(a => a.account_id === selectedAid), [accounts, selectedAid]);
  const metricsList = useMemo(() => account?.metadata?.symbol_metrics || [], [account]);
  const metrics = useMemo(() => {
    if (!symbol) return null;
    const s = symbol.toUpperCase().replace("/", "");
    return metricsList.find(m => m.symbol.toUpperCase().replace("/", "") === s) || null;
  }, [metricsList, symbol]);

  useEffect(() => {
    if (metrics && !entry) {
        // could auto-fill entry if we had last price
    }
  }, [metrics]);

  const calculate = () => {
    const e = parseFloat(entry);
    const s = parseFloat(sl);
    const r = parseFloat(riskVal);
    if (!e || !s || !r || !metrics || !account) {
      setResult(null);
      return;
    }

    const diff = Math.abs(e - s);
    if (diff === 0) {
        setResult(null);
        return;
    }

    const balance = parseFloat(account.balance || 0);
    const riskAmount = riskType === "percent" ? (balance * r) / 100 : r;

    // Risk per unit: (Price Diff) * (Value of 1 Price Unit in Account Currency)
    // PipValue is value of 1 Pip (PipSize) for 1 Unit.
    // Value of 1 Price Unit = PipValue / PipSize
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

  return (
    <ResponsivePanel
      title="Size Calculator"
      className="fadeIn"
      width={320}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="toolbar-group">
          <InputComboSelect 
            value={selectedAid} 
            onChange={e => setSelectedAid(e.target.value)}
            style={{ flex: 1, fontSize: 12 }}
          >
            <option value="">Select Account</option>
            {accounts.map(a => (
              <option key={a.account_id} value={a.account_id}>
                {a.name || a.account_id} (${parseFloat(a.balance || 0).toFixed(0)})
              </option>
            ))}
          </InputComboSelect>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="cell-wrap">
            <span className="minor-text">Symbol</span>
            <input 
              list="calc-symbols"
              value={symbol} 
              onChange={e => setSymbol(e.target.value)} 
              placeholder="e.g. GBPJPY"
              style={{ padding: '6px' }}
            />
            <datalist id="calc-symbols">
              {metricsList.map(m => <option key={m.symbol} value={m.symbol} />)}
            </datalist>
          </div>
          <div className="cell-wrap">
             <span className="minor-text">Risk ({riskType === 'money' ? '$' : '%'})</span>
             <div style={{ display: 'flex', gap: 4 }}>
                <input 
                  type="number" 
                  value={riskVal} 
                  onChange={e => setRiskVal(e.target.value)}
                  style={{ flex: 1, padding: '6px' }}
                />
                <button 
                  className="secondary-button" 
                  onClick={() => setRiskType(riskType === 'money' ? 'percent' : 'money')}
                >
                  {riskType === 'money' ? '$' : '%'}
                </button>
             </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <div className="cell-wrap">
            <span className="minor-text">Entry</span>
            <input type="number" step="any" value={entry} onChange={e => setEntry(e.target.value)} style={{ padding: '6px' }} />
          </div>
          <div className="cell-wrap">
            <span className="minor-text">Stop Loss</span>
            <input type="number" step="any" value={sl} onChange={e => setSl(e.target.value)} style={{ padding: '6px' }} />
          </div>
          <div className="cell-wrap">
            <span className="minor-text">Take Profit</span>
            <input type="number" step="any" value={tp} onChange={e => setTp(e.target.value)} style={{ padding: '6px' }} />
          </div>
        </div>

        {result ? (
          <div style={{ marginTop: 8, padding: 12, background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--border)' }}>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                   <div className="minor-text">POSITION SIZE</div>
                   <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>
                      {result.lots.toFixed(2)} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>lots</span>
                   </div>
                   <div className="minor-text" style={{ fontSize: 10 }}>{Math.round(result.units).toLocaleString()} units</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                   <div className="minor-text">EST. RISK</div>
                   <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
                      ${result.actualRisk.toFixed(2)}
                   </div>
                   <div className="minor-text" style={{ fontSize: 10 }}>
                      {riskType === 'percent' ? `${((result.actualRisk / parseFloat(account.balance)) * 100).toFixed(2)}%` : `$${result.riskAmount.toFixed(2)} target`}
                   </div>
                </div>
             </div>
             {result.rr && (
               <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="minor-text">Risk:Reward</span>
                  <span style={{ fontWeight: 700, color: result.rr >= 2 ? '#10b981' : 'var(--text)' }}>1 : {result.rr.toFixed(2)}</span>
               </div>
             )}
          </div>
        ) : (
          <div className="minor-text" style={{ textAlign: 'center', padding: '20px 0', border: '1px dashed var(--border)', borderRadius: 8 }}>
            Enter parameters to calculate size
          </div>
        )}

        {metrics && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, opacity: 0.7, fontSize: 10 }}>
               <div>Spread: <span style={{ color: 'var(--text)' }}>{metrics.spread}</span></div>
               <div>Pip Val (Lot): <span style={{ color: 'var(--text)' }}>${(metrics.pip_value * 100000).toFixed(2)}</span></div>
               <div>Min: <span style={{ color: 'var(--text)' }}>{metrics.min_vol.toLocaleString()}</span></div>
            </div>
            {metrics.updated_at && (
              <div className="minor-text" style={{ fontSize: 8, opacity: 0.5, textAlign: 'right' }}>
                Broker data sync: {new Date(metrics.updated_at).toLocaleTimeString()}
              </div>
            )}
          </div>
        )}
      </div>
    </ResponsivePanel>
  );
}
