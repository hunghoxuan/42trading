// TradePlanSchema — unified JSON field resolver across schema versions
//
// Usage:
//   import { resolveField, resolvePlan } from "./TradePlanSchema";
//   const entry = resolveField(planObj, "entry");       // any schema
//   const plan = resolvePlan(planObj);                   // normalized plan
//
// To add a new schema version: add a new alternate in the || chain.

// ── Field resolvers (single field, any schema version) ──

/**
 * @param {object} p — a trade_plan item (or root analysis object)
 * @param {string} field — field name (entry, tp, sl, etc.)
 * @param {object} [ctx] — optional context (root parsed object for fallbacks)
 * @returns {*} resolved value
 */
export function resolveField(p, field, ctx = {}) {
  switch (field) {
    // ── Prices ──
    case "entry":
      return p?.entry_price ?? p?.entry ?? ctx?.price ?? null;
    case "tp":
      return (
        p?.take_profit ??
        p?.multiple_exits?.full_tp?.price ??
        p?.tp3 ??
        p?.tp1 ??
        p?.tp ??
        (Array.isArray(p?.tps) && p.tps[p.tps.length - 1]?.price) ??
        null
      );
    case "tp1":
      return (
        p?.tp1 ??
        (Array.isArray(p?.tps) && p.tps[0]?.price) ??
        p?.take_profit ??
        null
      );
    case "tp2":
      return (
        p?.multiple_exits?.tp2?.price ??
        p?.tp2 ??
        (Array.isArray(p?.tps) && p.tps[1]?.price) ??
        null
      );
    case "tp3":
      return (
        p?.multiple_exits?.full_tp?.price ??
        p?.tp3 ??
        (Array.isArray(p?.tps) && p.tps[2]?.price) ??
        null
      );
    case "sl":
      return p?.stop_loss ?? p?.sl ?? ctx?.sl ?? null;
    case "be_trigger":
      return (
        p?.breakeven_trigger ??
        p?.multiple_exits?.break_even?.price ??
        p?.be_trigger ??
        p?.be ??
        null
      );

    // ── Direction / Side ──
    case "direction":
      return p?.direction || p?.dir || ctx?.direction || "";
    case "action":
      return p?.action || p?.side || ctx?.action || "";

    // ── Identifiers ──
    case "symbol":
      return p?.symbol || ctx?.symbol || "";
    case "profile":
      return p?.profile || ctx?.profile || "";

    // ── Strategy / Model ──
    case "strategy":
      return p?.strategy || ctx?.strategy || "";
    case "entry_model":
      return p?.entry_model || p?.model || ctx?.entry_model || "";
    case "source":
      return p?.source || ctx?.source || ctx?.model || "";

    // ── Order ──
    case "order_type":
      return p?.order_type || p?.type || ctx?.type || "limit";
    case "trade_type":
      return p?.type || p?.order_type || ctx?.type || "limit";
    case "session":
      return p?.session || p?.session_entry || "";

    // ── Ratios ──
    case "rr":
      return p?.risk_reward ?? p?.rr ?? ctx?.rr ?? null;
    case "risk_pct":
      return p?.risk_percent ?? p?.risk_pct ?? p?.riskPct ?? ctx?.risk_pct ?? null;
    case "risk_money":
      return p?.risk_money_planned ?? p?.risk_money ?? p?.riskMoney ?? null;

    // ── Confidence ──
    case "confidence_pct":
      return (
        p?.confidence_pct ??
        p?.confluence_score ??
        p?.confidence ??
        (p?.confidence_level ? _confidenceLevelToPct(p.confidence_level) : null)
      );
    case "confidence_level":
      return p?.confidence_level || "";
    case "risk_level":
      return p?.risk_level || p?.risk_tier || "";

    // ── Time / Bars ──
    case "estimated_bars":
      return (
        p?.estimated_candles_to_tp1 ??
        p?.estimated_bars ??
        p?.estimate_bars_that_entry_happens ??
        null
      );
    case "timeframe":
      return p?.timeframe || p?.tf || ctx?.timeframe || "";

    // ── Text fields ──
    case "note":
      return p?.note || ctx?.note || ctx?.invalidation || "";
    case "invalidation":
      return (
        p?.pre_entry_invalidation ||
        p?.position_management?.pre_entry_invalidation ||
        p?.invalidation ||
        ctx?.invalidation ||
        ""
      );
    case "entry_condition":
      return (
        p?.entry_trigger ||
        p?.position_management?.entry_trigger ||
        p?.entry_condition ||
        ""
      );
    case "exit_condition":
      return (
        p?.mid_trade_invalidation ||
        p?.position_management?.mid_trade_invalidation ||
        p?.exit_condition ||
        ""
      );
    case "risk_management":
      return p?.risk_management || p?.action?.risk_management || "";
    case "skip_recommendation":
      return (
        p?.skip_recommendation ||
        p?.position_management?.trade_decision ||
        p?.trade_decision ||
        ""
      );
    case "trade_decision":
      return p?.trade_decision || p?.position_management?.trade_decision || "";

    // ── Arrays ──
    case "partial_tps":
      return Array.isArray(p?.partial_tps)
        ? p.partial_tps
        : Array.isArray(p?.tps)
          ? p.tps.map(function (t) {
              return {
                price: t?.price ?? null,
                size_pct: t?.pct ?? t?.position_pct ?? null,
                rr: t?.rr ?? t?.risk_reward ?? null,
              };
            })
          : [];
    case "confluence_checklist":
      return Array.isArray(p?.confluence_checklist) ? p.confluence_checklist : [];
    case "reasons_to_skip":
      return Array.isArray(p?.reasons_to_skip)
        ? p.reasons_to_skip
        : Array.isArray(p?.skipReasons)
          ? p.skipReasons
          : [];

    // ── Multiple exits ──
    case "multiple_exits":
      return p?.multiple_exits || {};

    // ── Position management ──
    case "position_management":
      return p?.position_management || {};

    // ── Grade ──
    case "grade":
      return p?.grade || "";

    default:
      return p?.[field] ?? null;
  }
}

