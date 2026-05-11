import React from "react";
import { showDateTime } from "./format";

export function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatDetailDateTime(v) {
  return showDateTime(v);
}

export function shouldShowPnl(statusRaw, pnlRaw) {
  const status = String(statusRaw || "").toUpperCase();
  const pnl = asNum(pnlRaw);
  if (pnl == null) return false;

  // Terminal statuses always show PnL if present
  const isTerminal = [
    "CLOSED",
    "CANCELLED",
    "TP",
    "SL",
    "FAIL",
    "EXPIRED",
  ].includes(status);
  if (isTerminal) return true;

  // Active trades (START) should show PnL if non-zero
  if (status === "START" || status === "OPEN" || status === "FILLED") {
    return Math.abs(pnl) > 0.000001;
  }

  // Otherwise (NEW, LOCKED, PLACED), don't show PnL even if backend returns it (might be stale)
  return false;
}

export function formatNote(note) {
  if (!note) return "";
  return String(note).split(". ").filter(Boolean).join(".<br/>");
}

export function buildRrVolRiskText({
  rrRaw,
  volumeRaw,
  riskSizeRaw,
  riskPctRaw,
  rewardSizeRaw,
  plannedVolRaw,
  volumeSizeRaw,
}) {
  const rr = asNum(rrRaw);
  const vol = asNum(volumeRaw);
  const plannedVol = asNum(plannedVolRaw);
  const risk = asNum(riskSizeRaw);
  const riskPct = asNum(riskPctRaw);
  const rewardRaw = asNum(rewardSizeRaw);
  const loss = risk != null ? Math.abs(risk) : null;
  const reward =
    rewardRaw != null
      ? Math.abs(rewardRaw)
      : loss != null && rr != null
        ? loss * rr
        : null;

  const volVal =
    asNum(riskPctRaw) ??
    (volumeSizeRaw != null ? volumeSizeRaw / 100 : null) ??
    plannedVol;
  const riskText =
    volVal != null ? `risk ${Number((volVal * 100).toFixed(2))}%` : "risk -";

  const lotsText = vol != null ? `${Number(vol.toFixed(3))} lots` : "- lots";
  const rrText = rr != null ? `${rr.toFixed(2)} rr` : "- rr";

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <span>{rrText}</span>
      <span>{riskText}</span>
      <span>|</span>
      <span>{lotsText}</span>
      {(reward != null || loss != null) && (
        <span style={{ display: "flex", gap: "8px" }}>
          <span className="money-pos">
            +{reward != null ? `$${reward.toFixed(2)}` : "$-"}
          </span>
          <span className="money-neg">
            -{loss != null ? `$${loss.toFixed(2)}` : "$-"}
          </span>
        </span>
      )}
    </div>
  );
}

export function buildHeaderMeta({
  statusRaw,
  pnlRaw,
  rrRaw,
  volumeRaw,
  plannedVolRaw,
  riskSizeRaw,
  riskPctRaw,
  rewardSizeRaw,
  updatedAtRaw,
  statusUi,
  volumeSizeRaw,
}) {
  const pnl = asNum(pnlRaw);
  const showPnl = shouldShowPnl(statusRaw, pnl);
  const status =
    typeof statusUi === "function"
      ? statusUi(statusRaw)
      : { cls: "OTHER", label: String(statusRaw || "PENDING").toUpperCase() };
  return {
    showPnl,
    pnlText: `$${pnl != null ? pnl.toFixed(2) : "0.00"}`,
    pnlClassName: pnl != null && pnl < 0 ? "money-neg" : "money-pos",
    dateText: formatDetailDateTime(updatedAtRaw),
    statsText: buildRrVolRiskText({
      rrRaw,
      volumeRaw,
      plannedVolRaw,
      riskSizeRaw,
      riskPctRaw,
      rewardSizeRaw,
      volumeSizeRaw,
    }),
    statusNode: <span className={`badge ${status.cls}`}>{status.label}</span>,
  };
}

export function historyPayload(item) {
  const payload = item?.payload_json || item?.metadata || item?.payload || {};
  return payload && typeof payload === "object" ? payload : {};
}

