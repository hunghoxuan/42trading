import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { showToast } from "../../components/ToastContainer";

// ── Constants (copied from SettingsPage) ────────────────────────────────────

const API_KEY_NAME_OPTIONS = [
  { value: "GEMINI_API_KEY", label: "Gemini API Key" },
  { value: "OPENAI_API_KEY", label: "OpenAI API Key" },
  { value: "DEEPSEEK_API_KEY", label: "DeepSeek API Key" },
  { value: "CLAUDE_API_KEY", label: "Claude API Key" },
  { value: "OPENROUTER_API_KEY", label: "OpenRouter API Key" },
  { value: "TWELVE_DATA_API_KEY", label: "Twelve Data API Key" },
];

const TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

const DISPLAY_TIMEZONE_OPTIONS = [
  { value: "Local", label: "Local (Browser)" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York (America/New_York)" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseSymbolText(value) {
  return parseTextList(value, true);
}

function parseTextList(value, uppercase = false) {
  return [
    ...new Set(
      String(value || "")
        .split(/[\n,]/)
        .map((s) => {
          const trimmed = s.trim();
          return uppercase ? trimmed.toUpperCase() : trimmed;
        })
        .filter(Boolean),
    ),
  ];
}

// ── Component ───────────────────────────────────────────────────────────────

export default function CronPage() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Individual save messages per cron
  const [marketSaveMsg, setMarketSaveMsg] = useState("");
  const [marketSaveLoading, setMarketSaveLoading] = useState(false);
  const [analysisSaveMsg, setAnalysisSaveMsg] = useState("");
  const [analysisSaveLoading, setAnalysisSaveLoading] = useState(false);

  // MARKET_DATA_CRON local form
  const [marketForm, setMarketForm] = useState({
    provider: "twelvedata",
    timezone: "America/New_York",
    batch_size: 8,
    symbols: "",
    exclude_symbols: "",
    timeframes: [],
  });

  // ANALYSIS_CRON local form
  const [analysisForm, setAnalysisForm] = useState({
    directions: ["BUY", "SELL"],
    order_types: ["market", "limit", "stop"],
    cadence_minutes: 60,
    model: "claude-sonnet-4-0",
    profile: "",
    entry_models: "",
    prompt: "",
  });

  // ── Derived settings ────────────────────────────────────────────────────

  const marketDataCron = useMemo(
    () =>
      settings.find(
        (s) => s?.type === "cron" && s?.name === "MARKET_DATA_CRON",
      ) || null,
    [settings],
  );

  const analysisCron = useMemo(
    () =>
      settings.find(
        (s) => s?.type === "cron" && s?.name === "ANALYSIS_CRON",
      ) || null,
    [settings],
  );

  // ── Load settings on mount ──────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const res = await api.getSettings();
        if (!cancelled) {
          setSettings(Array.isArray(res?.settings) ? res.settings : []);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || String(err || "Failed to load settings"));
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

  // ── Populate market form when marketDataCron loads/changes ──────────────

  useEffect(() => {
    if (!marketDataCron) {
      setMarketForm({
        provider: "twelvedata",
        timezone: "America/New_York",
        batch_size: 8,
        symbols: "",
        exclude_symbols: "",
        timeframes: [],
      });
      return;
    }
    const d = marketDataCron.data || {};
    setMarketForm({
      provider: String(d.provider || "twelvedata"),
      timezone: String(d.timezone || "America/New_York"),
      batch_size: Number(d.batch_size || 8),
      symbols: Array.isArray(d.symbols) ? d.symbols.join(", ") : "",
      exclude_symbols: Array.isArray(d.exclude_symbols)
        ? d.exclude_symbols.join(", ")
        : "",
      timeframes: Array.isArray(d.timeframes) ? d.timeframes : [],
    });
  }, [marketDataCron]);

  // ── Populate analysis form when analysisCron loads/changes ──────────────

  useEffect(() => {
    if (!analysisCron) {
      setAnalysisForm({
        directions: ["BUY", "SELL"],
        order_types: ["market", "limit", "stop"],
        cadence_minutes: 60,
        model: "claude-sonnet-4-0",
        profile: "",
        entry_models: "",
        prompt: "",
      });
      return;
    }
    const d = analysisCron.data || {};
    setAnalysisForm({
      directions: Array.isArray(d.directions)
        ? d.directions
        : ["BUY", "SELL"],
      order_types: Array.isArray(d.order_types)
        ? d.order_types
        : ["market", "limit", "stop"],
      cadence_minutes: Number(d.cadence_minutes || 60),
      model: String(d.model || "claude-sonnet-4-0"),
      profile: String(d.profile || ""),
      entry_models: Array.isArray(d.entry_models)
        ? d.entry_models.join(", ")
        : "",
      prompt: String(d.prompt || ""),
    });
  }, [analysisCron]);

  // ── Save handlers ───────────────────────────────────────────────────────

  async function saveMarketDataCron() {
    if (!marketDataCron) {
      setMarketSaveMsg("MARKET_DATA_CRON setting not found.");
      return;
    }
    setMarketSaveLoading(true);
    setMarketSaveMsg("");
    const payload = {
      type: marketDataCron.type,
      name: marketDataCron.name,
      data: {
        provider: marketForm.provider,
        timezone: marketForm.timezone,
        batch_size: marketForm.batch_size,
        symbols: parseSymbolText(marketForm.symbols),
        exclude_symbols: parseSymbolText(marketForm.exclude_symbols),
        timeframes: marketForm.timeframes,
      },
      status: marketDataCron.status || "active",
    };
    try {
      await api.upsertSetting(payload);
      const msg = "MARKET_DATA_CRON saved.";
      setMarketSaveMsg(msg);
      showToast({ message: msg, type: "success" });
      // Reload to pick up the saved data
      const res = await api.getSettings();
      setSettings(Array.isArray(res?.settings) ? res.settings : []);
    } catch (err) {
      const errMsg = err?.message || String(err || "Save failed");
      setMarketSaveMsg(errMsg);
      showToast({ message: errMsg, type: "error" });
    } finally {
      setMarketSaveLoading(false);
      window.setTimeout(() => setMarketSaveMsg(""), 5000);
    }
  }

  async function saveAnalysisCron() {
    if (!analysisCron) {
      setAnalysisSaveMsg("ANALYSIS_CRON setting not found.");
      return;
    }
    setAnalysisSaveLoading(true);
    setAnalysisSaveMsg("");
    const payload = {
      type: analysisCron.type,
      name: analysisCron.name,
      data: {
        directions: analysisForm.directions,
        order_types: analysisForm.order_types,
        cadence_minutes: analysisForm.cadence_minutes,
        model: analysisForm.model,
        profile: analysisForm.profile,
        entry_models: parseTextList(analysisForm.entry_models),
        prompt: analysisForm.prompt,
      },
      status: analysisCron.status || "active",
    };
    try {
      await api.upsertSetting(payload);
      const msg = "ANALYSIS_CRON saved.";
      setAnalysisSaveMsg(msg);
      showToast({ message: msg, type: "success" });
      // Reload to pick up the saved data
      const res = await api.getSettings();
      setSettings(Array.isArray(res?.settings) ? res.settings : []);
    } catch (err) {
      const errMsg = err?.message || String(err || "Save failed");
      setAnalysisSaveMsg(errMsg);
      showToast({ message: errMsg, type: "error" });
    } finally {
      setAnalysisSaveLoading(false);
      window.setTimeout(() => setAnalysisSaveMsg(""), 5000);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="stack-layout fadeIn" style={{ padding: 40 }}>
        <p className="minor-text">Loading cron settings…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="stack-layout fadeIn" style={{ padding: 40 }}>
        <p className="minor-text" style={{ color: "var(--danger)" }}>
          {loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <h2 className="page-title">Cron Settings</h2>

      {/* ──────── MARKET_DATA_CRON ──────── */}
      <section className="panel" style={{ margin: 0 }}>
        <div className="panel-label">MARKET DATA CRON</div>

        {!marketDataCron ? (
          <p className="minor-text" style={{ padding: "12px 0" }}>
            MARKET_DATA_CRON setting not found. Create it in Settings first.
          </p>
        ) : (
          <div className="stack-layout" style={{ gap: 20, maxWidth: 600 }}>
            {/* Row: Provider / Display Timezone / Batch Size */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
              }}
            >
              <label className="stack-layout" style={{ gap: 6 }}>
                <span className="minor-text">Provider</span>
                <select
                  value={marketForm.provider}
                  onChange={(e) =>
                    setMarketForm((p) => ({ ...p, provider: e.target.value }))
                  }
                >
                  <option value="twelvedata">Twelve Data</option>
                </select>
              </label>

              <label className="stack-layout" style={{ gap: 6 }}>
                <span className="minor-text">Display Timezone</span>
                <select
                  value={marketForm.timezone}
                  onChange={(e) =>
                    setMarketForm((p) => ({
                      ...p,
                      timezone: e.target.value,
                    }))
                  }
                >
                  {DISPLAY_TIMEZONE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="stack-layout" style={{ gap: 6 }}>
                <span className="minor-text">Batch Size</span>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={marketForm.batch_size}
                  onChange={(e) =>
                    setMarketForm((p) => ({
                      ...p,
                      batch_size: Number(e.target.value),
                    }))
                  }
                />
              </label>
            </div>

            {/* Symbols */}
            <div className="stack-layout" style={{ gap: 8 }}>
              <span
                className="panel-label"
                style={{ fontSize: 10, marginBottom: 0 }}
              >
                SYMBOLS (COMMA OR NEWLINE)
              </span>
              <textarea
                rows={3}
                value={marketForm.symbols}
                onChange={(e) =>
                  setMarketForm((p) => ({ ...p, symbols: e.target.value }))
                }
                placeholder="e.g. XAUUSD, EURUSD, BTCUSD"
              />
            </div>

            {/* Exclude Symbols */}
            <div className="stack-layout" style={{ gap: 8 }}>
              <span
                className="panel-label"
                style={{ fontSize: 10, marginBottom: 0 }}
              >
                EXCLUDE SYMBOLS (COMMA OR NEWLINE)
              </span>
              <textarea
                rows={2}
                value={marketForm.exclude_symbols}
                onChange={(e) =>
                  setMarketForm((p) => ({
                    ...p,
                    exclude_symbols: e.target.value,
                  }))
                }
                placeholder="e.g. XAUUSD (skip these)"
              />
            </div>

            {/* Timeframes */}
            <div className="stack-layout" style={{ gap: 8 }}>
              <span
                className="panel-label"
                style={{ fontSize: 10, marginBottom: 0 }}
              >
                TIMEFRAMES
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {TIMEFRAME_OPTIONS.map((tf) => (
                  <label
                    key={tf}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={marketForm.timeframes.includes(tf)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...marketForm.timeframes, tf]
                          : marketForm.timeframes.filter((x) => x !== tf);
                        setMarketForm((p) => ({ ...p, timeframes: next }));
                      }}
                    />
                    <span style={{ fontSize: 13 }}>{tf}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Save button */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                paddingTop: 20,
                borderTop: "1px solid var(--border)",
              }}
            >
              <button
                className="primary-button"
                style={{ padding: "12px 32px", fontSize: 14 }}
                onClick={saveMarketDataCron}
                disabled={marketSaveLoading}
              >
                {marketSaveLoading ? "SAVING..." : "SAVE MARKET DATA CRON"}
              </button>
            </div>

            {marketSaveMsg && (
              <div
                className="minor-text"
                style={{
                  color: marketSaveMsg.toLowerCase().includes("fail")
                    ? "var(--danger)"
                    : "var(--success)",
                }}
              >
                {marketSaveMsg}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ──────── ANALYSIS_CRON ──────── */}
      <section className="panel" style={{ margin: 0 }}>
        <div className="panel-label">ANALYSIS CRON</div>

        {!analysisCron ? (
          <p className="minor-text" style={{ padding: "12px 0" }}>
            ANALYSIS_CRON setting not found. Create it in Settings first.
          </p>
        ) : (
          <div className="stack-layout" style={{ gap: 20, maxWidth: 600 }}>
            {/* Row: Directions / Order Types */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <label className="stack-layout" style={{ gap: 8 }}>
                <span
                  className="panel-label"
                  style={{ fontSize: 10, marginBottom: 0 }}
                >
                  DIRECTIONS
                </span>
                <div style={{ display: "flex", gap: 12 }}>
                  {["BUY", "SELL"].map((direction) => (
                    <label
                      key={direction}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={analysisForm.directions.includes(direction)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...analysisForm.directions, direction]
                            : analysisForm.directions.filter(
                                (x) => x !== direction,
                              );
                          setAnalysisForm((p) => ({
                            ...p,
                            directions: next,
                          }));
                        }}
                      />
                      <span style={{ fontSize: 13 }}>{direction}</span>
                    </label>
                  ))}
                </div>
              </label>

              <label className="stack-layout" style={{ gap: 8 }}>
                <span
                  className="panel-label"
                  style={{ fontSize: 10, marginBottom: 0 }}
                >
                  ORDER TYPES
                </span>
                <div style={{ display: "flex", gap: 12 }}>
                  {["market", "limit", "stop"].map((orderType) => (
                    <label
                      key={orderType}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={analysisForm.order_types.includes(orderType)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...analysisForm.order_types, orderType]
                            : analysisForm.order_types.filter(
                                (x) => x !== orderType,
                              );
                          setAnalysisForm((p) => ({
                            ...p,
                            order_types: next,
                          }));
                        }}
                      />
                      <span style={{ fontSize: 13 }}>{orderType}</span>
                    </label>
                  ))}
                </div>
              </label>
            </div>

            {/* Cadence Minutes */}
            <div className="stack-layout" style={{ gap: 8 }}>
              <span
                className="panel-label"
                style={{ fontSize: 10, marginBottom: 0 }}
              >
                CADENCE (MINUTES)
              </span>
              <input
                type="number"
                value={analysisForm.cadence_minutes}
                onChange={(e) =>
                  setAnalysisForm((p) => ({
                    ...p,
                    cadence_minutes: Number(e.target.value),
                  }))
                }
              />
            </div>

            {/* Model */}
            <div className="stack-layout" style={{ gap: 8 }}>
              <span
                className="panel-label"
                style={{ fontSize: 10, marginBottom: 0 }}
              >
                MODEL
              </span>
              <select
                value={analysisForm.model}
                onChange={(e) =>
                  setAnalysisForm((p) => ({ ...p, model: e.target.value }))
                }
              >
                {API_KEY_NAME_OPTIONS.map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value
                      .replace("_API_KEY", "")
                      .toLowerCase()}
                  >
                    {opt.label.replace(" API Key", "")}
                  </option>
                ))}
              </select>
            </div>

            {/* Profile */}
            <div className="stack-layout" style={{ gap: 8 }}>
              <span
                className="panel-label"
                style={{ fontSize: 10, marginBottom: 0 }}
              >
                PROFILE
              </span>
              <input
                value={analysisForm.profile}
                onChange={(e) =>
                  setAnalysisForm((p) => ({ ...p, profile: e.target.value }))
                }
                placeholder="Optional AI/profile name"
              />
            </div>

            {/* Entry Models */}
            <div className="stack-layout" style={{ gap: 8 }}>
              <span
                className="panel-label"
                style={{ fontSize: 10, marginBottom: 0 }}
              >
                ENTRY MODELS (COMMA OR NEWLINE)
              </span>
              <textarea
                rows={3}
                value={analysisForm.entry_models}
                onChange={(e) =>
                  setAnalysisForm((p) => ({
                    ...p,
                    entry_models: e.target.value,
                  }))
                }
                placeholder="Order Block, FVG, ICT..."
              />
            </div>

            {/* Prompt */}
            <div className="stack-layout" style={{ gap: 8 }}>
              <span
                className="panel-label"
                style={{ fontSize: 10, marginBottom: 0 }}
              >
                PROMPT
              </span>
              <textarea
                rows={6}
                value={analysisForm.prompt}
                onChange={(e) =>
                  setAnalysisForm((p) => ({ ...p, prompt: e.target.value }))
                }
                placeholder="Instructions for AI setup detection..."
              />
            </div>

            {/* Save button */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                paddingTop: 20,
                borderTop: "1px solid var(--border)",
              }}
            >
              <button
                className="primary-button"
                style={{ padding: "12px 32px", fontSize: 14 }}
                onClick={saveAnalysisCron}
                disabled={analysisSaveLoading}
              >
                {analysisSaveLoading ? "SAVING..." : "SAVE ANALYSIS CRON"}
              </button>
            </div>

            {analysisSaveMsg && (
              <div
                className="minor-text"
                style={{
                  color: analysisSaveMsg.toLowerCase().includes("fail")
                    ? "var(--danger)"
                    : "var(--success)",
                }}
              >
                {analysisSaveMsg}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