// ── Bulk plan resolver — normalizes a trade_plan item ──

/**
 * @param {object} p — a raw trade_plan item (any schema version)
 * @param {object} [ctx] — optional context (root parsed object)
 * @returns {object} normalized plan with all fields resolved
 */
export function resolvePlan(p, ctx = {}) {
  return {
    symbol: resolveField(p, "symbol", ctx),
    direction: resolveField(p, "direction", ctx),
    profile: resolveField(p, "profile", ctx),
    order_type: resolveField(p, "order_type", ctx),
    session: resolveField(p, "session", ctx),
    strategy: resolveField(p, "strategy", ctx),
    entry_model: resolveField(p, "entry_model", ctx),
    entry: resolveField(p, "entry", ctx),
    tp: resolveField(p, "tp", ctx),
    tp1: resolveField(p, "tp1", ctx),
    tp2: resolveField(p, "tp2", ctx),
    tp3: resolveField(p, "tp3", ctx),
    sl: resolveField(p, "sl", ctx),
    rr: resolveField(p, "rr", ctx),
    be_trigger: resolveField(p, "be_trigger", ctx),
    risk_pct: resolveField(p, "risk_pct", ctx),
    confidence_pct: resolveField(p, "confidence_pct", ctx),
    confidence_level: resolveField(p, "confidence_level", ctx),
    risk_level: resolveField(p, "risk_level", ctx),
    estimated_bars: resolveField(p, "estimated_bars", ctx),
    note: resolveField(p, "note", ctx),
    invalidation: resolveField(p, "invalidation", ctx),
    entry_condition: resolveField(p, "entry_condition", ctx),
    exit_condition: resolveField(p, "exit_condition", ctx),
    risk_management: resolveField(p, "risk_management", ctx),
    skip_recommendation: resolveField(p, "skip_recommendation", ctx),
    trade_decision: resolveField(p, "trade_decision", ctx),
    partial_tps: resolveField(p, "partial_tps", ctx),
    confluence_checklist: resolveField(p, "confluence_checklist", ctx),
    reasons_to_skip: resolveField(p, "reasons_to_skip", ctx),
    multiple_exits: resolveField(p, "multiple_exits", ctx),
    position_management: resolveField(p, "position_management", ctx),
    grade: resolveField(p, "grade", ctx),
    timeframe: resolveField(p, "timeframe", ctx),
    source: resolveField(p, "source", ctx),
  };
}

// ── Helpers ──

function _confidenceLevelToPct(level) {
  if (!level) return null;
  var s = String(level).toLowerCase();
  if (s === "high") return 85;
  if (s === "normal" || s === "medium") return 65;
  if (s === "low") return 45;
  return null;
}