export function historyType(item, payload) {
  return String(
    item?.event_type ||
      item?.type ||
      payload?.event ||
      payload?.event_type ||
      "EVENT",
  );
}

export function historyWhen(item, formatDateTime) {
  const dt = item?.event_time || item?.created_at;
  return typeof formatDateTime === "function"
    ? formatDateTime(dt)
    : formatDetailDateTime(dt);
}

export function formatNum3(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toFixed(3)));
}

export function applyLinkedPlanChange(prevPlan, key, rawVal) {
  const next = { ...(prevPlan || {}), [key]: rawVal };
  const entry = asNum(next.entry);
  const sl = asNum(next.sl);
  const tp = asNum(next.tp);
  const rr = asNum(next.rr);
  const side = String(next.direction || "").toUpperCase();
  const isBuy = side === "BUY";
  const risk = entry != null && sl != null ? Math.abs(entry - sl) : null;

  if (risk != null && risk > 0) {
    if (key === "rr" && rr != null && entry != null && sl != null) {
      const tpCalc = isBuy ? entry + risk * rr : entry - risk * rr;
      next.tp = formatNum3(tpCalc);
    } else if (entry != null && tp != null) {
      next.rr = formatNum3(Math.abs(tp - entry) / risk);
    }
  }

  if (["entry", "tp", "sl", "rr"].includes(key)) {
    const val = asNum(next[key]);
    if (val != null) next[key] = formatNum3(val);
  }
  return next;
}

function firstTradePlan(raw = {}) {
  const candidates = [
    raw,
    raw?.analysis_result,
    raw?.analysis,
    raw?.parsed_json,
    raw?.raw_json,
    raw?.metadata,
    raw?.metadata?.raw_json,
    raw?.metadata?.analysis_result,
    raw?.payload,
    raw?.payload?.analysis_result,
  ];
  for (const src of candidates) {
    if (!src || typeof src !== "object") continue;
    if (Array.isArray(src?.trade_plan) && src.trade_plan.length)
      return src.trade_plan[0] || {};
    if (Array.isArray(src?.tradePlan) && src.tradePlan.length)
      return src.tradePlan[0] || {};
    if (src?.trade_plan && typeof src.trade_plan === "object")
      return src.trade_plan;
  }
  return {};
}

function planPrimaryTp(plan = {}) {
  const partials = Array.isArray(plan?.partial_tps) ? plan.partial_tps : [];
  const partialPrices = partials.map((x) =>
    x && typeof x === "object" ? x.price : x,
  );
  const legacyLevels = Array.isArray(plan?.tp_levels) ? plan.tp_levels : [];
  const compactTps = Array.isArray(plan?.tps)
    ? plan.tps.map((x) => (x && typeof x === "object" ? x.price : x))
    : [];
  const candidates = [
    plan?.tp,
    ...partialPrices,
    ...compactTps,
    ...legacyLevels,
    plan?.tp1,
    plan?.target,
    plan?.take_profit,
  ];
  for (const value of candidates) {
    const n = asNum(value);
    if (n != null) return n;
  }
  return null;
}

export function calcRrFromSignal(s) {
  const entry = asNum(
    s?.entry || s?.target_price || s?.entry_price || s?.entry_price_raw,
  );
  const sl = asNum(s?.sl || s?.sl_price || s?.sl_price_raw);
  // Use highest TP from partials if available, else signal.tp
  const raw = s?.raw_json && typeof s.raw_json === "object" ? s.raw_json : {};
  const plan = raw?.trade_plan || raw?.tradePlan || {};
  const partials = Array.isArray(plan?.partial_tps)
    ? plan.partial_tps
    : Array.isArray(s?.partial_tps)
      ? s.partial_tps
      : [];
  let tp = asNum(s?.tp || s?.tp_price || s?.tp_price_raw);
  // Override with highest partial TP if higher
  if (partials.length > 0) {
    let highestPartial = tp;
    for (const p of partials) {
      const pPrice = p && typeof p === "object" ? asNum(p.price) : null;
      if (
        pPrice != null &&
        (highestPartial == null || pPrice > highestPartial)
      ) {
        highestPartial = pPrice;
      }
    }
    if (highestPartial != null) tp = highestPartial;
  }
  if (entry == null || sl == null || tp == null) return null;
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (!risk) return null;
  return Number((reward / risk).toFixed(2));
}

