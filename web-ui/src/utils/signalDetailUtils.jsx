import React from "react";
import { showDateTime } from "./format";

export function asNum(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeOrderTypeValue(raw, fallback = "limit") {
  const fb = String(fallback || "limit")
    .trim()
    .toLowerCase();
  const text = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (!text) return ["limit", "market", "stop"].includes(fb) ? fb : "limit";
  if (text === "limit" || text === "market" || text === "stop") return text;
  if (text.endsWith(" limit") || text.startsWith("limit ")) return "limit";
  if (text.endsWith(" market") || text.startsWith("market ")) return "market";
  if (text.endsWith(" stop") || text.startsWith("stop ")) return "stop";
  if (text.includes("limit")) return "limit";
  if (text.includes("market")) return "market";
  if (text.includes("stop")) return "stop";
  return ["limit", "market", "stop"].includes(fb) ? fb : "limit";
}

function pickFirstFinite(...vals) {
  for (const v of vals) {
    const n = asNum(v);
    if (n != null) return n;
  }
  return null;
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
  const rrText = rr != null ? `${rr.toFixed(1)} rr` : "- rr";

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
  // Keep full precision — no rounding. Trim trailing zeros, max 8 decimals.
  return parseFloat(n.toFixed(8)).toString();
}

function formatNumPrec(v, refVal) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  const ref = refVal != null && refVal !== "" ? String(refVal) : String(v);
  const dot = ref.indexOf(".");
  const decimals = dot >= 0 ? Math.min(5, ref.length - dot - 1) : 0;
  return String(Number(n.toFixed(decimals)));
}

export function normalizeTpSlFromEntryDirection(plan = {}) {
  // Just pass through - no auto-correction. Let user edit freely.
  return { tp: plan.tp, sl: plan.sl };
}

export function applyLinkedPlanChange(prevPlan, key, rawVal) {
  const next = { ...(prevPlan || {}), [key]: rawVal };
  // Format numeric fields consistently
  if (["entry", "tp", "tp1", "tp2", "tp3", "sl", "rr"].includes(key)) {
    const val = asNum(next[key]);
    if (val != null) {
      const precRef2 = prevPlan.entry || prevPlan.tp || prevPlan.sl || "";
      next[key] =
        key === "rr" ? String(Number(val.toFixed(1))) : formatNumPrec(val, precRef2);
    }
  }

  const entry = asNum(next.entry);
  const sl = asNum(next.sl);
  const tp = asNum(next.tp);
  const dir = String(next.direction || "BUY").toUpperCase();
  const isBuy = dir === "BUY";

  // Determine precision from entry value (used for all linked fields)
  const precRef = next.entry || prevPlan.entry || "";

  const tp1Num = asNum(next.tp1);
  const tpNum = asNum(next.tp);
  // Use tp1 as primary target; fall back to tp
  const effectiveTp = tp1Num ?? tpNum;

  // Auto-update RR when Entry, SL, or TP1/TP changes
  if (["entry", "sl", "tp", "tp1"].includes(key)) {
    if (entry != null && sl != null && effectiveTp != null && entry !== sl) {
      const rr = Math.abs(effectiveTp - entry) / Math.abs(entry - sl);
      if (Number.isFinite(rr)) next.rr = String(Number(rr.toFixed(1)));
    }
  }

  // Auto-update TP1 when RR changes (TP1 is primary target)
  if (key === "rr") {
    const rr = asNum(next.rr);
    if (entry != null && sl != null && rr != null && entry !== sl) {
      const newTp = isBuy
        ? entry + rr * Math.abs(entry - sl)
        : entry - rr * Math.abs(entry - sl);
      if (Number.isFinite(newTp)) {
        next.tp1 = formatNumPrec(newTp, precRef);
        next.tp = next.tp1;
      }
    }
  }

  // Sync tp1 → tp (TP1 is primary; tp is kept in sync for backward compat)
  if (key !== "rr") {
    const nextTp1 = asNum(next.tp1);
    const nextTp = asNum(next.tp);
    if (nextTp1 != null) {
      next.tp = formatNumPrec(nextTp1, precRef);
    } else if (nextTp != null) {
      next.tp1 = formatNumPrec(nextTp, precRef);
    }
  }
  return next;
}

