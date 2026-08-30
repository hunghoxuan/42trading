import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../app/api";
import PageHeader from "../../../../shared/components/PageHeader";
import AdminPageToolbar from "../../../../shared/components/AdminPageToolbar";
import { useConfirmDialog } from "../../../../shared/components/ConfirmDialog";

const TRADE_CHAIN_MODES = ["Now", "Wait_confirm"];

function tradeChainMode(item = {}) {
  if (item.trade_chain_mode) return String(item.trade_chain_mode);
  return item.entry_bar_mode === "First_bar_same_trend" ? "Wait_confirm" : "Now";
}

function displayTime(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function displayNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "-";
}

function editableAction(item = {}) {
  return {
    ...item,
    symbol: String(item.symbol || ""),
    side: String(item.side || "BUY").toUpperCase(),
    tf: String(item.tf || ""),
    trade_chain_slot: Math.max(1, Math.min(3, Number(item.trade_chain_slot) || 1)),
    trade_chain_mode: tradeChainMode(item),
    strategy_id: String(item.strategy_id || ""),
    source_label: String(item.source_label || ""),
    entry: item.entry ?? "",
    secondary_entry: item.secondary_entry ?? "",
    sl: item.sl ?? "",
    tp: item.tp ?? "",
    note: String(item.note || ""),
    use_limit_order: Boolean(item.use_limit_order),
    require_htf_bias: Boolean(item.require_htf_bias),
  };
}