export function extractTradePlanFromSignal(signal = {}) {
  const raw = (() => {
    const rj = signal?.raw_json;
    if (!rj) return {};
    if (typeof rj === "object") return rj;
    if (typeof rj === "string") {
      try { return JSON.parse(rj); } catch (_) { return {}; }
    }
    return {};
  })();
  const tradePlan = firstTradePlan(raw);
  const sideRaw = String(
    signal?.action || signal?.side || tradePlan?.direction || "",
  ).toUpperCase();
  const entry =
    asNum(signal?.entry || signal?.target_price || signal?.entry_price) ??
    asNum(raw?.entry ?? raw?.price);
  const tp = asNum(signal?.tp || signal?.tp_price) ?? planPrimaryTp(tradePlan);
  const sl = asNum(signal?.sl || signal?.sl_price) ?? asNum(tradePlan?.sl);
  const rr =
    asNum(signal?.rr_planned) ??
    asNum(tradePlan?.rr) ??
    calcRrFromSignal(signal);

  return {
    direction: sideRaw.includes("SELL") ? "SELL" : "BUY",
    trade_type: String(
      tradePlan?.type || raw?.order_type || "limit",
    ).toLowerCase(),
    risk_pct: asNum(
      signal.risk_pct_planned ??
        raw.risk_pct ??
        raw.riskPct ??
        tradePlan.risk_pct ??
        tradePlan.riskPct ??
        signal.volume ??
        raw.volume ??
        0.01,
    ),
    risk_money: asNum(
      signal.risk_money_planned ??
        raw.risk_money ??
        raw.riskMoney ??
        tradePlan.risk_money ??
        tradePlan.riskMoney,
    ),
    entry: formatNum3(entry ?? NaN),
    tp: formatNum3(tp ?? NaN),
    sl: formatNum3(sl ?? NaN),
    rr: formatNum3(rr ?? NaN),
    note: String(tradePlan?.note || signal?.note || "").trim(),
    entry_model: String(
      signal.entry_model || raw.entry_model || tradePlan.entry_model || "",
    ),
    strategy: String(
      signal.strategy || raw.strategy || tradePlan.strategy || "",
    ),
    confidence_pct: asNum(
      signal.confidence_pct ??
        signal.confidence ??
        raw.confidence_pct ??
        raw.confidence ??
        tradePlan.confidence_pct ??
        tradePlan.confidence,
    ),
    invalidation: String(
      signal.invalidation || raw.invalidation || tradePlan.invalidation || "",
    ),
    estimated_bars: asNum(
      signal.estimated_bars ?? raw.estimated_bars ?? tradePlan.estimated_bars,
    ),
    be_trigger: asNum(
      signal.be_trigger ??
        raw.be_trigger ??
        tradePlan.be_trigger ??
        raw.be_trigger_raw,
    ),
    profile: String(signal.profile || raw.profile || tradePlan.profile || ""),
    exit_condition: String(
      signal.exit_condition ||
        raw.exit_condition ||
        tradePlan.exit_condition ||
        "",
    ),
    entry_condition: String(
      signal.entry_condition ||
        raw.entry_condition ||
        tradePlan.entry_condition ||
        "",
    ),
    confluence_checklist: Array.isArray(
      signal.confluence_checklist ||
        raw.confluence_checklist ||
        tradePlan.confluence_checklist,
    )
      ? signal.confluence_checklist ||
        raw.confluence_checklist ||
        tradePlan.confluence_checklist
      : [],
    skip_recommendation: String(
      signal.skip_recommendation ||
        raw.skip_recommendation ||
        tradePlan.skip_recommendation ||
        "",
    ),
    risk_management: String(
      signal.risk_management ||
        tradePlan.risk_management ||
        raw.risk_management ||
        "",
    ),
    partial_tps: Array.isArray(tradePlan.partial_tps)
      ? tradePlan.partial_tps
      : Array.isArray(raw.partial_tps)
        ? raw.partial_tps
        : [],
    reasons_to_skip: Array.isArray(tradePlan.reasons_to_skip)
      ? tradePlan.reasons_to_skip
      : Array.isArray(raw.reasons_to_skip)
        ? raw.reasons_to_skip
        : [],
  };
}

