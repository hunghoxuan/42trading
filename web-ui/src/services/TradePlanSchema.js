// TradePlanSchema — unified JSON field resolver across schema versions
//
// Usage:
//   import { resolveField, resolvePlan, resolvePlans } from "./TradePlanSchema";
//   const entry = resolveField(planObj, "entry");         // any schema → value
//   const plan  = resolvePlan(planObj, rootCtx);          // normalized plan
//   const plans = resolvePlans(rootObj);                  // array of normalized plans
//
// To add a new schema version: add a new alternate in the || / ?? chain.

// ── Field resolvers (single field, any schema version) ──

/**
 * @param {object} p  — a trade_plan item (or root object as fallback)
 * @param {string} field
 * @param {object} [ctx] — root context (DB row or analysis root)
 * @returns {*}
 */
export function resolveField(p, field, ctx) {
  if (!ctx) ctx = {};
  switch (field) {
    // ── Prices ──
    case "entry":
      return (
        p?.entry_price ??
        p?.entry ??
        ctx?.entry ??
        ctx?.entry_price ??
        ctx?.price ??
        null
      );
    case "tp":
      return (
        p?.take_profit ??
        p?.multiple_exits?.full_tp?.price ??
        p?.tp3 ??
        p?.tp1 ??
        p?.tp ??
        ctx?.tp ??
        ctx?.take_profit ??
        (Array.isArray(p?.tps) && p.tps[p.tps.length - 1]?.price) ??
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
      return p?.stop_loss ?? p?.sl ?? ctx?.sl ?? ctx?.stop_loss ?? null;
    case "be_trigger":
      return (
        p?.breakeven_trigger ??
        p?.multiple_exits?.break_even?.price ??
        p?.be_trigger ??
        p?.be ??
        ctx?.be_trigger ??
        ctx?.be ??
        null
      );

    // ── Direction / Side ──
    case "direction":
      return (
        p?.direction ||
        p?.dir ||
        ctx?.direction ||
        ctx?.action ||
        ctx?.side ||
        ""
      );
    case "action":
      return p?.action || p?.side || ctx?.action || ctx?.side || "";

    // ── Identifiers ──
    case "symbol":
      return p?.symbol || ctx?.symbol || "";
    case "profile":
      return p?.profile || ctx?.profile || "";

    // ── Strategy / Model (supports both snake_case and camelCase) ──
    case "strategy":
      return p?.strategy || ctx?.strategy || "";
    case "entry_model":
      return (
        p?.entry_model ||
        p?.entryModel ||
        p?.model ||
        ctx?.entry_model ||
        ctx?.entryModel ||
        ctx?.model ||
        ""
      );
    case "source":
      return p?.source || ctx?.source || ctx?.model || "";

    // ── Order ──
    case "order_type":
      return (
        p?.order_type || p?.type || ctx?.order_type || ctx?.type || "limit"
      );
    case "trade_type":
      return (
        p?.type || p?.order_type || ctx?.type || ctx?.order_type || "limit"
      );
    case "session":
      return (
        p?.session ||
        p?.session_entry ||
        ctx?.session ||
        ctx?.session_prefix ||
        ""
      );

    // ── Ratios ──
    case "rr":
      return p?.risk_reward ?? p?.rr ?? ctx?.rr ?? ctx?.risk_reward ?? null;
    case "risk_pct":
      return (
        p?.risk_percent ??
        p?.risk_pct ??
        p?.riskPct ??
        ctx?.risk_pct ??
        ctx?.risk_pct_planned ??
        ctx?.riskPct ??
        null
      );
    case "risk_money":
      return (
        p?.risk_money_planned ??
        p?.risk_money ??
        p?.riskMoney ??
        ctx?.risk_money_planned ??
        null
      );

    // ── Confidence ──
    case "confidence_pct":
      return (
        p?.confidence_pct ??
        p?.confidence ??
        p?.confluence_score ??
        ctx?.confidence_pct ??
        ctx?.confidence ??
        (p?.confidence_level
          ? _confidenceLevelToPct(p.confidence_level)
          : null) ??
        (ctx?.confidence_level
          ? _confidenceLevelToPct(ctx.confidence_level)
          : null)
      );
    case "confidence_level":
      return p?.confidence_level || ctx?.confidence_level || "";
    case "risk_level":
      return (
        p?.risk_level || p?.risk_tier || ctx?.risk_level || ctx?.risk_tier || ""
      );

    // ── Time / Bars ──
    case "estimated_bars":
      return (
        p?.estimated_candles_to_tp1 ??
        p?.estimated_bars ??
        p?.estimate_bars_that_entry_happens ??
        ctx?.estimated_bars ??
        null
      );
    case "timeframe":
      return p?.timeframe || p?.tf || ctx?.timeframe || ctx?.tf || "";

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
        ctx?.entry_condition ||
        ""
      );
    case "exit_condition":
      return (
        p?.mid_trade_invalidation ||
        p?.position_management?.mid_trade_invalidation ||
        p?.exit_condition ||
        ctx?.exit_condition ||
        ""
      );
    case "risk_management":
      return p?.risk_management || ctx?.risk_management || "";
    case "skip_recommendation":
      return (
        p?.risk_management?.skip_decision ||
        p?.skip_recommendation ||
        p?.position_management?.trade_decision ||
        p?.trade_decision ||
        ctx?.skip_recommendation ||
        ""
      );
    case "trade_decision":
      return (
        p?.risk_management?.skip_decision ||
        p?.trade_decision ||
        p?.position_management?.trade_decision ||
        ctx?.trade_decision ||
        ""
      );

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
          : Array.isArray(ctx?.partial_tps)
            ? ctx.partial_tps
            : [];
    case "confluence_checklist":
      return Array.isArray(p?.confluence_checklist)
        ? p.confluence_checklist
        : Array.isArray(ctx?.confluence_checklist)
          ? ctx.confluence_checklist
          : [];
    case "reasons_to_skip":
      return Array.isArray(p?.risk_management?.skip_reasons)
        ? p.risk_management.skip_reasons
        : typeof p?.risk_management?.skip_reasons === "string" &&
            p.risk_management.skip_reasons.trim()
          ? [{ reason: p.risk_management.skip_reasons.trim(), severity: "" }]
          : Array.isArray(p?.reasons_to_skip)
            ? p.reasons_to_skip
            : Array.isArray(p?.skipReasons)
              ? p.skipReasons
              : Array.isArray(ctx?.reasons_to_skip)
                ? ctx.reasons_to_skip
                : [];

    // ── Nested objects ──
    case "multiple_exits":
      return p?.multiple_exits || {};
    case "position_management":
      return p?.position_management || {};
    case "ai_full_analysis":
      return p?.ai_full_analysis || {};

    // ── Grade ──
    case "grade":
      return p?.grade || ctx?.grade || "";

    default:
      return p?.[field] ?? ctx?.[field] ?? null;
  }
}