function queuePatch(form) {
  const numeric = (value) => {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return {
    account_id: form.account_id,
    symbol: String(form.symbol || "").trim().toUpperCase(),
    side: String(form.side || "BUY").toUpperCase(),
    tf: String(form.tf || "").trim().toLowerCase(),
    trade_chain_slot: form.trade_chain_slot,
    trade_chain_mode: form.trade_chain_mode,
    entry_bar_mode: form.trade_chain_mode === "Wait_confirm"
      ? "First_bar_same_trend"
      : "First_bar_after_trigger",
    strategy_id: String(form.strategy_id || "").trim(),
    source_label: String(form.source_label || "").trim(),
    entry: numeric(form.entry),
    secondary_entry: numeric(form.secondary_entry),
    sl: numeric(form.sl),
    tp: numeric(form.tp),
    note: String(form.note || "").trim(),
    use_limit_order: Boolean(form.use_limit_order),
    require_htf_bias: Boolean(form.require_htf_bias),
  };
}

export default function TradeQueuePage() {
  const confirm = useConfirmDialog();
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [queue, accountResult] = await Promise.all([
        api.tradeQueue(accountId ? { account_id: accountId } : {}),
        accounts.length ? Promise.resolve(null) : api.v2Accounts().catch(() => ({ items: [] })),
      ]);
      const nextItems = Array.isArray(queue?.items) ? queue.items : [];
      setItems(nextItems);
      if (accountResult) setAccounts(Array.isArray(accountResult.items) ? accountResult.items : []);
      if (selectedId) {
        const selected = nextItems.find((item) => item.action_id === selectedId);
        setForm(selected ? editableAction(selected) : null);
        if (!selected) setSelectedId("");
      }
      setError("");
    } catch (loadError) {
      setError(loadError?.message || "Failed to load the trade queue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [accountId]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [item.symbol, item.side, item.tf, item.strategy_id, item.source_label, tradeChainMode(item), item.trade_chain_slot]
        .some((value) => String(value || "").toLowerCase().includes(query)),
    );
  }, [items, search]);

  function selectItem(item) {
    setSelectedId(item.action_id);
    setForm(editableAction(item));
    setMessage("");
  }

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!form?.action_id) return;
    setSaving(true);
    try {
      const result = await api.updateTradeQueueItem(form.action_id, queuePatch(form));
      const next = editableAction(result.item || form);
      setItems((current) => current.map((item) => item.action_id === next.action_id ? next : item));
      setForm(next);
      setMessage("Queue item updated. cTrader will apply it on the next sync.");
      setError("");
    } catch (saveError) {
      setError(saveError?.message || "Failed to update the queue item.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item = form) {
    if (!item?.action_id) return;
    const accepted = await confirm({
      title: "Remove queue item?",
      message: `${item.symbol || "Trade"} ${item.side || ""} ${item.tf || ""} will no longer execute.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!accepted) return;
    setSaving(true);
    try {
      await api.deleteTradeQueueItem(item.action_id, { account_id: item.account_id });
      setItems((current) => current.filter((candidate) => candidate.action_id !== item.action_id));
      if (selectedId === item.action_id) {
        setSelectedId("");
        setForm(null);
      }
      setMessage("Queue item removed. cTrader will drop it on the next sync.");
      setError("");
    } catch (removeError) {
      setError(removeError?.message || "Failed to remove the queue item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="logs-page-container trades-page-container trade-queue-page stack-layout">
      <PageHeader
        title="Trade Queue"
        actions={
          <button type="button" className="secondary-button" onClick={load} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        }
      />
      <AdminPageToolbar
        className="trade-queue-toolbar"
        filters={
          <div className="toolbar-group trade-queue-filters">
            <input
              aria-label="Search queue"
              placeholder="Search queue..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              aria-label="Queue account"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.account_id} value={account.account_id}>
                  {account.name || account.account_id}
                </option>
              ))}
            </select>
            <span className="minor-text">{filteredItems.length} waiting</span>
          </div>
        }
      />
      {error ? <div className="form-message error">{error}</div> : null}
      {message ? <div className="form-message">{message}</div> : null}

      <div className="trade-queue-layout">
        <div className="panel trade-queue-list-panel">
          <div className="trade-queue-table-wrap">
            <table className="table-dense trade-queue-table">
              <thead>
                <tr>
                  <th>Trigger</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>TF</th>
                  <th>Trade</th>
                  <th>Entry</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>Strategy</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr
                    key={item.action_id}
                    className={selectedId === item.action_id ? "selected-item" : ""}
                    onClick={() => selectItem(item)}
                  >
                    <td>{displayTime(item.trigger_time)}</td>
                    <td className="cell-major">{item.symbol || "-"}</td>
                    <td className={String(item.side).toUpperCase() === "BUY" ? "money-pos" : "money-neg"}>
                      {item.side || "-"}
                    </td>
                    <td>{item.tf || "-"}</td>
                    <td>#{Math.max(1, Number(item.trade_chain_slot) || 1)} {tradeChainMode(item).replaceAll("_", " ")}</td>
                    <td>{displayNumber(item.entry)}</td>
                    <td>{displayNumber(item.sl)}</td>
                    <td>{displayNumber(item.tp)}</td>
                    <td>{item.strategy_id || item.source_label || "-"}</td>
                    <td>
                      <div className="trade-queue-row-actions">
                        <button type="button" className="secondary-button" onClick={(event) => { event.stopPropagation(); selectItem(item); }}>
                          Edit
                        </button>
                        <button type="button" className="danger-button" onClick={(event) => { event.stopPropagation(); remove(item); }}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && filteredItems.length === 0 ? (
                  <tr><td colSpan="10" className="minor-text">No waiting queue actions.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel trade-queue-editor">
          <span className="panel-label">Queue item</span>
          {!form ? <div className="minor-text">Select an item to inspect or edit it.</div> : (
            <div className="trade-queue-form">
              <label><span>Symbol</span><input value={form.symbol} onChange={(event) => setField("symbol", event.target.value)} /></label>
              <label><span>Side</span><select value={form.side} onChange={(event) => setField("side", event.target.value)}><option>BUY</option><option>SELL</option></select></label>
              <label><span>Timeframe</span><input value={form.tf} onChange={(event) => setField("tf", event.target.value)} /></label>
              <label><span>Trade stage</span><input value={`#${form.trade_chain_slot}`} readOnly /></label>
              <label><span>Trade timing</span><select value={form.trade_chain_mode} onChange={(event) => setField("trade_chain_mode", event.target.value)}>{TRADE_CHAIN_MODES.map((mode) => <option key={mode} value={mode}>{mode.replaceAll("_", " ")}</option>)}</select></label>
              <label><span>Entry</span><input type="number" step="any" value={form.entry} onChange={(event) => setField("entry", event.target.value)} /></label>
              <label><span>2nd entry</span><input type="number" step="any" value={form.secondary_entry} onChange={(event) => setField("secondary_entry", event.target.value)} /></label>
              <label><span>Stop loss</span><input type="number" step="any" value={form.sl} onChange={(event) => setField("sl", event.target.value)} /></label>
              <label><span>Take profit</span><input type="number" step="any" value={form.tp} onChange={(event) => setField("tp", event.target.value)} /></label>
              <label><span>Strategy</span><input value={form.strategy_id} onChange={(event) => setField("strategy_id", event.target.value)} /></label>
              <label><span>Source</span><input value={form.source_label} onChange={(event) => setField("source_label", event.target.value)} /></label>
              <label className="trade-queue-check"><input type="checkbox" checked={form.use_limit_order} onChange={(event) => setField("use_limit_order", event.target.checked)} /><span>Use limit order</span></label>
              <label className="trade-queue-check"><input type="checkbox" checked={form.require_htf_bias} onChange={(event) => setField("require_htf_bias", event.target.checked)} /><span>Require HTF bias</span></label>
              <label className="trade-queue-field-wide"><span>Note</span><textarea rows="3" value={form.note} onChange={(event) => setField("note", event.target.value)} /></label>
              <div className="minor-text trade-queue-field-wide">ID: {form.action_id}<br />Account: {form.account_id || "-"}</div>
              <div className="trade-queue-editor-actions trade-queue-field-wide">
                <button type="button" className="primary-button" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
                <button type="button" className="danger-button" onClick={() => remove(form)} disabled={saving}>Remove</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