export function extractTradePlanFromTrade(trade = {}) {
  const meta =
    trade?.metadata && typeof trade.metadata === "object" ? trade.metadata : {};
  const raw = (() => {
    const rj = trade?.raw_json;
    if (!rj) return {};
    if (typeof rj === "object") return rj;
    if (typeof rj === "string") {
      try { return JSON.parse(rj); } catch (_) { return {}; }
    }
    return {};
  })();
  const plan = firstTradePlan({
    ...raw,
    metadata: meta,
    raw_json: raw,
    analysis_result:
      raw?.analysis_result ||
      meta?.analysis_result ||
      meta?.raw_json?.analysis_result ||
      null,
  });
  const sideRaw = String(
    trade.action || trade.side || meta.direction || plan?.direction || "",
  ).toUpperCase();
  const entry = asNum(trade.entry);
  const tp = asNum(trade.tp);
  const sl = asNum(trade.sl);
  const rr = asNum(trade.rr_planned) ?? calcRrFromSignal(trade);

  return {
    direction: sideRaw.includes("SELL") ? "SELL" : "BUY",
    trade_type: String(
      meta.trade_type || meta.order_type || raw.order_type || "limit",
    ).toLowerCase(),
    risk_pct: asNum(
      trade.risk_pct_planned ??
        meta.risk_pct ??
        meta.riskPct ??
        raw.riskPct ??
        raw.risk_pct ??
        trade.volume ??
        meta.volumePct ??
        0.01,
    ),
    risk_money: asNum(
      trade.risk_money_planned ??
        meta.risk_money ??
        meta.riskMoney ??
        raw.riskMoney ??
        raw.risk_money,
    ),
    entry: formatNum3(entry ?? NaN),
    tp: formatNum3(tp ?? NaN),
    sl: formatNum3(sl ?? NaN),
    rr: formatNum3(rr ?? NaN),
    note: String(trade.note || "").trim(),
    entry_model: String(
      trade.entry_model || meta.entry_model || raw.entry_model || plan.entry_model || "",
    ),
    strategy: String(trade.strategy || meta.strategy || raw.strategy || plan.strategy || ""),
    confidence_pct: asNum(
      trade.confidence_pct ??
        trade.confidence ??
        meta.confidence_pct ??
        meta.confidence ??
        raw.confidence_pct ??
        raw.confidence ??
        plan.confidence_pct ??
        plan.confidence,
    ),
    invalidation: String(
      trade.invalidation || meta.invalidation || raw.invalidation || plan.invalidation || "",
    ),
    estimated_bars: asNum(
      trade.estimated_bars ?? meta.estimated_bars ?? raw.estimated_bars ?? plan.estimated_bars,
    ),
    be_trigger: asNum(trade.be_trigger ?? meta.be_trigger ?? raw.be_trigger ?? plan.be_trigger ?? plan.be),
    profile: String(trade.profile || meta.profile || raw.profile || plan.profile || ""),
    exit_condition: String(
      trade.exit_condition || meta.exit_condition || raw.exit_condition || plan.exit_condition || "",
    ),
    entry_condition: String(
      trade.entry_condition ||
        meta.entry_condition ||
        raw.entry_condition ||
        plan.entry_condition ||
        "",
    ),
    confluence_checklist: Array.isArray(
      trade.confluence_checklist ||
        meta.confluence_checklist ||
        raw.confluence_checklist ||
        plan.confluence_checklist,
    )
      ? trade.confluence_checklist ||
        meta.confluence_checklist ||
        raw.confluence_checklist ||
        plan.confluence_checklist
      : [],
    skip_recommendation: String(
      trade.skip_recommendation ||
        meta.skip_recommendation ||
        raw.skip_recommendation ||
        plan.skip_recommendation ||
        "",
    ),
    risk_management: String(meta.risk_management || raw.risk_management || plan.risk_management || ""),
    partial_tps: Array.isArray(meta.partial_tps)
      ? meta.partial_tps
      : Array.isArray(raw.partial_tps)
        ? raw.partial_tps
        : Array.isArray(plan.partial_tps)
          ? plan.partial_tps
        : [],
    reasons_to_skip: Array.isArray(meta.reasons_to_skip)
      ? meta.reasons_to_skip
      : Array.isArray(raw.reasons_to_skip)
        ? raw.reasons_to_skip
        : Array.isArray(plan.reasons_to_skip)
          ? plan.reasons_to_skip
        : [],
    session: String(
      trade.session_prefix ||
        meta.session_prefix ||
        raw.session_prefix ||
        plan.session ||
        "",
    ),
    multiple_exits: plan.multiple_exits || raw.multiple_exits || {},
    risk_level: String(
      plan.risk_level || raw.risk_level || meta.risk_level || "",
    ),
    confidence_level: String(
      plan.confidence_level || raw.confidence_level || meta.confidence_level || "",
    ),
    trade_decision: String(
      plan.trade_decision ||
        plan.position_management?.trade_decision ||
        raw.trade_decision ||
        "",
    ),
    ai_full_analysis: plan.ai_full_analysis || raw.ai_full_analysis || {},
    order_type: String(
      plan.order_type || raw.order_type || meta.order_type || "limit",
    ),
  };
}