// ── Plan extractor — pulls trade_plan array from any root format ──

/**
 * Accepts either:
 *   1. A root object with trade_plan array   →  { trade_plan: [...] }
 *   2. A root object that IS a single plan   →  { entry_price, direction, ... }
 *   3. A DB row with nested trade_plan       →  { entry, sl, tp, trade_plan: [...] }
 *
 * @param {object} root — root object (analysis response, DB row, or single plan)
 * @returns {Array} array of raw trade_plan items
 */
export function extractPlans(root) {
  if (!root || typeof root !== "object") return [];
  if (Array.isArray(root.analysis_data) && root.analysis_data.length) {
    return root.analysis_data.flatMap((item) =>
      Array.isArray(item?.trade_plan)
        ? item.trade_plan.map((p) => ({
            ...(p || {}),
            symbol: p?.symbol || item?.symbol || "",
          }))
        : [],
    );
  }

  // Case 1: root has trade_plan array
  if (Array.isArray(root.trade_plan)) return root.trade_plan;

  // Case 2: root has trade_plan as single object
  if (
    root.trade_plan &&
    typeof root.trade_plan === "object" &&
    !Array.isArray(root.trade_plan)
  )
    return [root.trade_plan];

  // Case 3: root IS a single plan (has direction + entry-like fields, no trade_plan)
  if (
    (root.direction || root.dir) &&
    (root.entry_price != null ||
      root.entry != null ||
      root.stop_loss != null ||
      root.sl != null)
  )
    return [root];

  return [];
}

// ── Bulk: resolve all plans from a root object ──

/**
 * @param {object} root — any root format (analysis response, DB row, single plan)
 * @returns {Array} array of normalized plans
 */
export function resolvePlans(root) {
  var rawPlans = extractPlans(root);
  return rawPlans.map(function (p) {
    // For DB rows, the root itself is the ctx (has flat fields like entry, sl, tp)
    return resolvePlan(p, root);
  });
}

// ── Single plan resolver ──

/**
 * @param {object} p   — a raw trade_plan item (any schema version)
 * @param {object} [ctx] — root context (DB row or analysis root for fallbacks)
 * @returns {object} normalized plan
 */
export function resolvePlan(p, ctx) {
  if (!ctx) ctx = {};
  return {
    symbol: resolveField(p, "symbol", ctx),
    direction: resolveField(p, "direction", ctx),
    action: resolveField(p, "action", ctx),
    profile: resolveField(p, "profile", ctx),
    order_type: resolveField(p, "order_type", ctx),
    session: resolveField(p, "session", ctx),
    strategy: resolveField(p, "strategy", ctx),
    entry_model: resolveField(p, "entry_model", ctx),
    source: resolveField(p, "source", ctx),

    entry: resolveField(p, "entry", ctx),
    tp: resolveField(p, "tp", ctx),
    tp2: resolveField(p, "tp2", ctx),
    tp3: resolveField(p, "tp3", ctx),
    sl: resolveField(p, "sl", ctx),
    rr: resolveField(p, "rr", ctx),
    be_trigger: resolveField(p, "be_trigger", ctx),

    risk_pct: resolveField(p, "risk_pct", ctx),
    risk_money: resolveField(p, "risk_money", ctx),
    risk_level: resolveField(p, "risk_level", ctx),

    confidence_pct: resolveField(p, "confidence_pct", ctx),
    confidence_level: resolveField(p, "confidence_level", ctx),

    estimated_bars: resolveField(p, "estimated_bars", ctx),
    timeframe: resolveField(p, "timeframe", ctx),

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
    ai_full_analysis: resolveField(p, "ai_full_analysis", ctx),

    grade: resolveField(p, "grade", ctx),
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
