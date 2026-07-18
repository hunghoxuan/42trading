"use strict";

function normalizeEventId(value = "") {
  return String(value || "").trim();
}

function eventTime(event = {}) {
  const time = Number(event?.time ?? event?.bar_time_unix ?? event?.anchor_time);
  return Number.isFinite(time) ? time : null;
}

function eventBarIndex(event = {}) {
  const index = Number(event?.bar_index ?? event?.barIndex);
  return Number.isFinite(index) ? index : null;
}

function eventMatchesNode(event = {}, node = {}) {
  const id = normalizeEventId(node.event || node.rule_id || node.id);
  if (id && normalizeEventId(event.rule_id) !== id && normalizeEventId(event.event_id) !== id) return false;
  const bias = String(node.bias || "").trim().toLowerCase();
  if (bias && String(event.bias || "").trim().toLowerCase() !== bias) return false;
  const family = String(node.family || "").trim().toLowerCase();
  if (family && String(event.family || "").trim().toLowerCase() !== family) return false;
  return true;
}

function filterEventsForNode(events = [], node = {}) {
  const matched = (Array.isArray(events) ? events : []).filter((event) => eventMatchesNode(event, node));
  const withinBars = Number(node.within_bars ?? node.withinBars);
  if (!Number.isFinite(withinBars) || withinBars <= 0 || matched.length <= 1) return matched;
  const latestIndex = Math.max(...matched.map((event) => eventBarIndex(event)).filter(Number.isFinite));
  if (!Number.isFinite(latestIndex)) return matched;
  return matched.filter((event) => {
    const index = eventBarIndex(event);
    return Number.isFinite(index) ? latestIndex - index <= withinBars : true;
  });
}

function combineResult(kind = "and", children = []) {
  const normalized = Array.isArray(children) ? children : [];
  if (kind === "and" && normalized.some((child) => !child.matched)) return { matched: false, events: [] };
  if (kind === "or" && normalized.every((child) => !child.matched)) return { matched: false, events: [] };
  return { matched: true, events: normalized.flatMap((child) => child.events || []) };
}

function evaluateThen(children = []) {
  const normalized = Array.isArray(children) ? children : [];
  if (!normalized.length) return { matched: false, events: [] };
  const eventGroups = normalized.map((child) => (child.events || []).filter(Boolean));
  if (eventGroups.some((group) => !group.length)) return { matched: false, events: [] };
  const selected = [];
  let previousTime = Number.NEGATIVE_INFINITY;
  let previousIndex = Number.NEGATIVE_INFINITY;
  for (const group of eventGroups) {
    const candidate = group
      .slice()
      .sort((left, right) => (eventTime(left) ?? 0) - (eventTime(right) ?? 0))
      .find((event) => {
        const time = eventTime(event);
        const index = eventBarIndex(event);
        if (Number.isFinite(time) && time < previousTime) return false;
        if (Number.isFinite(index) && index < previousIndex) return false;
        return true;
      });
    if (!candidate) return { matched: false, events: [] };
    selected.push(candidate);
    previousTime = eventTime(candidate) ?? previousTime;
    previousIndex = eventBarIndex(candidate) ?? previousIndex;
  }
  return { matched: true, events: selected };
}

function evaluateEventLogic(node = {}, events = []) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return { matched: false, events: [] };
  if (node.event || node.rule_id || node.id) {
    const matchedEvents = filterEventsForNode(events, node);
    return { matched: matchedEvents.length > 0, events: matchedEvents };
  }
  if (Array.isArray(node.and)) return combineResult("and", node.and.map((child) => evaluateEventLogic(child, events)));
  if (Array.isArray(node.or)) return combineResult("or", node.or.map((child) => evaluateEventLogic(child, events)));
  if (Array.isArray(node.then)) return evaluateThen(node.then.map((child) => evaluateEventLogic(child, events)));
  if (node.not) {
    const result = evaluateEventLogic(node.not, events);
    return { matched: !result.matched, events: [] };
  }
  return { matched: false, events: [] };
}

function normalizeStrategyDefinition(strategy = {}, index = 0) {
  const id = String(strategy?.id || strategy?.key || `strategy_${index + 1}`).trim();
  return {
    id,
    name: String(strategy?.name || id).trim() || id,
    event_logic: strategy?.event_logic && typeof strategy.event_logic === "object"
      ? strategy.event_logic
      : strategy?.when && typeof strategy.when === "object"
        ? strategy.when
        : null,
    actions: Array.isArray(strategy?.actions) ? strategy.actions : [],
    metadata: strategy?.metadata && typeof strategy.metadata === "object" && !Array.isArray(strategy.metadata)
      ? { ...strategy.metadata }
      : {},
  };
}

function buildStrategySignal({ strategy = {}, result = {}, events = [] } = {}) {
  const latest = (Array.isArray(result.events) ? result.events : [])
    .slice()
    .sort((left, right) => (eventTime(right) ?? 0) - (eventTime(left) ?? 0))[0] || null;
  return {
    id: `${strategy.id}:${latest?.time ?? latest?.bar_index ?? Date.now()}`,
    strategy_id: strategy.id,
    strategy_name: strategy.name,
    time: latest ? eventTime(latest) : null,
    bar_index: latest ? eventBarIndex(latest) : null,
    symbol: String(latest?.symbol || "").trim().toUpperCase(),
    tf: String(latest?.tf || "").trim(),
    events: Array.isArray(result.events) ? result.events : events,
    actions: Array.isArray(strategy.actions) ? strategy.actions : [],
    metadata: { ...(strategy.metadata || {}) },
  };
}

function evaluateStrategies({ events = [], strategies = [] } = {}) {
  const normalizedStrategies = (Array.isArray(strategies) ? strategies : [])
    .map(normalizeStrategyDefinition)
    .filter((strategy) => strategy.event_logic);
  const signals = [];
  for (const strategy of normalizedStrategies) {
    const result = evaluateEventLogic(strategy.event_logic, events);
    if (!result.matched) continue;
    signals.push(buildStrategySignal({ strategy, result, events }));
  }
  return { signals };
}

class StrategyEngine {
  constructor({ strategies = [] } = {}) {
    this.strategies = (Array.isArray(strategies) ? strategies : []).map(normalizeStrategyDefinition);
  }

  evaluateEvents(options = {}) {
    return evaluateStrategies({ ...options, strategies: options.strategies || this.strategies });
  }
}

module.exports = {
  StrategyEngine,
  buildStrategySignal,
  evaluateEventLogic,
  evaluateStrategies,
  normalizeStrategyDefinition,
};