export function validateTradePlan(plan = {}, opts = {}) {
  const entry = asNum(plan.entry);
  const tp = asNum(plan.tp);
  const sl = asNum(plan.sl);
  const rr = asNum(plan.rr);
  const direction = String(plan.direction || "")
    .trim()
    .toUpperCase();
  if (!["BUY", "SELL"].includes(direction))
    return "Direction must be Buy or Sell.";
  if (entry == null || tp == null || sl == null)
    return "Entry/TP/SL must be numeric values.";
  if (!opts.skipRrCheck && rr != null && (rr < 0.1 || rr > 20))
    return "RR must be between 0.1 and 20.";
  if (direction === "BUY") {
    if (!(tp > entry)) return "For BUY, TP must be greater than Entry.";
    if (!(sl < entry)) return "For BUY, SL must be lower than Entry.";
  } else if (direction === "SELL") {
    if (!(tp < entry)) return "For SELL, TP must be lower than Entry.";
    if (!(sl > entry)) return "For SELL, SL must be greater than Entry.";
  }
  return "";
}

export function renderHistoryItem(item, idx, opts = {}) {
  const payload = historyPayload(item);
  const type = historyType(item, payload);
  const when = historyWhen(item, opts.formatDateTime);
  const ticket = opts.includeTicket
    ? String(
        payload?.ticket ||
          payload?.broker_trade_id ||
          payload?.brokerTradeId ||
          payload?.order_ticket ||
          "",
      ).trim()
    : "";
  const statusBadge =
    typeof opts.statusFromType === "function"
      ? opts.statusFromType(type)
      : null;

  return (
    <div
      key={`${item?.id || item?.event_id || item?.log_id || idx}`}
      style={{
        margin: "0 0 10px 0",
        paddingBottom: 10,
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="panel-label" style={{ margin: 0 }}>
            {type}
          </span>
          {statusBadge ? (
            <span className={`badge ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
          ) : null}
        </div>
        <span className="minor-text">{when}</span>
      </div>
      {ticket ? (
        <div className="minor-text" style={{ marginBottom: 8 }}>
          Ticket: <strong>{ticket}</strong>
        </div>
      ) : null}
      <div className="json-table-wrapper">
        <pre
          className="minor-text"
          style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {JSON.stringify(payload || {}, null, 2)}
        </pre>
      </div>
    </div>
  );
}