function firstTradePlan(raw = {}) {
  let rawResponseParsed = null;
  try {
    const rawText = String(raw?.raw_response || "").trim();
    if (rawText) {
      let cur = rawText;
      for (let i = 0; i < 3; i += 1) {
        if (cur && typeof cur === "object") {
          rawResponseParsed = cur;
          break;
        }
        if (typeof cur !== "string") break;
        cur = JSON.parse(cur);
      }
      if (!rawResponseParsed && cur && typeof cur === "object")
        rawResponseParsed = cur;
    }
  } catch {
    rawResponseParsed = null;
  }
  const candidates = [
    raw?.__raw_plan,
    raw,
    rawResponseParsed,
    rawResponseParsed?.__raw_plan,
    raw?.analysis_result,
    raw?.analysis,
    raw?.raw_json,
    raw?.metadata,
    raw?.metadata?.raw_json,
    raw?.metadata?.analysis_result,
    raw?.payload,
    raw?.payload?.analysis_result,
  ];
  for (const src of candidates) {
    if (!src || typeof src !== "object") continue;
    const indexedEntries = Object.keys(src)
      .filter((k) => /^\d+$/.test(String(k)))
      .map((k) => src[k])
      .filter((x) => x && typeof x === "object" && !Array.isArray(x));
    if (indexedEntries.length) return indexedEntries[0] || {};
    if (src?.__raw_plan && typeof src.__raw_plan === "object")
      return src.__raw_plan;
    // New AI format: bare array of trade plans [{...}]
    if (
      Array.isArray(src) &&
      src.length > 0 &&
      !src.trade_plan &&
      !src.analysis_data
    ) {
      const first = src[0];
      if (
        first &&
        typeof first === "object" &&
        (first.direction || first.entry_price || first.entry)
      )
        return first;
    }
    if (
      src?.execution_plan &&
      typeof src.execution_plan === "object" &&
      (src.direction || src.symbol || src.risk_management || src.analysis)
    ) {
      return src;
    }
    // Root-level trade_plan key (new path)
    if (Array.isArray(src?.trade_plan) && src.trade_plan.length)
      return src.trade_plan[0] || {};
    // Legacy analysis_data[].trade_plan path
    if (Array.isArray(src?.analysis_data) && src.analysis_data.length) {
      for (const entry of src.analysis_data) {
        if (Array.isArray(entry?.trade_plan) && entry.trade_plan.length) {
          const first = entry.trade_plan[0] || {};
          if (!first?.symbol && entry?.symbol) first.symbol = entry.symbol;
          return first;
        }
      }
    }
    if (Array.isArray(src?.tradePlan) && src.tradePlan.length)
      return src.tradePlan[0] || {};
    if (src?.trade_plan && typeof src.trade_plan === "object")
      return src.trade_plan;
    const hasPlanShape =
      (src?.direction || src?.dir) &&
      (src?.entry_price != null ||
        src?.entry != null ||
        src?.stop_loss != null ||
        src?.sl != null);
    if (hasPlanShape) return src;
  }
  return {};
}

function planPrimaryTp(plan = {}) {
  const ep = plan?.execution_plan;
  const candidates = [ep?.tp1?.price, plan?.tp1, plan?.tp, plan?.take_profit];
  // Legacy partials/compact
  const partials = Array.isArray(plan?.partial_tps) ? plan.partial_tps : [];
  for (const p of partials) {
    const v = p && typeof p === "object" ? p.price : p;
    if (v != null) candidates.push(v);
  }
  for (const value of candidates) {
    const n = asNum(value);
    if (n != null) return n;
  }
  return null;
}

