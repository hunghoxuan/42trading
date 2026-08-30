import { useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import TabBar from "../../../shared/components/TabBar";

const KIND_OPTIONS = [
  { value: "rules", label: "Rules" },
  { value: "events", label: "Events" },
  { value: "strategies", label: "Strategies" },
];

const MODE_OPTIONS = [
  { value: "simple", label: "Simple" },
  { value: "json", label: "JSON" },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultItem(kind) {
  const suffix = Date.now().toString(36);
  if (kind === "strategies") {
    return {
      id: `custom_strategy_${suffix}`,
      key: `custom_strategy_${suffix}`,
      name: "Custom Strategy",
      kind: "custom",
      engine_version: "42trade.strategy.v2",
      status: "draft",
      params: {},
      indicators: [],
      rules: [
        {
          id: "entry",
          name: "Entry",
          when: "ema20 > ema9 and rsi > 70",
          actions: [{ id: "draw_entry", action: "draw", message: "Entry" }],
        },
      ],
      risk: {},
    };
  }
  const singular = kind === "events" ? "event" : "rule";
  return {
    id: `custom_${singular}_${suffix}`,
    name: `Custom ${singular[0].toUpperCase()}${singular.slice(1)}`,
    kind: "custom",
    implementation: { type: "expression" },
    ...(kind === "events"
      ? { when: "ema20 > ema9 and rsi > 70", outputs: { bias: "bullish" } }
      : {
          abbr: "CUSTOM",
          condition: "ema20 > ema9 and rsi > 70",
          outputs: { bias: "bullish", marker: "dot" },
        }),
  };
}

function expressionForItem(kind, item = {}) {
  const value = kind === "rules" ? item?.condition ?? item?.expression : item?.when ?? item?.expression;
  if (typeof value === "string") return value;
  return value && typeof value === "object" ? JSON.stringify(value, null, 2) : "";
}

function setExpression(kind, item, value) {
  const key = kind === "rules" ? "condition" : "when";
  return { ...item, [key]: value };
}

function CatalogField({ label, children }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span className="panel-label" style={{ fontSize: 10 }}>{label}</span>
      {children}
    </label>
  );
}

export default function SharedCatalogPage() {
  const [kind, setKind] = useState("rules");
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(null);
  const [jsonText, setJsonText] = useState("");
  const [mode, setMode] = useState("simple");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const selected = useMemo(
    () => items.find((item) => String(item?.id || item?.key) === selectedId) || null,
    [items, selectedId],
  );

  async function load(nextKind = kind, preferredId = "") {
    setLoading(true);
    setMessage("");
    try {
      const result = await api.listSharedCatalog(nextKind);
      const nextItems = Array.isArray(result?.items) ? result.items : [];
      setItems(nextItems);
      const nextId =
        preferredId ||
        (nextItems.some((item) => String(item?.id || item?.key) === selectedId)
          ? selectedId
          : String(nextItems[0]?.id || nextItems[0]?.key || ""));
      setSelectedId(nextId);
      const nextSelected = nextItems.find(
        (item) => String(item?.id || item?.key) === nextId,
      );
      setDraft(nextSelected ? clone(nextSelected) : null);
      setJsonText(nextSelected ? JSON.stringify(nextSelected, null, 2) : "");
    } catch (error) {
      setMessage(String(error?.message || error || "Failed to load shared catalog"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(kind);
    // Reload only when the catalog type changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => {
    if (!selected) return;
    const nextDraft = clone(selected);
    setDraft(nextDraft);
    setJsonText(JSON.stringify(nextDraft, null, 2));
  }, [selected]);

  function createNew() {
    const next = defaultItem(kind);
    setSelectedId("__new__");
    setDraft(next);
    setJsonText(JSON.stringify(next, null, 2));
    setMode(kind === "strategies" ? "json" : "simple");
    setMessage("");
  }

  function changeMode(nextMode) {
    if (nextMode === mode) return;
    if (nextMode === "json") {
      setJsonText(JSON.stringify(draft || {}, null, 2));
      setMode(nextMode);
      return;
    }
    try {
      setDraft(JSON.parse(jsonText));
      setMode(nextMode);
      setMessage("");
    } catch (error) {
      setMessage(`Fix the JSON before switching modes: ${error.message}`);
    }
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const payload = mode === "json" ? JSON.parse(jsonText) : draft;
      const result = await api.saveSharedCatalogItem(kind, payload);
      const item = result?.item || payload;
      const itemId = String(item?.id || item?.key || "");
      await load(kind, itemId);
      setMessage(`Saved ${kind.slice(0, -1)}: ${itemId}`);
    } catch (error) {
      setMessage(String(error?.message || error || "Failed to save catalog item"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const itemId = String(draft?.id || draft?.key || "");
    if (!itemId || selectedId === "__new__") return;
    if (!window.confirm(`Delete ${kind.slice(0, -1)} "${itemId}"?`)) return;
    setSaving(true);
    setMessage("");
    try {
      await api.deleteSharedCatalogItem(kind, itemId);
      setSelectedId("");
      await load(kind);
      setMessage(`Deleted ${kind.slice(0, -1)}: ${itemId}`);
    } catch (error) {
      setMessage(String(error?.message || error || "Failed to delete catalog item"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <PageHeader title="SHARED ENGINE CATALOG" />
      <div className="minor-text">
        These files are the common source for cTrader, chart analysis, replay, and backtests.
        Expressions may be readable text or JSON trees.
      </div>
      {message ? (
        <div className="toolbar-panel"><div className="minor-text">{message}</div></div>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <ResponsivePanel
          headerContent={<TabBar value={kind} options={KIND_OPTIONS} onChange={setKind} size="sm" />}
          showToggle={false}
          border="always"
          bodyClassName="stack-layout"
        >
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="secondary-button" onClick={() => load(kind)} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
            <button type="button" className="primary-button" onClick={createNew}>+ New</button>
          </div>
          <div style={{ display: "grid", gap: 6, maxHeight: "68vh", overflowY: "auto" }}>
            {items.map((item) => {
              const id = String(item?.id || item?.key || "");
              const active = id === selectedId;
              return (
                <button
                  key={id}
                  type="button"
                  className={active ? "primary-button" : "secondary-button"}
                  onClick={() => setSelectedId(id)}
                  style={{ textAlign: "left", justifyContent: "flex-start", minHeight: 42 }}
                >
                  <span style={{ display: "grid", gap: 2 }}>
                    <strong>{item?.name || id}</strong>
                    <span style={{ fontSize: 10, opacity: 0.72 }}>{id}</span>
                  </span>
                </button>
              );
            })}
            {!loading && !items.length ? <div className="minor-text">No shared files yet.</div> : null}
          </div>
        </ResponsivePanel>

        <ResponsivePanel
          headerContent={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <strong>{draft?.name || "Select a catalog item"}</strong>
              {draft ? <TabBar value={mode} options={MODE_OPTIONS} onChange={changeMode} size="sm" /> : null}
            </div>
          }
          showToggle={false}
          border="always"
          bodyClassName="stack-layout"
        >
          {!draft ? <div className="minor-text">Choose an item or create a new one.</div> : null}
          {draft && mode === "simple" ? (
            <div className="stack-layout" style={{ gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12 }}>
                <CatalogField label="ID">
                  <input
                    value={draft.id || draft.key || ""}
                    onChange={(event) => setDraft({ ...draft, id: event.target.value, ...(kind === "strategies" ? { key: event.target.value } : {}) })}
                  />
                </CatalogField>
                <CatalogField label="NAME">
                  <input value={draft.name || ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                </CatalogField>
              </div>
              {kind !== "strategies" ? (
                <>
                  <CatalogField label="IMPLEMENTATION">
                    <select
                      value={draft?.implementation?.type || "expression"}
                      onChange={(event) => setDraft({
                        ...draft,
                        implementation: { ...(draft.implementation || {}), type: event.target.value },
                      })}
                    >
                      <option value="expression">Text / JSON expression</option>
                      <option value="builtin">Built-in engine handler</option>
                    </select>
                  </CatalogField>
                  {(draft?.implementation?.type || "expression") === "builtin" ? (
                    <CatalogField label="BUILT-IN HANDLER ID">
                      <input
                        value={draft?.implementation?.handler || ""}
                        onChange={(event) => setDraft({ ...draft, implementation: { ...draft.implementation, handler: event.target.value } })}
                      />
                    </CatalogField>
                  ) : (
                    <CatalogField label="EXPRESSION">
                      <textarea
                        rows={9}
                        value={expressionForItem(kind, draft)}
                        onChange={(event) => setDraft(setExpression(kind, draft, event.target.value))}
                        placeholder="ema20 > ema9 and rsi > 70"
                        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: 1.6 }}
                      />
                    </CatalogField>
                  )}
                </>
              ) : (
                <div className="minor-text">
                  Strategies contain indicators, rules, actions, and risk settings. Use JSON mode for the complete document; every rule or event `when` field may still contain a simple text expression.
                </div>
              )}
            </div>
          ) : null}
          {draft && mode === "json" ? (
            <textarea
              rows={28}
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              spellCheck={false}
              style={{ width: "100%", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: 1.5 }}
            />
          ) : null}
          {draft ? (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="danger-button" onClick={remove} disabled={saving || selectedId === "__new__"}>Delete</button>
              <button type="button" className="primary-button" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save shared file"}</button>
            </div>
          ) : null}
        </ResponsivePanel>
      </div>
    </section>
  );
}