function planTpLevel(plan = {}, idx = 1) {
  const ep = plan?.execution_plan;
  const mx = plan?.multiple_exits || {};
  const tpObj = idx === 1 ? ep?.tp1 : idx === 2 ? ep?.tp2 : ep?.tp3;
  const newPrice = tpObj?.price;
  if (idx === 1) {
    return asNum(
      newPrice ??
        plan?.tp1 ??
        mx?.tp1?.price ??
        plan?.tp ??
        plan?.take_profit ??
        null,
    );
  }
  if (idx === 2) return asNum(newPrice ?? plan?.tp2 ?? mx?.tp2?.price ?? null);
  return asNum(newPrice ?? plan?.tp3 ?? mx?.tp3?.price ?? null);
}

function checklistToArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .filter(([, v]) => Boolean(v))
    .map(([k]) => k);
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
      try {
        return JSON.parse(rj);
      } catch (_) {
        return {};
      }
    }
    return {};
  })();
  const tradePlan = firstTradePlan(raw);
  const rawPlan =
    raw?.__raw_plan && typeof raw.__raw_plan === "object" ? raw.__raw_plan : {};
  const effectivePlan = Object.keys(tradePlan || {}).length
    ? tradePlan
    : rawPlan;
  const sideRaw = String(
    effectivePlan?.direction ||
      effectivePlan?.dir ||
      signal?.action ||
      signal?.side ||
      raw?.direction ||
      "",
  ).toUpperCase();
  const entry =
    asNum(effectivePlan?.execution_plan?.entry?.price) ??
    asNum(effectivePlan?.entry ?? effectivePlan?.entry_price) ??
    asNum(signal?.entry || signal?.target_price || signal?.entry_price) ??
    asNum(raw?.entry ?? raw?.price);
  const tp =
    planPrimaryTp(effectivePlan) ?? asNum(signal?.tp || signal?.tp_price);
  const tp1 = planTpLevel(effectivePlan, 1) ?? asNum(signal?.tp1 ?? tp);
  const tp2 = planTpLevel(effectivePlan, 2) ?? asNum(signal?.tp2);
  const tp3 = planTpLevel(effectivePlan, 3) ?? asNum(signal?.tp3);
  const sl =
    asNum(effectivePlan?.execution_plan?.stop_loss?.price) ??
    asNum(effectivePlan?.sl ?? effectivePlan?.stop_loss) ??
    asNum(signal?.sl || signal?.sl_price);
  const rr =
    asNum(effectivePlan?.execution_plan?.risk_reward) ??
    asNum(effectivePlan?.rr ?? effectivePlan?.risk_reward) ??
    asNum(signal?.rr_planned) ??
    calcRrFromSignal(signal);

  return {
    direction: sideRaw.includes("SELL") ? "SELL" : "BUY",
    trade_type: String(
      effectivePlan?.type ||
        effectivePlan?.order_type ||
        raw?.order_type ||
        "limit",
    ).toLowerCase(),
    risk_pct: asNum(
      signal.risk_pct_planned ??
        effectivePlan?.risk_management?.risk_percent ??
        effectivePlan?.risk_percent ??
        effectivePlan?.risk_pct ??
        raw.risk_pct ??
        raw.riskPct ??
        effectivePlan.riskPct ??
        signal.volume ??
        raw.volume ??
        0.01,
    ),
    risk_money_planned: asNum(
      signal.risk_money_planned ??
        effectivePlan?.risk_money_planned ??
        raw.risk_money_planned ??
        raw.riskMoneyPlanned ??
        raw.risk_money ??
        raw.riskMoney ??
        effectivePlan?.risk_money ??
        effectivePlan.riskMoney,
    ),
    risk_money: asNum(
      signal.risk_money_planned ??
        effectivePlan?.risk_money_planned ??
        raw.risk_money_planned ??
        raw.riskMoneyPlanned ??
        raw.risk_money ??
        raw.riskMoney ??
        effectivePlan?.risk_money ??
        effectivePlan.riskMoney,
    ),
    entry: formatNum3(entry ?? NaN),
    tp: formatNum3(tp ?? NaN),
    tp1: formatNum3(tp1 ?? NaN),
    tp2: formatNum3(tp2 ?? NaN),
    tp3: formatNum3(tp3 ?? NaN),
    sl: formatNum3(sl ?? NaN),
    rr: formatNum3(rr ?? NaN),
    note: String(
      effectivePlan?.execution_plan?.tp3?.note ||
        effectivePlan?.note ||
        signal?.note ||
        "",
    ).trim(),
    entry_model: String(
      signal.entry_model || raw.entry_model || effectivePlan.entry_model || "",
    ),
    strategy: String(
      signal.strategy || raw.strategy || effectivePlan.strategy || "",
    ),
    confidence_pct: asNum(
      signal.confidence_pct ??
        signal.confidence ??
        raw.confidence_pct ??
        raw.confidence ??
        effectivePlan?.risk_management?.confidence_pct ??
        effectivePlan.confidence_pct ??
        effectivePlan.confidence,
    ),
    invalidation: String(
      signal.invalidation ||
        raw.invalidation ||
        effectivePlan?.execution_plan?.entry?.invalidation_note ||
        effectivePlan?.analysis?.sl_validity?.sl_behind_structure
          ?.invalidation_logic ||
        effectivePlan.invalidation ||
        effectivePlan.risk_management?.pre_entry_invalidation ||
        "",
    ),
    estimated_bars: asNum(
      signal.estimated_bars ??
        raw.estimated_bars ??
        effectivePlan?.risk_management?.estimated_entry_mins ??
        effectivePlan.estimated_bars ??
        effectivePlan?.risk_management?.estimate_mins_that_entry_happens,
    ),
    be_trigger: asNum(
      signal.be_trigger ??
        raw.be_trigger ??
        effectivePlan?.execution_plan?.breakeven_trigger?.price ??
        effectivePlan?.execution_plan?.breakeven_trigger?.condition ??
        effectivePlan.be_trigger ??
        effectivePlan.breakeven_trigger ??
        raw.be_trigger_raw,
    ),
    profile: String(
      signal.profile || raw.profile || effectivePlan.profile || "",
    ),
    exit_condition: String(
      signal.exit_condition ||
        raw.exit_condition ||
        effectivePlan?.analysis?.sl_validity?.sl_behind_structure
          ?.invalidation_logic ||
        effectivePlan.exit_condition ||
        effectivePlan.mid_trade_invalidation ||
        "",
    ),
    entry_condition: String(
      signal.entry_condition ||
        raw.entry_condition ||
        effectivePlan?.execution_plan?.entry?.reference ||
        effectivePlan.entry_condition ||
        effectivePlan.entry_trigger ||
        "",
    ),
    confluence_checklist: (() => {
      const fromSignal = checklistToArray(signal.confluence_checklist);
      if (fromSignal.length) return fromSignal;
      const fromRaw = checklistToArray(raw.confluence_checklist);
      if (fromRaw.length) return fromRaw;
      const fromPlan = checklistToArray(effectivePlan.confluence_checklist);
      if (fromPlan.length) return fromPlan;
      return checklistToArray(effectivePlan.entry_checklists);
    })(),
    skip_recommendation: String(
      signal.skip_recommendation ||
        raw.skip_recommendation ||
        effectivePlan?.risk_management?.suggested_action ||
        effectivePlan.skip_recommendation ||
        effectivePlan?.risk_management?.skip_decision ||
        "",
    ),
    risk_management: String(
      signal.risk_management ||
        effectivePlan?.risk_management?.grade ||
        effectivePlan.risk_management ||
        raw.risk_management ||
        "",
    ),
    partial_tps: Array.isArray(effectivePlan.partial_tps)
      ? effectivePlan.partial_tps
      : Array.isArray(raw.partial_tps)
        ? raw.partial_tps
        : [],
    reasons_to_skip: Array.isArray(effectivePlan.reasons_to_skip)
      ? effectivePlan.reasons_to_skip
      : Array.isArray(raw.reasons_to_skip)
        ? raw.reasons_to_skip
        : typeof effectivePlan?.risk_management?.skip_reasons === "string" &&
            effectivePlan.risk_management.skip_reasons.trim()
          ? [effectivePlan.risk_management.skip_reasons.trim()]
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
      try {
        return JSON.parse(rj);
      } catch (_) {
        return {};
      }
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
  const resolveSource = () => {
    const rawSource = String(
      trade.source || trade.source_id || meta.source || raw.source || "",
    )
      .trim()
      .toLowerCase();
    if (!rawSource) return "manual";
    if (rawSource.startsWith("ai_") || rawSource === "ai") return rawSource;
    if (
      rawSource.includes("claude") ||
      rawSource.includes("gpt") ||
      rawSource.includes("gemini") ||
      rawSource.includes("deepseek")
    ) {
      return rawSource.startsWith("ai_") ? rawSource : `ai_${rawSource}`;
    }
    return "manual";
  };
  const source = resolveSource();
  const sourceId = String(trade.source_id || meta.source_id || raw.source_id || "")
    .trim();
  const rawEntryModel = String(
    raw.entry_model || plan.entry_model || meta.entry_model || trade.entry_model || "",
  ).trim();
  const looksLikeBrokerAccount = /^[A-Z0-9_]{8,}$/.test(rawEntryModel);
  const entryModel =
    source === "manual" && looksLikeBrokerAccount ? "" : rawEntryModel;
  // Prefer planned values first (raw/plan), then mutable trade fields, then broker telemetry fallback.
  // This avoids plan editor drift when broker sync updates runtime SL/TP fields.
  const entry = pickFirstFinite(
    plan?.execution_plan?.entry?.price,
    raw?.entry,
    raw?.entry_price,
    plan?.entry,
    plan?.entry_price,
    trade.entry,
    trade.target_price,
    trade.entry_price,
    meta?.broker_data?.entry,
  );
  const tp = pickFirstFinite(
    raw?.tp,
    raw?.take_profit,
    plan?.tp,
    plan?.take_profit,
    planPrimaryTp(plan),
    trade.tp,
    meta?.broker_data?.tp,
  );
  const tp1 = pickFirstFinite(
    raw?.tp1,
    planTpLevel(plan, 1),
    trade.tp1,
    meta?.tp1,
    meta?.tp_targets?.[0],
    tp,
  );
  const tp2 = pickFirstFinite(
    raw?.tp2,
    planTpLevel(plan, 2),
    trade.tp2,
    meta?.tp2,
    meta?.tp_targets?.[1],
  );
  const tp3 = pickFirstFinite(
    raw?.tp3,
    planTpLevel(plan, 3),
    trade.tp3,
    meta?.tp3,
    meta?.tp_targets?.[2],
  );
  const sl = pickFirstFinite(
    plan?.execution_plan?.stop_loss?.price,
    raw?.sl,
    raw?.stop_loss,
    plan?.sl,
    plan?.stop_loss,
    trade.sl,
    meta?.broker_data?.sl,
  );
  const rr =
    asNum(plan?.execution_plan?.risk_reward) ??
    asNum(trade.rr_planned) ??
    calcRrFromSignal(trade);
  const normalized = normalizeTpSlFromEntryDirection({
    direction: sideRaw.includes("SELL") ? "SELL" : "BUY",
    entry,
    tp: tp1 ?? tp,
    sl,
  });
  const normalizedTpPrimary = asNum(normalized.tp);
  const normalizedSl = asNum(normalized.sl);

  return {
    direction: sideRaw.includes("SELL") ? "SELL" : "BUY",
    trade_type: normalizeOrderTypeValue(
      trade.order_type || meta.trade_type || meta.order_type || raw.order_type,
      "limit",
    ),
    risk_pct: asNum(
      trade.risk_pct_planned ??
        plan?.risk_management?.risk_percent ??
        meta.risk_pct ??
        meta.riskPct ??
        raw.riskPct ??
        raw.risk_pct ??
        trade.volume ??
        meta.volumePct ??
        0.01,
    ),
    risk_money_planned: asNum(
      trade.risk_money_planned ??
        meta.risk_money_planned ??
        meta.riskMoneyPlanned ??
        meta.risk_money ??
        meta.riskMoney ??
        raw.risk_money_planned ??
        raw.riskMoneyPlanned ??
        raw.riskMoney ??
        raw.risk_money,
    ),
    risk_money: asNum(
      trade.risk_money_planned ??
        meta.risk_money_planned ??
        meta.riskMoneyPlanned ??
        meta.risk_money ??
        meta.riskMoney ??
        raw.risk_money_planned ??
        raw.riskMoneyPlanned ??
        raw.riskMoney ??
        raw.risk_money,
    ),
    entry: formatNum3(entry ?? NaN),
    tp: formatNum3(normalizedTpPrimary ?? tp1 ?? tp ?? NaN),
    tp1: formatNum3(normalizedTpPrimary ?? tp1 ?? tp ?? NaN),
    tp2: formatNum3(tp2 ?? NaN),
    tp3: formatNum3(tp3 ?? NaN),
    sl: formatNum3(normalizedSl ?? sl ?? NaN),
    rr: formatNum3(rr ?? NaN),
    note: String(plan?.execution_plan?.tp3?.note || trade.note || "").trim(),
    entry_model: entryModel,
    source,
    source_id: sourceId,
    strategy: String(
      trade.strategy || meta.strategy || raw.strategy || plan.strategy || "",
    ),
    confidence_pct: asNum(
      trade.confidence_pct ??
        trade.confidence ??
        plan?.risk_management?.confidence_pct ??
        meta.confidence_pct ??
        meta.confidence ??
        raw.confidence_pct ??
        raw.confidence ??
        plan.confidence_pct ??
        plan.confidence,
    ),
    invalidation: String(
      trade.invalidation ||
        meta.invalidation ||
        raw.invalidation ||
        plan?.execution_plan?.entry?.invalidation_note ||
        plan?.analysis?.sl_validity?.sl_behind_structure?.invalidation_logic ||
        plan.invalidation ||
        plan.risk_management?.pre_entry_invalidation ||
        "",
    ),
    estimated_bars: asNum(
      trade.estimated_bars ??
        meta.estimated_bars ??
        raw.estimated_bars ??
        plan?.risk_management?.estimated_entry_mins ??
        plan.estimated_bars,
    ),
    be_trigger: asNum(
      trade.be_trigger ??
        meta.be_trigger ??
        raw.be_trigger ??
        plan?.execution_plan?.breakeven_trigger?.price ??
        plan?.execution_plan?.breakeven_trigger?.condition ??
        plan.be_trigger ??
        plan.be,
    ),
    profile: String(
      trade.profile || meta.profile || raw.profile || plan.profile || "",
    ),
    exit_condition: String(
      trade.exit_condition ||
        meta.exit_condition ||
        raw.exit_condition ||
        plan?.analysis?.sl_validity?.sl_behind_structure?.invalidation_logic ||
        plan.exit_condition ||
        plan.risk_management?.mid_trade_invalidation ||
        "",
    ),
    entry_condition: String(
      trade.entry_condition ||
        meta.entry_condition ||
        raw.entry_condition ||
        plan?.execution_plan?.entry?.reference ||
        plan.entry_condition ||
        plan.risk_management?.entry_trigger ||
        plan.risk_management?.entry_trigger_full ||
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
        plan?.risk_management?.suggested_action ||
        plan.skip_recommendation ||
        "",
    ),
    risk_management: String(
      plan?.risk_management?.grade ||
        meta.risk_management ||
        raw.risk_management ||
        plan.risk_management ||
        "",
    ),
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
      plan.confidence_level ||
        raw.confidence_level ||
        meta.confidence_level ||
        "",
    ),
    trade_decision: String(
      plan.trade_decision ||
        plan.position_management?.trade_decision ||
        raw.trade_decision ||
        "",
    ),
    ai_full_analysis: plan.ai_full_analysis || raw.ai_full_analysis || {},
    order_type: normalizeOrderTypeValue(
      plan.order_type || raw.order_type || meta.order_type,
      "limit",
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
