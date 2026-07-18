"use strict";

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function hashString(input = "") {
  let hash = 2166136261;
  const text = String(input || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildItemId(parts = []) {
  return hashString(parts.map((part) => String(part ?? "")).join("|")).slice(0, 16);
}

function normalizeBars(bars = []) {
  if (!Array.isArray(bars)) return [];
  return bars
    .map((row) => {
      const time = Number(row?.time ?? row?.t);
      const open = Number(row?.open ?? row?.o);
      const high = Number(row?.high ?? row?.h);
      const low = Number(row?.low ?? row?.l);
      const close = Number(row?.close ?? row?.c);
      const volume = Number(row?.volume ?? row?.v ?? 0);
      if (
        !Number.isFinite(time) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        return null;
      }
      return {
        time,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

function createBarIndexLookup(bars = []) {
  const lookup = new Map();
  (Array.isArray(bars) ? bars : []).forEach((bar, index) => {
    const time = Number(bar?.time);
    if (Number.isFinite(time)) lookup.set(time, index);
  });
  return lookup;
}

function barIndexForTime(barIndexLookup = null, time = null) {
  if (!(barIndexLookup instanceof Map)) return null;
  const normalized = Number(time);
  if (!Number.isFinite(normalized) || !barIndexLookup.has(normalized)) return null;
  return barIndexLookup.get(normalized);
}

function resolveBarsWidth({
  barIndexLookup = null,
  barStart = null,
  barEnd = null,
  anchorTime = null,
  explicitBarsWidth = null,
  extensionBars = null,
} = {}) {
  const direct = Number(explicitBarsWidth);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.max(1, Math.round(direct));
  }
  const start = Number(barStart);
  const end = Number(barEnd);
  const lookup = barIndexLookup instanceof Map ? barIndexLookup : null;
  if (
    lookup &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    lookup.has(start) &&
    lookup.has(end)
  ) {
    return Math.max(1, Math.abs(lookup.get(end) - lookup.get(start)) + 1);
  }
  const extension = Number(extensionBars);
  if (Number.isFinite(extension) && extension > 0) {
    return Math.max(1, Math.round(extension));
  }
  if (Number.isFinite(start) && Number.isFinite(end) && start !== end) {
    return 2;
  }
  if (Number.isFinite(Number(anchorTime)) || Number.isFinite(start) || Number.isFinite(end)) {
    return 1;
  }
  return null;
}

function zoneTouchesBar(bar = {}, low = null, high = null) {
  const barLow = Number(bar?.low);
  const barHigh = Number(bar?.high);
  const zoneLow = Number(low);
  const zoneHigh = Number(high);
  if (
    !Number.isFinite(barLow) ||
    !Number.isFinite(barHigh) ||
    !Number.isFinite(zoneLow) ||
    !Number.isFinite(zoneHigh)
  ) {
    return false;
  }
  return barHigh >= zoneLow && barLow <= zoneHigh;
}

function zoneBreaksThrough(bar = {}, low = null, high = null, bias = "bullish") {
  const close = Number(bar?.close);
  const zoneLow = Number(low);
  const zoneHigh = Number(high);
  if (!Number.isFinite(close) || !Number.isFinite(zoneLow) || !Number.isFinite(zoneHigh)) {
    return false;
  }
  return bias === "bearish" ? close > zoneHigh : close < zoneLow;
}

function zoneRejectsTouch(bar = {}, low = null, high = null, bias = "bullish") {
  const close = Number(bar?.close);
  const zoneLow = Number(low);
  const zoneHigh = Number(high);
  if (!Number.isFinite(close) || !Number.isFinite(zoneLow) || !Number.isFinite(zoneHigh)) {
    return false;
  }
  return bias === "bearish" ? close <= zoneLow : close >= zoneHigh;
}

function zoneShowsContinuationAfterReject(bars = [], rejectIndex = null, bias = "bullish") {
  const normalizedBars = Array.isArray(bars) ? bars : [];
  if (!Number.isInteger(rejectIndex) || rejectIndex < 0 || rejectIndex >= normalizedBars.length - 1) {
    return false;
  }
  const rejectBar = normalizedBars[rejectIndex];
  const nextBar = normalizedBars[rejectIndex + 1];
  if (!rejectBar || !nextBar) return false;
  const rejectClose = Number(rejectBar?.close);
  const rejectHigh = Number(rejectBar?.high);
  const rejectLow = Number(rejectBar?.low);
  const nextClose = Number(nextBar?.close);
  const nextHigh = Number(nextBar?.high);
  const nextLow = Number(nextBar?.low);
  if (bias === "bearish") {
    return (
      (Number.isFinite(nextClose) && Number.isFinite(rejectClose) && nextClose < rejectClose) ||
      (Number.isFinite(nextLow) && Number.isFinite(rejectLow) && nextLow < rejectLow)
    );
  }
  return (
    (Number.isFinite(nextClose) && Number.isFinite(rejectClose) && nextClose > rejectClose) ||
    (Number.isFinite(nextHigh) && Number.isFinite(rejectHigh) && nextHigh > rejectHigh)
  );
}

function scanZoneLifecycle(bars = [], startIndex = 0, low = null, high = null, bias = "bullish") {
  const normalizedBars = Array.isArray(bars) ? bars : [];
  const lifecycle = {
    firstTouchIndex: null,
    lastTouchIndex: null,
    lastRejectIndex: null,
    firstBreakIndex: null,
    touchCount: 0,
    rejectCount: 0,
  };
  for (let index = Math.max(0, Number(startIndex) || 0); index < normalizedBars.length; index += 1) {
    const bar = normalizedBars[index];
    if (!zoneTouchesBar(bar, low, high)) continue;
    lifecycle.touchCount += 1;
    lifecycle.lastTouchIndex = index;
    if (!Number.isInteger(lifecycle.firstTouchIndex)) lifecycle.firstTouchIndex = index;
    if (zoneBreaksThrough(bar, low, high, bias)) {
      lifecycle.firstBreakIndex = index;
      break;
    }
    if (zoneRejectsTouch(bar, low, high, bias)) {
      lifecycle.lastRejectIndex = index;
      lifecycle.rejectCount += 1;
    }
  }
  return lifecycle;
}

function buildDynamicZoneLifecycleArtifacts({
  bars = [],
  barIndexLookup = null,
  baseItem = {},
  creationEndTime = null,
  convertType = "",
  convertLabel = "",
} = {}) {
  const normalizedBars = Array.isArray(bars) ? bars : [];
  const zoneLow = Number(baseItem?.price_low);
  const zoneHigh = Number(baseItem?.price_high);
  if (!normalizedBars.length || !Number.isFinite(zoneLow) || !Number.isFinite(zoneHigh)) {
    return baseItem ? [baseItem] : [];
  }
  const creationStartTime = Number(baseItem?.bar_start ?? baseItem?.anchor_time);
  const creationEnd = Number(creationEndTime ?? baseItem?.bar_end ?? baseItem?.anchor_time);
  const creationEndIndex = barIndexForTime(barIndexLookup, creationEnd);
  const startScanIndex =
    Number.isInteger(creationEndIndex) && creationEndIndex >= 0
      ? creationEndIndex + 1
      : 0;
  const baseBias = String(baseItem?.subtype || "").trim().toLowerCase() === "bearish"
    ? "bearish"
    : "bullish";
  const baseType = String(baseItem?.type || "").trim().toLowerCase();
  const convertedBias = baseBias === "bearish" ? "bullish" : "bearish";
  const lastBarTime = Number(normalizedBars[normalizedBars.length - 1]?.time) || creationEnd;
  const baseLifecycle = scanZoneLifecycle(
    normalizedBars,
    startScanIndex,
    zoneLow,
    zoneHigh,
    baseBias,
  );

  if (Number.isInteger(baseLifecycle.lastRejectIndex) && !Number.isInteger(baseLifecycle.firstBreakIndex)) {
    const touchBar = normalizedBars[baseLifecycle.lastRejectIndex];
    return [
      normalizeChartArtifactItem(
        {
          ...baseItem,
          status: "inactive",
          bar_end: Number(touchBar?.time) || creationEnd,
          payload: {
            ...(baseItem?.payload && typeof baseItem.payload === "object"
              ? baseItem.payload
              : {}),
            lifecycle_state: "rejected_touch",
            first_touch_time:
              Number.isInteger(baseLifecycle.firstTouchIndex) && normalizedBars[baseLifecycle.firstTouchIndex]
                ? Number(normalizedBars[baseLifecycle.firstTouchIndex]?.time) || null
                : null,
            last_touch_time:
              Number.isInteger(baseLifecycle.lastTouchIndex) && normalizedBars[baseLifecycle.lastTouchIndex]
                ? Number(normalizedBars[baseLifecycle.lastTouchIndex]?.time) || null
                : null,
            last_rejected_touch_time: Number(touchBar?.time) || null,
            rejected_touch_count: baseLifecycle.rejectCount,
            touch_count: baseLifecycle.touchCount,
          },
        },
        { barIndexLookup },
      ),
    ];
  }

  if (Number.isInteger(baseLifecycle.firstBreakIndex)) {
    const breakBar = normalizedBars[baseLifecycle.firstBreakIndex];
    const breakTime = Number(breakBar?.time) || creationEnd;
    const originalItem = normalizeChartArtifactItem(
      {
        ...baseItem,
        status: "inactive",
        bar_end: breakTime,
        payload: {
          ...(baseItem?.payload && typeof baseItem.payload === "object"
            ? baseItem.payload
            : {}),
          lifecycle_state: "broken_through",
          first_touch_time:
            Number.isInteger(baseLifecycle.firstTouchIndex) && normalizedBars[baseLifecycle.firstTouchIndex]
              ? Number(normalizedBars[baseLifecycle.firstTouchIndex]?.time) || null
              : null,
          last_touch_time:
            Number.isInteger(baseLifecycle.lastTouchIndex) && normalizedBars[baseLifecycle.lastTouchIndex]
              ? Number(normalizedBars[baseLifecycle.lastTouchIndex]?.time) || null
              : null,
          last_rejected_touch_time:
            Number.isInteger(baseLifecycle.lastRejectIndex) && normalizedBars[baseLifecycle.lastRejectIndex]
              ? Number(normalizedBars[baseLifecycle.lastRejectIndex]?.time) || null
              : null,
          broken_through_time: breakTime,
          converted_to: convertType,
          rejected_touch_count: baseLifecycle.rejectCount,
          touch_count: baseLifecycle.touchCount,
        },
      },
      { barIndexLookup },
    );

    const convertedLifecycle = scanZoneLifecycle(
      normalizedBars,
      baseLifecycle.firstBreakIndex + 1,
      zoneLow,
      zoneHigh,
      convertedBias,
    );
    const convertedRejectIndex = Number.isInteger(convertedLifecycle.lastRejectIndex)
      ? convertedLifecycle.lastRejectIndex
      : null;
    const requiresRetestContinuation = baseType === "ob";
    const conversionConfirmed = requiresRetestContinuation
      ? Number.isInteger(convertedRejectIndex) &&
        zoneShowsContinuationAfterReject(normalizedBars, convertedRejectIndex, convertedBias)
      : true;
    if (!conversionConfirmed) {
      return [originalItem];
    }

    const convertedEndTime =
      Number.isInteger(convertedRejectIndex) && normalizedBars[convertedRejectIndex]
        ? Number(normalizedBars[convertedRejectIndex]?.time) || lastBarTime
        : lastBarTime;
    const convertedStatus = Number.isInteger(convertedRejectIndex)
      ? "inactive"
      : Number.isInteger(convertedLifecycle.firstTouchIndex)
        ? "touched"
        : "active";
    const convertedRejectTime =
      Number.isInteger(convertedRejectIndex) && normalizedBars[convertedRejectIndex]
        ? Number(normalizedBars[convertedRejectIndex]?.time) || null
        : null;

    const convertedItem = normalizeChartArtifactItem(
      {
        ...baseItem,
        id: buildItemId([
          baseItem?.timeframe || "",
          convertType,
          breakTime,
          zoneLow,
          zoneHigh,
        ]),
        type: convertType,
        subtype: convertedBias,
        label: convertLabel,
        direction: convertedBias === "bearish" ? "SELL" : "BUY",
        status: convertedStatus,
        bar_start: breakTime,
        bar_end: convertedEndTime,
        anchor_time: breakTime,
        payload: {
          ...(baseItem?.payload && typeof baseItem.payload === "object"
            ? baseItem.payload
            : {}),
          lifecycle_state:
            convertedStatus === "inactive"
              ? "converted_rejected_touch"
              : convertedStatus === "touched"
                ? "converted_touched_no_resolution"
              : "converted_active",
          converted_from: String(baseItem?.type || "").trim().toLowerCase(),
          converted_at: breakTime,
          first_touch_time:
            Number.isInteger(convertedLifecycle.firstTouchIndex) &&
            normalizedBars[convertedLifecycle.firstTouchIndex]
              ? Number(normalizedBars[convertedLifecycle.firstTouchIndex]?.time) || null
              : null,
          last_touch_time:
            Number.isInteger(convertedLifecycle.lastTouchIndex) &&
            normalizedBars[convertedLifecycle.lastTouchIndex]
              ? Number(normalizedBars[convertedLifecycle.lastTouchIndex]?.time) || null
              : null,
          last_rejected_touch_time: convertedRejectTime,
          rejected_touch_count: convertedLifecycle.rejectCount,
          touch_count: convertedLifecycle.touchCount,
        },
      },
      { barIndexLookup },
    );
    return [originalItem, convertedItem];
  }

  const firstTouchTime =
    Number.isInteger(baseLifecycle.firstTouchIndex) && normalizedBars[baseLifecycle.firstTouchIndex]
      ? Number(normalizedBars[baseLifecycle.firstTouchIndex]?.time) || null
      : null;
  const lastTouchTime =
    Number.isInteger(baseLifecycle.lastTouchIndex) && normalizedBars[baseLifecycle.lastTouchIndex]
      ? Number(normalizedBars[baseLifecycle.lastTouchIndex]?.time) || null
      : null;
  return [
    normalizeChartArtifactItem(
      {
        ...baseItem,
        status: baseLifecycle.firstTouchIndex == null ? "active" : "touched",
        bar_end: baseLifecycle.firstTouchIndex == null ? lastBarTime : lastTouchTime,
        payload: {
          ...(baseItem?.payload && typeof baseItem.payload === "object"
            ? baseItem.payload
            : {}),
          lifecycle_state:
            baseLifecycle.firstTouchIndex == null ? "awaiting_touch" : "touched_no_resolution",
          first_touch_time: firstTouchTime,
          last_touch_time: lastTouchTime,
          touch_count: baseLifecycle.touchCount,
        },
      },
      { barIndexLookup },
    ),
  ];
}

function normalizeChartArtifactItem(item = {}, fallback = {}) {
  const family = String(item.family || fallback.family || "object").trim();
  const type = String(item.type || fallback.type || "generic").trim();
  const subtype = String(item.subtype || fallback.subtype || "").trim();
  const timeframe = String(item.timeframe || item.tf || fallback.timeframe || "").trim();
  const price = Number(item.price);
  const priceLow = Number(item.price_low ?? item.low ?? item.bottom ?? item.price_bottom);
  const priceHigh = Number(item.price_high ?? item.high ?? item.top ?? item.price_top);
  const anchorTime = Number(item.anchor_time ?? item.time ?? item.bar_start ?? item.barStart);
  const barStart = Number(item.bar_start ?? item.barStart ?? item.anchor_time ?? item.time);
  const barEnd = Number(item.bar_end ?? item.barEnd);
  const payload =
    item.payload && typeof item.payload === "object" ? clone(item.payload) : {};
  const normalizedFamily = String(family || "").trim().toLowerCase();
  const lifecycleState = String(payload.lifecycle_state || "").trim().toLowerCase();
  const eventFamilies = new Set(["pattern", "structure", "divergence"]);
  const zoneRejectEvent =
    normalizedFamily === "zone" &&
    (lifecycleState === "rejected_touch" ||
      lifecycleState === "converted_rejected_touch");
  const zoneBreakoutEvent =
    normalizedFamily === "zone" &&
    (lifecycleState === "converted_active" ||
      lifecycleState === "converted_touched_no_resolution" ||
      Number.isFinite(Number(payload.converted_at)));
  const isEvent = eventFamilies.has(normalizedFamily) || zoneRejectEvent || zoneBreakoutEvent;
  const eventTime =
    zoneRejectEvent
      ? Number(payload.last_rejected_touch_time ?? payload.last_touch_time ?? anchorTime)
      : zoneBreakoutEvent
        ? Number(payload.converted_at ?? anchorTime)
        : anchorTime;
  const eventKey =
    zoneRejectEvent
      ? "reject"
      : zoneBreakoutEvent
        ? "breakout"
        : String(type || "").trim().toLowerCase();
  const normalizedEventDirection = (() => {
    const raw = String(item.direction || fallback.direction || "").trim().toLowerCase();
    if (raw === "buy" || raw === "bullish") return "bullish";
    if (raw === "sell" || raw === "bearish") return "bearish";
    if (raw.includes("bull") || raw.includes("buy")) return "bullish";
    if (raw.includes("bear") || raw.includes("sell")) return "bearish";
    return "neutral";
  })();
  const barsWidth = resolveBarsWidth({
    barIndexLookup:
      fallback?.barIndexLookup instanceof Map ? fallback.barIndexLookup : null,
    barStart,
    barEnd,
    anchorTime,
    explicitBarsWidth:
      item.bars_width ??
      item.barsWidth ??
      item.metrics?.bars_width ??
      payload?.bars_width,
    extensionBars:
      payload?.extension_bars ??
      item.metrics?.extension_bars ??
      fallback?.extensionBars,
  });
  return {
    id:
      String(item.id || "").trim() ||
      buildItemId([family, type, timeframe, price, priceLow, priceHigh, anchorTime]),
    family,
    type,
    subtype,
    label: String(item.label || item.name || fallback.label || type || family).trim(),
    timeframe,
    source: String(item.source || fallback.source || "derived").trim(),
    origin: String(item.origin || fallback.origin || "").trim(),
    status: String(item.status || fallback.status || "active").trim(),
    direction:
      isEvent && normalizedEventDirection !== "neutral"
        ? normalizedEventDirection
        : String(item.direction || fallback.direction || "").trim(),
    price: Number.isFinite(price) ? price : null,
    price_low: Number.isFinite(priceLow) ? priceLow : null,
    price_high: Number.isFinite(priceHigh) ? priceHigh : null,
    bar_start: Number.isFinite(barStart) ? barStart : null,
    bar_end: Number.isFinite(barEnd) ? barEnd : null,
    bars_width: Number.isFinite(barsWidth) ? barsWidth : null,
    anchor_time: Number.isFinite(anchorTime) ? anchorTime : null,
    geometry:
      item.geometry && typeof item.geometry === "object" ? clone(item.geometry) : {},
    style: item.style && typeof item.style === "object" ? clone(item.style) : {},
    tags: Array.isArray(item.tags) ? [...item.tags] : [],
    metrics: item.metrics && typeof item.metrics === "object" ? clone(item.metrics) : {},
    payload,
    is_event: isEvent,
    event_scope: isEvent ? "bar" : "",
    event_key: isEvent ? eventKey : "",
    event_time: isEvent && Number.isFinite(eventTime) ? eventTime : null,
    event_direction: isEvent ? normalizedEventDirection : "",
  };
}

function inferPatternAt(bars = [], index = 0) {
  if (index <= 0 || index >= bars.length) return [];
  const bar = bars[index];
  const prev = bars[index - 1];
  if (!bar || !prev) return [];
  const body = Math.abs(bar.close - bar.open);
  const range = Math.max(0.0000001, bar.high - bar.low);
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  const prevBodyHigh = Math.max(prev.open, prev.close);
  const prevBodyLow = Math.min(prev.open, prev.close);
  const bodyHigh = Math.max(bar.open, bar.close);
  const bodyLow = Math.min(bar.open, bar.close);
  const out = [];

  if (
    prev.close < prev.open &&
    bar.close > bar.open &&
    bodyHigh >= prevBodyHigh &&
    bodyLow <= prevBodyLow
  ) {
    out.push("bullish_engulfing");
  }
  if (
    prev.close > prev.open &&
    bar.close < bar.open &&
    bodyHigh >= prevBodyHigh &&
    bodyLow <= prevBodyLow
  ) {
    out.push("bearish_engulfing");
  }
  if (body / range <= 0.35 && lowerWick / range >= 0.45 && upperWick / range <= 0.2) {
    out.push("bullish_pin_bar");
  }
  if (body / range <= 0.35 && upperWick / range >= 0.45 && lowerWick / range <= 0.2) {
    out.push("bearish_pin_bar");
  }
  if (bar.high <= prev.high && bar.low >= prev.low) {
    out.push("inside_bar");
  }
  if (bar.high >= prev.high && bar.low <= prev.low) {
    out.push("outside_bar");
  }
  return out;
}

function buildCandlePatternItems(bars = [], timeframe = "") {
  const barIndexLookup = createBarIndexLookup(bars);
  const out = [];
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const patterns = inferPatternAt(bars, index);
    for (const pattern of patterns) {
      const direction =
        pattern.startsWith("bullish")
          ? "BUY"
          : pattern.startsWith("bearish")
            ? "SELL"
            : "";
      out.push(
        normalizeChartArtifactItem({
          id: buildItemId(["pattern", timeframe, pattern, bar.time]),
          family: "pattern",
          type: pattern,
          subtype: "candlestick",
          label: pattern,
          timeframe,
          source: "derived",
          origin: "bars",
          direction,
          price: bar.close,
          anchor_time: bar.time,
          bar_start: bar.time,
          payload: { bar },
        }, { barIndexLookup }),
      );
    }
  }
  return out.slice(-120);
}

function buildZigZagPivotPoints(bars = [], pivot = 5) {
  if (!Array.isArray(bars) || bars.length < pivot * 2 + 1) return [];
  const candidates = [];
  for (let index = pivot; index < bars.length - pivot; index += 1) {
    const bar = bars[index];
    let isHigh = true;
    let isLow = true;
    for (let offset = 1; offset <= pivot; offset += 1) {
      const left = bars[index - offset];
      const right = bars[index + offset];
      if (!left || !right) continue;
      if (Number(bar?.high) <= Number(left?.high) || Number(bar?.high) <= Number(right?.high)) {
        isHigh = false;
      }
      if (Number(bar?.low) >= Number(left?.low) || Number(bar?.low) >= Number(right?.low)) {
        isLow = false;
      }
    }
    if (isHigh) {
      candidates.push({
        type: "swing_high",
        price: Number(bar.high),
        time: Number(bar.time),
        bar,
      });
    } else if (isLow) {
      candidates.push({
        type: "swing_low",
        price: Number(bar.low),
        time: Number(bar.time),
        bar,
      });
    }
  }
  const pivots = [];
  for (const candidate of candidates) {
    const prev = pivots[pivots.length - 1];
    if (!prev) {
      pivots.push(candidate);
      continue;
    }
    if (prev.type === candidate.type) {
      const replace =
        candidate.type === "swing_high"
          ? candidate.price >= prev.price
          : candidate.price <= prev.price;
      if (replace) pivots[pivots.length - 1] = candidate;
      continue;
    }
    pivots.push(candidate);
  }
  return pivots;
}

function classifyStructurePivots(pivots = [], tolerance = 0) {
  const nextTolerance = Math.max(0, Number(tolerance) || 0);
  let previousHigh = null;
  let previousLow = null;
  return (Array.isArray(pivots) ? pivots : []).map((pivotPoint) => {
    const next = { ...pivotPoint };
    if (next.type === "swing_high") {
      if (previousHigh) {
        if (Number(next.price) > Number(previousHigh.price) + nextTolerance) {
          next.structureTag = "hh";
        } else if (Number(next.price) < Number(previousHigh.price) - nextTolerance) {
          next.structureTag = "lh";
        } else {
          next.structureTag = "eqh";
        }
        next.previousSameTypeTime = Number(previousHigh.time);
        next.previousSameTypePrice = Number(previousHigh.price);
      } else {
        next.structureTag = "";
      }
      previousHigh = next;
      return next;
    }
    if (next.type === "swing_low") {
      if (previousLow) {
        if (Number(next.price) > Number(previousLow.price) + nextTolerance) {
          next.structureTag = "hl";
        } else if (Number(next.price) < Number(previousLow.price) - nextTolerance) {
          next.structureTag = "ll";
        } else {
          next.structureTag = "eql";
        }
        next.previousSameTypeTime = Number(previousLow.time);
        next.previousSameTypePrice = Number(previousLow.price);
      } else {
        next.structureTag = "";
      }
      previousLow = next;
      return next;
    }
    next.structureTag = "";
    return next;
  });
}

function inferPivotStructureBias(lastHigh = null, lastLow = null, fallback = "") {
  const highTag = String(lastHigh?.structureTag || "").trim().toLowerCase();
  const lowTag = String(lastLow?.structureTag || "").trim().toLowerCase();
  if (highTag === "hh" || lowTag === "hl") return "bullish";
  if (highTag === "lh" || lowTag === "ll") return "bearish";
  return String(fallback || "").trim().toLowerCase();
}

function candleRangeSize(bar = {}) {
  return Math.max(0, Number(bar?.high) - Number(bar?.low));
}

function buildSwingLevelItems(bars = [], timeframe = "", pivot = 5) {
  const barIndexLookup = createBarIndexLookup(bars);
  const effectivePivot = resolveAdaptiveStructurePivot(bars, pivot);
  const recentBarRanges = (Array.isArray(bars) ? bars : [])
    .slice(-40)
    .map((bar) => candleRangeSize(bar))
    .filter((value) => Number.isFinite(value) && value > 0);
  const tolerance = Math.max((medianNumber(recentBarRanges) || 1) * 0.03, 0.0000001);
  const normalizedBars = Array.isArray(bars) ? bars : [];
  const lastBarTime = Number(normalizedBars[normalizedBars.length - 1]?.time) || null;
  return classifyStructurePivots(
    buildZigZagPivotPoints(normalizedBars, effectivePivot),
    tolerance,
  )
    .map((pivotPoint) => {
      const bar = pivotPoint?.bar || {};
      const range = candleRangeSize(bar);
      const structureTag = String(pivotPoint?.structureTag || "").trim().toLowerCase();
      const structureLabel = structureTag ? structureTag.toUpperCase() : "";
      const pivotTime = Number(pivotPoint?.time);
      const pivotPrice = Number(pivotPoint?.price);
      const pivotIndex = barIndexForTime(barIndexLookup, pivotTime);
      let breakTime = null;
      if (Number.isInteger(pivotIndex)) {
        for (let index = pivotIndex + 1; index < normalizedBars.length; index += 1) {
          const nextBar = normalizedBars[index];
          if (!nextBar) continue;
          const close = Number(nextBar?.close);
          if (!Number.isFinite(close)) continue;
          const brokeLevel =
            pivotPoint?.type === "swing_high"
              ? close > pivotPrice + tolerance
              : close < pivotPrice - tolerance;
          if (!brokeLevel) continue;
          breakTime = Number(nextBar?.time) || null;
          break;
        }
      }
      return normalizeChartArtifactItem({
        id: buildItemId([
          "level",
          timeframe,
          pivotPoint.type,
          pivotPoint.time,
          pivotPoint.price,
        ]),
        family: "level",
        type: pivotPoint.type,
        subtype: "zigzag",
        label: pivotPoint.type === "swing_high" ? "SH" : "SL",
        timeframe,
        source: "derived",
        origin: "bars",
        status: Number.isFinite(breakTime) ? "inactive" : "active",
        price: pivotPrice,
        anchor_time: pivotTime,
        bar_start: pivotTime,
        bar_end: Number.isFinite(breakTime) ? breakTime : lastBarTime,
        payload: {
          bar_range: range,
          price_padding: Math.max(
            range * 0.18,
            Math.abs(pivotPrice) * 0.00015,
          ),
          extension_bars: 3,
          swing_algo: "zigzag",
          pivot_strength: effectivePivot,
          structure_tag: structureTag,
          structure_label: structureLabel,
          previous_same_type_time: Number(pivotPoint?.previousSameTypeTime) || null,
          previous_same_type_price: Number(pivotPoint?.previousSameTypePrice) || null,
          lifecycle_state: Number.isFinite(breakTime) ? "broken_structure" : "awaiting_break",
          structure_break_time: breakTime,
        },
      }, { barIndexLookup });
    })
    .slice(-80);
}

function buildSwingPointEventItems(bars = [], timeframe = "", pivot = 5) {
  const barIndexLookup = createBarIndexLookup(bars);
  return buildRecentStructurePivots(bars, pivot)
    .map((pivotPoint) => {
      const type = String(pivotPoint?.type || "").trim().toLowerCase();
      const price = Number(pivotPoint?.price);
      const time = Number(pivotPoint?.time);
      if (!Number.isFinite(price) || !Number.isFinite(time)) return null;
      const isHigh = type === "swing_high";
      return normalizeChartArtifactItem({
        id: buildItemId(["structure", timeframe, `${type}_event`, time, price]),
        family: "structure",
        type: `${type}_event`,
        subtype: type,
        label: isHigh ? "SH" : "SL",
        timeframe,
        source: "derived",
        origin: "bars",
        direction: isHigh ? "bearish" : "bullish",
        price,
        anchor_time: time,
        bar_start: time,
        bar_end: time,
        payload: {
          swing_time: time,
          swing_price: price,
          structure_tag: String(pivotPoint?.structureTag || "").trim().toLowerCase(),
        },
      }, { barIndexLookup });
    })
    .filter(Boolean)
    .slice(-40);
}

function buildStructureTagEventItems(bars = [], timeframe = "", pivot = 5) {
  const barIndexLookup = createBarIndexLookup(bars);
  return buildRecentStructurePivots(bars, pivot)
    .map((pivotPoint) => {
      const structureTag = String(pivotPoint?.structureTag || "").trim().toLowerCase();
      if (!["hh", "hl", "lh", "ll"].includes(structureTag)) return null;
      const price = Number(pivotPoint?.price);
      const time = Number(pivotPoint?.time);
      if (!Number.isFinite(price) || !Number.isFinite(time)) return null;
      return normalizeChartArtifactItem({
        id: buildItemId(["structure", timeframe, structureTag, time, price]),
        family: "structure",
        type: structureTag,
        subtype: String(pivotPoint?.type || "").trim().toLowerCase(),
        label: structureTag.toUpperCase(),
        timeframe,
        source: "derived",
        origin: "bars",
        direction: structureTag === "hh" || structureTag === "hl" ? "bullish" : "bearish",
        price,
        anchor_time: time,
        bar_start: time,
        bar_end: time,
        payload: {
          structure_tag: structureTag,
          pivot_time: time,
          pivot_price: price,
          previous_same_type_time: Number(pivotPoint?.previousSameTypeTime) || null,
          previous_same_type_price: Number(pivotPoint?.previousSameTypePrice) || null,
        },
      }, { barIndexLookup });
    })
    .filter(Boolean)
    .slice(-40);
}

function computeRsiSeries(bars = [], period = 14) {
  const source = Array.isArray(bars) ? bars : [];
  if (!source.length) return [];
  const closes = source.map((bar) => Number(bar?.close)).filter((value) => Number.isFinite(value));
  if (!closes.length) return new Array(source.length).fill(null);
  const output = new Array(source.length).fill(null);
  if (closes.length <= period) return output;
  let gainSum = 0;
  let lossSum = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (delta >= 0) gainSum += delta;
    else lossSum += Math.abs(delta);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  const firstRs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  output[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRs);
  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    output[index] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  }
  return output;
}

function buildRecentStructurePivots(bars = [], pivot = 5) {
  const effectivePivot = resolveAdaptiveStructurePivot(bars, pivot);
  const recentBarRanges = (Array.isArray(bars) ? bars : [])
    .slice(-40)
    .map((bar) => candleRangeSize(bar))
    .filter((value) => Number.isFinite(value) && value > 0);
  const tolerance = Math.max((medianNumber(recentBarRanges) || 1) * 0.03, 0.0000001);
  return classifyStructurePivots(
    buildZigZagPivotPoints(bars, effectivePivot),
    tolerance,
  );
}

function buildTrendlineItems(bars = [], timeframe = "", pivot = 5) {
  const barIndexLookup = createBarIndexLookup(bars);
  const pivots = buildRecentStructurePivots(bars, pivot);
  const lows = pivots.filter((item) => item?.type === "swing_low").slice(-3);
  const highs = pivots.filter((item) => item?.type === "swing_high").slice(-3);
  const out = [];
  const latestLow = lows[lows.length - 1];
  const previousLow = lows[lows.length - 2];
  if (
    latestLow &&
    previousLow &&
    Number(latestLow.price) > Number(previousLow.price)
  ) {
    const slope = (Number(latestLow.price) - Number(previousLow.price))
      / Math.max(1, Number(latestLow.time) - Number(previousLow.time));
    out.push(
      normalizeChartArtifactItem({
        id: buildItemId(["trendline", timeframe, "support", previousLow.time, latestLow.time]),
        family: "trendline",
        type: "trendline_support",
        subtype: "bullish",
        label: "Bull Trendline",
        timeframe,
        source: "derived",
        origin: "bars",
        direction: "BUY",
        price: latestLow.price,
        anchor_time: latestLow.time,
        bar_start: previousLow.time,
        bar_end: latestLow.time,
        metrics: {
          slope,
        },
        payload: {
          from_time: Number(previousLow.time),
          from_price: Number(previousLow.price),
          to_time: Number(latestLow.time),
          to_price: Number(latestLow.price),
          pivot_strength: pivot,
          previous_tag: String(previousLow?.structureTag || "").trim().toLowerCase(),
          current_tag: String(latestLow?.structureTag || "").trim().toLowerCase(),
        },
      }, { barIndexLookup }),
    );
  }
  const latestHigh = highs[highs.length - 1];
  const previousHigh = highs[highs.length - 2];
  if (
    latestHigh &&
    previousHigh &&
    Number(latestHigh.price) < Number(previousHigh.price)
  ) {
    const slope = (Number(latestHigh.price) - Number(previousHigh.price))
      / Math.max(1, Number(latestHigh.time) - Number(previousHigh.time));
    out.push(
      normalizeChartArtifactItem({
        id: buildItemId(["trendline", timeframe, "resistance", previousHigh.time, latestHigh.time]),
        family: "trendline",
        type: "trendline_resistance",
        subtype: "bearish",
        label: "Bear Trendline",
        timeframe,
        source: "derived",
        origin: "bars",
        direction: "SELL",
        price: latestHigh.price,
        anchor_time: latestHigh.time,
        bar_start: previousHigh.time,
        bar_end: latestHigh.time,
        metrics: {
          slope,
        },
        payload: {
          from_time: Number(previousHigh.time),
          from_price: Number(previousHigh.price),
          to_time: Number(latestHigh.time),
          to_price: Number(latestHigh.price),
          pivot_strength: pivot,
          previous_tag: String(previousHigh?.structureTag || "").trim().toLowerCase(),
          current_tag: String(latestHigh?.structureTag || "").trim().toLowerCase(),
        },
      }, { barIndexLookup }),
    );
  }
  return out.slice(-2);
}

function buildRsiDivergenceItems(bars = [], timeframe = "", pivot = 5) {
  const barIndexLookup = createBarIndexLookup(bars);
  const source = Array.isArray(bars) ? bars : [];
  if (source.length < 24) return [];
  const pivots = buildRecentStructurePivots(source, pivot);
  const rsiSeries = computeRsiSeries(source, 14);
  const rsiByTime = new Map(
    source.map((bar, index) => [Number(bar?.time), Number(rsiSeries[index])]),
  );
  const lows = pivots.filter((item) => item?.type === "swing_low").slice(-3);
  const highs = pivots.filter((item) => item?.type === "swing_high").slice(-3);
  const out = [];

  const latestLow = lows[lows.length - 1];
  const previousLow = lows[lows.length - 2];
  const latestLowRsi = Number(rsiByTime.get(Number(latestLow?.time)));
  const previousLowRsi = Number(rsiByTime.get(Number(previousLow?.time)));
  if (
    latestLow &&
    previousLow &&
    Number.isFinite(latestLowRsi) &&
    Number.isFinite(previousLowRsi) &&
    Number(latestLow.price) < Number(previousLow.price) &&
    latestLowRsi > previousLowRsi + 2
  ) {
    out.push(
      normalizeChartArtifactItem({
        id: buildItemId(["divergence", timeframe, "bullish_rsi", previousLow.time, latestLow.time]),
        family: "divergence",
        type: "bullish_divergence",
        subtype: "rsi",
        label: "Bullish RSI Divergence",
        timeframe,
        source: "derived",
        origin: "bars",
        direction: "BUY",
        price: latestLow.price,
        anchor_time: latestLow.time,
        bar_start: previousLow.time,
        bar_end: latestLow.time,
        payload: {
          from_time: Number(previousLow.time),
          from_price: Number(previousLow.price),
          to_time: Number(latestLow.time),
          to_price: Number(latestLow.price),
          indicator: "rsi",
          indicator_previous: previousLowRsi,
          indicator_current: latestLowRsi,
          divergence_class: "regular_bullish",
        },
      }, { barIndexLookup }),
    );
  }

  const latestHigh = highs[highs.length - 1];
  const previousHigh = highs[highs.length - 2];
  const latestHighRsi = Number(rsiByTime.get(Number(latestHigh?.time)));
  const previousHighRsi = Number(rsiByTime.get(Number(previousHigh?.time)));
  if (
    latestHigh &&
    previousHigh &&
    Number.isFinite(latestHighRsi) &&
    Number.isFinite(previousHighRsi) &&
    Number(latestHigh.price) > Number(previousHigh.price) &&
    latestHighRsi < previousHighRsi - 2
  ) {
    out.push(
      normalizeChartArtifactItem({
        id: buildItemId(["divergence", timeframe, "bearish_rsi", previousHigh.time, latestHigh.time]),
        family: "divergence",
        type: "bearish_divergence",
        subtype: "rsi",
        label: "Bearish RSI Divergence",
        timeframe,
        source: "derived",
        origin: "bars",
        direction: "SELL",
        price: latestHigh.price,
        anchor_time: latestHigh.time,
        bar_start: previousHigh.time,
        bar_end: latestHigh.time,
        payload: {
          from_time: Number(previousHigh.time),
          from_price: Number(previousHigh.price),
          to_time: Number(latestHigh.time),
          to_price: Number(latestHigh.price),
          indicator: "rsi",
          indicator_previous: previousHighRsi,
          indicator_current: latestHighRsi,
          divergence_class: "regular_bearish",
        },
      }, { barIndexLookup }),
    );
  }

  return out.slice(-2);
}

function utcDayKeyFromUnixSec(value) {
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function medianNumber(values = []) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function candleBodySize(bar = {}) {
  return Math.abs(Number(bar?.close) - Number(bar?.open));
}

function isMeaningfulFvgGap(gapSize = 0, middleRange = 0) {
  const gap = Number(gapSize);
  const range = Number(middleRange);
  if (!Number.isFinite(gap) || gap <= 0) return false;
  if (!Number.isFinite(range) || range <= 0) return false;
  return gap / range >= 0.08;
}

function isStrongDisplacementCandle(bars = [], index = 0, direction = "bullish") {
  const bar = bars[index];
  if (!bar) return false;
  const open = Number(bar.open);
  const close = Number(bar.close);
  const range = Math.max(0.0000001, candleRangeSize(bar));
  const body = candleBodySize(bar);
  const prevRanges = bars
    .slice(Math.max(0, index - 8), index)
    .map((entry) => candleRangeSize(entry))
    .filter((value) => Number.isFinite(value) && value > 0);
  const medianRange = medianNumber(prevRanges) || range;
  const bodyRatio = body / range;
  const rangeExpansion = range / Math.max(medianRange, 0.0000001);
  const directional =
    direction === "bearish" ? close < open && body > 0 : close > open && body > 0;
  return directional && bodyRatio >= 0.6 && rangeExpansion >= 1.2;
}

function buildFvgZoneItems(bars = [], timeframe = "") {
  const barIndexLookup = createBarIndexLookup(bars);
  const out = [];
  for (let index = 1; index < bars.length - 1; index += 1) {
    const left = bars[index - 1];
    const mid = bars[index];
    const right = bars[index + 1];
    if (!left || !mid || !right) continue;
    if (left.high < right.low && isStrongDisplacementCandle(bars, index, "bullish")) {
      const gapSize = Number(right.low) - Number(left.high);
      const middleRange = candleRangeSize(mid);
      if (!isMeaningfulFvgGap(gapSize, middleRange)) continue;
      out.push(
        ...buildDynamicZoneLifecycleArtifacts({
          bars,
          barIndexLookup,
          baseItem: {
          id: buildItemId(["zone", timeframe, "fvg_bullish", mid.time, left.high, right.low]),
          family: "zone",
          type: "fvg",
          subtype: "bullish",
          label: "Bullish FVG",
          timeframe,
          source: "derived",
          origin: "bars",
          direction: "BUY",
          price_low: left.high,
          price_high: right.low,
          bar_start: left.time,
          bar_end: right.time,
          anchor_time: mid.time,
          payload: {
            middle_bar_time: mid.time,
            middle_bar_body: candleBodySize(mid),
            middle_bar_range: candleRangeSize(mid),
            strength: "strong",
            gap_size: gapSize,
            extension_bars: 20,
          },
          },
          creationEndTime: Number(right.time),
          convertType: "ifvg",
          convertLabel: "Bearish iFVG",
        }),
      );
    }
    if (left.low > right.high && isStrongDisplacementCandle(bars, index, "bearish")) {
      const gapSize = Number(left.low) - Number(right.high);
      const middleRange = candleRangeSize(mid);
      if (!isMeaningfulFvgGap(gapSize, middleRange)) continue;
      out.push(
        ...buildDynamicZoneLifecycleArtifacts({
          bars,
          barIndexLookup,
          baseItem: {
          id: buildItemId(["zone", timeframe, "fvg_bearish", mid.time, right.high, left.low]),
          family: "zone",
          type: "fvg",
          subtype: "bearish",
          label: "Bearish FVG",
          timeframe,
          source: "derived",
          origin: "bars",
          direction: "SELL",
          price_low: right.high,
          price_high: left.low,
          bar_start: left.time,
          bar_end: right.time,
          anchor_time: mid.time,
          payload: {
            middle_bar_time: mid.time,
            middle_bar_body: candleBodySize(mid),
            middle_bar_range: candleRangeSize(mid),
            strength: "strong",
            gap_size: gapSize,
            extension_bars: 20,
          },
          },
          creationEndTime: Number(right.time),
          convertType: "ifvg",
          convertLabel: "Bullish iFVG",
        }),
      );
    }
  }
  return out.slice(-80);
}

function findLastOpposingCandle(bars = [], index = 0, direction = "bullish", lookback = 4) {
  for (let cursor = index - 1; cursor >= Math.max(0, index - lookback); cursor -= 1) {
    const bar = bars[cursor];
    if (!bar) continue;
    const isBearish = Number(bar.close) < Number(bar.open);
    const isBullish = Number(bar.close) > Number(bar.open);
    if (direction === "bullish" ? isBearish : isBullish) {
      return { bar, index: cursor };
    }
  }
  return null;
}

function buildOrderBlockItems(bars = [], timeframe = "") {
  const barIndexLookup = createBarIndexLookup(bars);
  const out = [];
  for (let index = 1; index < bars.length - 1; index += 1) {
    const mid = bars[index];
    const right = bars[index + 1];
    if (!mid || !right) continue;
    if (isStrongDisplacementCandle(bars, index, "bullish")) {
      const candidate = findLastOpposingCandle(bars, index, "bullish");
      if (candidate?.bar && Number(right.close) > Number(candidate.bar.high)) {
        out.push(
          ...buildDynamicZoneLifecycleArtifacts({
            bars,
            barIndexLookup,
            baseItem: {
            id: buildItemId([
              "zone",
              timeframe,
              "ob_bullish",
              candidate.bar.time,
              candidate.bar.low,
              candidate.bar.high,
            ]),
            family: "zone",
            type: "ob",
            subtype: "bullish",
            label: "Bullish OB",
            timeframe,
            source: "derived",
            origin: "bars",
            direction: "BUY",
            price_low: Number(candidate.bar.low),
            price_high: Number(candidate.bar.high),
            bar_start: Number(candidate.bar.time),
            bar_end: Number(mid.time),
            anchor_time: Number(candidate.bar.time),
            payload: {
              displacement_bar_time: Number(mid.time),
              confirmation_bar_time: Number(right.time),
            },
            },
            creationEndTime: Number(right.time),
            convertType: "bb",
            convertLabel: "Bearish BB",
          }),
        );
      }
    }
    if (isStrongDisplacementCandle(bars, index, "bearish")) {
      const candidate = findLastOpposingCandle(bars, index, "bearish");
      if (candidate?.bar && Number(right.close) < Number(candidate.bar.low)) {
        out.push(
          ...buildDynamicZoneLifecycleArtifacts({
            bars,
            barIndexLookup,
            baseItem: {
            id: buildItemId([
              "zone",
              timeframe,
              "ob_bearish",
              candidate.bar.time,
              candidate.bar.low,
              candidate.bar.high,
            ]),
            family: "zone",
            type: "ob",
            subtype: "bearish",
            label: "Bearish OB",
            timeframe,
            source: "derived",
            origin: "bars",
            direction: "SELL",
            price_low: Number(candidate.bar.low),
            price_high: Number(candidate.bar.high),
            bar_start: Number(candidate.bar.time),
            bar_end: Number(mid.time),
            anchor_time: Number(candidate.bar.time),
            payload: {
              displacement_bar_time: Number(mid.time),
              confirmation_bar_time: Number(right.time),
            },
            },
            creationEndTime: Number(right.time),
            convertType: "bb",
            convertLabel: "Bullish BB",
          }),
        );
      }
    }
  }
  return out.slice(-60);
}

function buildLiquidityItems(bars = [], timeframe = "", pivot = 5) {
  const barIndexLookup = createBarIndexLookup(bars);
  const out = [];
  const swings = buildSwingLevelItems(bars, timeframe, pivot)
    .map((item) => ({
      type: String(item.type || "").trim().toLowerCase(),
      price: Number(item.price),
      time: Number(item.anchor_time ?? item.bar_start),
    }))
    .filter((item) => Number.isFinite(item.price) && Number.isFinite(item.time));
  const recentBarRanges = bars
    .slice(-20)
    .map((bar) => candleRangeSize(bar))
    .filter((value) => Number.isFinite(value) && value > 0);
  const medianRange = medianNumber(recentBarRanges) || 1;
  const tolerance = Math.max(medianRange * 0.15, 0.0000001);
  let lastHigh = null;
  let lastLow = null;
  for (let index = 0; index < swings.length; index += 1) {
    const current = swings[index];
    const prev = current.type === "swing_high" ? lastHigh : lastLow;
    if (!prev) {
      if (current.type === "swing_high") lastHigh = current;
      if (current.type === "swing_low") lastLow = current;
      continue;
    }
    if (Math.abs(current.price - prev.price) <= tolerance) {
      const kind = current.type === "swing_high" ? "liquidity_high" : "liquidity_low";
      out.push(
        normalizeChartArtifactItem({
          id: buildItemId([
            "structure",
            timeframe,
            kind,
            prev.time,
            current.time,
            (prev.price + current.price) / 2,
          ]),
          family: "structure",
          type: kind,
          subtype: "equal_level",
          label: current.type === "swing_high" ? "Liquidity High" : "Liquidity Low",
          timeframe,
          source: "derived",
          origin: "bars",
          direction: current.type === "swing_high" ? "SELL" : "BUY",
          price: (prev.price + current.price) / 2,
          bar_start: prev.time,
          bar_end: current.time,
          anchor_time: current.time,
          payload: {
            first_touch_time: prev.time,
            second_touch_time: current.time,
            tolerance,
          },
        }, { barIndexLookup }),
      );
    }
    if (current.type === "swing_high") lastHigh = current;
    if (current.type === "swing_low") lastLow = current;
  }
  return out.slice(-40);
}

function resolveAdaptiveStructurePivot(bars = [], preferredPivot = 5) {
  const barCount = Array.isArray(bars) ? bars.length : 0;
  if (barCount < 7) return 2;
  if (barCount < 12) return 2;
  if (barCount < 24) return 3;
  return Math.max(2, Number(preferredPivot) || 5);
}

function buildSweepItems(bars = [], timeframe = "", pivot = 5) {
  const barIndexLookup = createBarIndexLookup(bars);
  const out = [];
  const effectivePivot = resolveAdaptiveStructurePivot(bars, pivot);
  const pivots = buildZigZagPivotPoints(bars, effectivePivot);
  if (!pivots.length) return out;
  let pivotIndex = 0;
  let lastHigh = null;
  let lastLow = null;
  const consumed = new Set();
  const recentBarRanges = bars
    .slice(-40)
    .map((bar) => candleRangeSize(bar))
    .filter((value) => Number.isFinite(value) && value > 0);
  const tolerance = Math.max((medianNumber(recentBarRanges) || 1) * 0.03, 0.0000001);

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const barTime = Number(bar?.time);
    if (!Number.isFinite(barTime)) continue;
    while (pivotIndex < pivots.length && Number(pivots[pivotIndex]?.time) < barTime) {
      const pivotPoint = pivots[pivotIndex];
      if (pivotPoint?.type === "swing_high") lastHigh = pivotPoint;
      if (pivotPoint?.type === "swing_low") lastLow = pivotPoint;
      pivotIndex += 1;
    }

    if (
      lastHigh &&
      !consumed.has(`high:${lastHigh.time}`) &&
      Number(bar.high) > Number(lastHigh.price) + tolerance &&
      Number(bar.close) < Number(lastHigh.price)
    ) {
      consumed.add(`high:${lastHigh.time}`);
      out.push(
        normalizeChartArtifactItem({
          id: buildItemId(["structure", timeframe, "sweep_high", bar.time, lastHigh.time, lastHigh.price]),
          family: "structure",
          type: "sweep_high",
          subtype: "bearish",
          label: "Sweep",
          timeframe,
          source: "derived",
          origin: "bars",
          direction: "SELL",
          price: Number(lastHigh.price),
          anchor_time: Number(bar.time),
          bar_start: Number(lastHigh.time),
          bar_end: Number(bar.time),
          payload: {
            bias: "bearish",
            swept_swing_time: Number(lastHigh.time),
            swept_swing_price: Number(lastHigh.price),
          },
        }, { barIndexLookup }),
      );
    }

    if (
      lastLow &&
      !consumed.has(`low:${lastLow.time}`) &&
      Number(bar.low) < Number(lastLow.price) - tolerance &&
      Number(bar.close) > Number(lastLow.price)
    ) {
      consumed.add(`low:${lastLow.time}`);
      out.push(
        normalizeChartArtifactItem({
          id: buildItemId(["structure", timeframe, "sweep_low", bar.time, lastLow.time, lastLow.price]),
          family: "structure",
          type: "sweep_low",
          subtype: "bullish",
          label: "Sweep",
          timeframe,
          source: "derived",
          origin: "bars",
          direction: "BUY",
          price: Number(lastLow.price),
          anchor_time: Number(bar.time),
          bar_start: Number(lastLow.time),
          bar_end: Number(bar.time),
          payload: {
            bias: "bullish",
            swept_swing_time: Number(lastLow.time),
            swept_swing_price: Number(lastLow.price),
          },
        }, { barIndexLookup }),
      );
    }
  }
  return out.slice(-60);
}

function buildStructureBreakItems(bars = [], timeframe = "", pivot = 5) {
  const barIndexLookup = createBarIndexLookup(bars);
  const out = [];
  const effectivePivot = resolveAdaptiveStructurePivot(bars, pivot);
  const recentBarRanges = bars
    .slice(-40)
    .map((bar) => candleRangeSize(bar))
    .filter((value) => Number.isFinite(value) && value > 0);
  const medianRange = medianNumber(recentBarRanges) || 1;
  const pivots = classifyStructurePivots(
    buildZigZagPivotPoints(bars, effectivePivot),
    Math.max(medianRange * 0.03, 0.0000001),
  );
  if (!pivots.length) return out;
  let pivotIndex = 0;
  let lastHigh = null;
  let lastLow = null;
  let lastBreakBias = "";
  let lastBullBreak = null;
  let lastBearBreak = null;
  const consumed = new Set();
  const tolerance = Math.max(medianRange * 0.02, 0.0000001);
  const sameLevelTolerance = Math.max(medianRange * 0.2, tolerance * 6);
  const barSpacingCandidates = bars
    .slice(-80)
    .map((bar, index, list) =>
      index > 0 ? Number(bar?.time) - Number(list[index - 1]?.time) : null,
    )
    .filter((value) => Number.isFinite(value) && value > 0);
  const barSpacingSec = medianNumber(barSpacingCandidates) || 60;
  const repeatWindowSec = Math.max(barSpacingSec * effectivePivot * 6, barSpacingSec * 3);

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const barTime = Number(bar?.time);
    if (!Number.isFinite(barTime)) continue;
    while (pivotIndex < pivots.length && Number(pivots[pivotIndex]?.time) < barTime) {
      const pivotPoint = pivots[pivotIndex];
      if (pivotPoint?.type === "swing_high") lastHigh = pivotPoint;
      if (pivotPoint?.type === "swing_low") lastLow = pivotPoint;
      pivotIndex += 1;
    }

    if (
      lastHigh &&
      !consumed.has(`bos-high:${lastHigh.time}`) &&
      Number(bar.close) > Number(lastHigh.price) + tolerance
    ) {
      const structureBias = inferPivotStructureBias(lastHigh, lastLow, lastBreakBias);
      const isChoch = structureBias === "bearish";
      const isDuplicateLevel =
        lastBullBreak &&
        Math.abs(Number(lastHigh.price) - Number(lastBullBreak.level)) <= sameLevelTolerance &&
        Math.abs(Number(bar.time) - Number(lastBullBreak.time)) <= repeatWindowSec;
      if (isDuplicateLevel) {
        consumed.add(`bos-high:${lastHigh.time}`);
        continue;
      }
      consumed.add(`bos-high:${lastHigh.time}`);
      lastBreakBias = "bullish";
      lastBullBreak = {
        level: Number(lastHigh.price),
        time: Number(bar.time),
      };
      out.push(
        normalizeChartArtifactItem({
          id: buildItemId([
            "structure",
            timeframe,
            isChoch ? "choch" : "bos",
            "bullish",
            bar.time,
            lastHigh.time,
            lastHigh.price,
          ]),
          family: "structure",
          type: isChoch ? "choch" : "bos",
          subtype: "bullish",
          label: isChoch ? "CHOCH" : "BOS",
          timeframe,
          source: "derived",
          origin: "bars",
          direction: "BUY",
          price: Number(lastHigh.price),
          anchor_time: Number(bar.time),
          bar_start: Number(lastHigh.time),
          bar_end: Number(bar.time),
          payload: {
            bias: "bullish",
            source_swing_time: Number(lastHigh.time),
            source_swing_price: Number(lastHigh.price),
            confirmed_by_close: true,
            source_swing_structure_tag: String(lastHigh?.structureTag || "").trim().toLowerCase(),
          },
        }, { barIndexLookup }),
      );
    }

    if (
      lastLow &&
      !consumed.has(`bos-low:${lastLow.time}`) &&
      Number(bar.close) < Number(lastLow.price) - tolerance
    ) {
      const structureBias = inferPivotStructureBias(lastHigh, lastLow, lastBreakBias);
      const isChoch = structureBias === "bullish";
      const isDuplicateLevel =
        lastBearBreak &&
        Math.abs(Number(lastLow.price) - Number(lastBearBreak.level)) <= sameLevelTolerance &&
        Math.abs(Number(bar.time) - Number(lastBearBreak.time)) <= repeatWindowSec;
      if (isDuplicateLevel) {
        consumed.add(`bos-low:${lastLow.time}`);
        continue;
      }
      consumed.add(`bos-low:${lastLow.time}`);
      lastBreakBias = "bearish";
      lastBearBreak = {
        level: Number(lastLow.price),
        time: Number(bar.time),
      };
      out.push(
        normalizeChartArtifactItem({
          id: buildItemId([
            "structure",
            timeframe,
            isChoch ? "choch" : "bos",
            "bearish",
            bar.time,
            lastLow.time,
            lastLow.price,
          ]),
          family: "structure",
          type: isChoch ? "choch" : "bos",
          subtype: "bearish",
          label: isChoch ? "CHOCH" : "BOS",
          timeframe,
          source: "derived",
          origin: "bars",
          direction: "SELL",
          price: Number(lastLow.price),
          anchor_time: Number(bar.time),
          bar_start: Number(lastLow.time),
          bar_end: Number(bar.time),
          payload: {
            bias: "bearish",
            source_swing_time: Number(lastLow.time),
            source_swing_price: Number(lastLow.price),
            confirmed_by_close: true,
            source_swing_structure_tag: String(lastLow?.structureTag || "").trim().toLowerCase(),
          },
        }, { barIndexLookup }),
      );
    }
  }
  return out.slice(-80);
}

function buildPreviousDayLevelItems(bars = [], timeframe = "") {
  const barIndexLookup = createBarIndexLookup(bars);
  const dayBuckets = new Map();
  for (const bar of Array.isArray(bars) ? bars : []) {
    const dayKey = utcDayKeyFromUnixSec(bar?.time);
    if (!dayKey) continue;
    const entry = dayBuckets.get(dayKey) || {
      dayKey,
      startTime: Number(bar.time),
      endTime: Number(bar.time),
      high: Number(bar.high),
      low: Number(bar.low),
    };
    entry.startTime = Math.min(entry.startTime, Number(bar.time));
    entry.endTime = Math.max(entry.endTime, Number(bar.time));
    entry.high = Math.max(entry.high, Number(bar.high));
    entry.low = Math.min(entry.low, Number(bar.low));
    dayBuckets.set(dayKey, entry);
  }
  const days = Array.from(dayBuckets.values()).sort((a, b) => a.startTime - b.startTime);
  const out = [];
  for (let index = 1; index < days.length; index += 1) {
    const prev = days[index - 1];
    const current = days[index];
    out.push(
      normalizeChartArtifactItem({
        id: buildItemId(["level", timeframe, "pdh", current.startTime, prev.high]),
        family: "level",
        type: "pdh",
        subtype: "session",
        label: "PDH",
        timeframe,
        source: "derived",
        origin: "bars",
        price: prev.high,
        bar_start: current.startTime,
        bar_end: current.endTime,
        anchor_time: current.startTime,
        payload: { previous_day: prev.dayKey, current_day: current.dayKey },
      }, { barIndexLookup }),
    );
    out.push(
      normalizeChartArtifactItem({
        id: buildItemId(["level", timeframe, "pdl", current.startTime, prev.low]),
        family: "level",
        type: "pdl",
        subtype: "session",
        label: "PDL",
        timeframe,
        source: "derived",
        origin: "bars",
        price: prev.low,
        bar_start: current.startTime,
        bar_end: current.endTime,
        anchor_time: current.startTime,
        payload: { previous_day: prev.dayKey, current_day: current.dayKey },
      }, { barIndexLookup }),
    );
  }
  return out.slice(-20);
}

function buildSupportDemandLevelItems(bars = [], timeframe = "", pivot = 5) {
  const barIndexLookup = createBarIndexLookup(bars);
  const out = [];
  const swings = buildSwingLevelItems(bars, timeframe, pivot);
  for (const item of swings) {
    const price = Number(item.price);
    const anchorTime = Number(item.anchor_time ?? item.bar_start);
    if (!Number.isFinite(price) || !Number.isFinite(anchorTime)) continue;
    if (String(item.type || "").trim().toLowerCase() === "swing_low") {
      out.push(
        normalizeChartArtifactItem({
          id: buildItemId(["level", timeframe, "support", anchorTime, price]),
          family: "level",
          type: "support",
          subtype: "swing_low",
          label: "Support",
          timeframe,
          source: "derived",
          origin: "bars",
          price,
          bar_start: anchorTime,
          anchor_time: anchorTime,
        }, { barIndexLookup }),
      );
    }
  }
  const orderBlocks = buildOrderBlockItems(bars, timeframe);
  for (const item of orderBlocks) {
    if (String(item.subtype || "").trim().toLowerCase() !== "bullish") continue;
    const top = Number(item.price_high);
    const bottom = Number(item.price_low);
    const anchorTime = Number(item.anchor_time ?? item.bar_start);
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || !Number.isFinite(anchorTime)) {
      continue;
    }
    out.push(
      normalizeChartArtifactItem({
        id: buildItemId(["level", timeframe, "demand", anchorTime, top, bottom]),
        family: "level",
        type: "demand",
        subtype: "bullish_ob",
        label: "Demand",
        timeframe,
        source: "derived",
        origin: "bars",
        price: (top + bottom) / 2,
        bar_start: anchorTime,
        anchor_time: anchorTime,
        payload: {
          source_order_block_id: item.id,
          price_low: bottom,
          price_high: top,
        },
      }, { barIndexLookup }),
    );
  }
  return dedupeItems(out).slice(-60);
}

function dedupeItems(items = []) {
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const item = normalizeChartArtifactItem(raw);
    const key = `${item.family}|${item.type}|${item.subtype}|${item.timeframe}|${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function artifactReferencePrice(item = {}) {
  const price = Number(item?.price);
  const low = Number(item?.price_low);
  const high = Number(item?.price_high);
  if (Number.isFinite(low) && Number.isFinite(high)) return (low + high) / 2;
  if (Number.isFinite(price)) return price;
  if (Number.isFinite(low)) return low;
  if (Number.isFinite(high)) return high;
  return null;
}

function artifactReferenceTime(item = {}) {
  const time = Number(item?.anchor_time ?? item?.bar_start ?? item?.time);
  return Number.isFinite(time) ? time : null;
}

function shouldLimitArtifactType(type = "", family = "") {
  const normalizedType = String(type || "").trim().toLowerCase();
  const normalizedFamily = String(family || "").trim().toLowerCase();
  if (normalizedFamily === "pattern") return false;
  if (normalizedFamily === "swing") return false;
  if (normalizedFamily === "trendline") return false;
  if (normalizedFamily === "divergence") return false;
  if (normalizedFamily === "structure") return false;
  if (normalizedType === "swing_high" || normalizedType === "swing_low") return false;
  if (normalizedType === "bos" || normalizedType === "choch") return false;
  if (normalizedType === "sweep_high" || normalizedType === "sweep_low") return false;
  if (normalizedType === "liquidity_high" || normalizedType === "liquidity_low") return false;
  return true;
}

function limitArtifactsNearLastBarByType(items = [], bars = []) {
  const lastBar = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null;
  const lastClose = Number(lastBar?.close);
  if (!Number.isFinite(lastClose)) return Array.isArray(items) ? items : [];
  const allItems = Array.isArray(items) ? items : [];
  const groups = new Map();
  for (const item of allItems) {
    const typeKey = String(item?.type || "").trim().toLowerCase();
    const familyKey = String(item?.family || "").trim().toLowerCase();
    const groupKey = `${familyKey}|${typeKey}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(item);
  }
  const keepIds = new Set();
  for (const [groupKey, groupItems] of groups.entries()) {
    const [familyKey, typeKey] = String(groupKey || "").split("|");
    if (!shouldLimitArtifactType(typeKey, familyKey)) {
      groupItems.forEach((item) => {
        if (item?.id) keepIds.add(String(item.id));
      });
      continue;
    }
    const ordered = [...groupItems].sort((a, b) => {
      const tA = artifactReferenceTime(a) || 0;
      const tB = artifactReferenceTime(b) || 0;
      return tB - tA;
    });
    let foundAbove = null;
    let foundBelow = null;
    for (const item of ordered) {
      const refPrice = artifactReferencePrice(item);
      if (!Number.isFinite(refPrice)) continue;
      if (!foundAbove && refPrice >= lastClose) {
        foundAbove = item;
        if (item?.id) keepIds.add(String(item.id));
      } else if (!foundBelow && refPrice < lastClose) {
        foundBelow = item;
        if (item?.id) keepIds.add(String(item.id));
      }
      if (foundAbove && foundBelow) break;
    }
  }
  return allItems.filter((item) => {
    if (!item?.id) return false;
    if (!shouldLimitArtifactType(item?.type, item?.family)) return true;
    return keepIds.has(String(item.id));
  });
}

function buildDerivedItemsFromBars(bars = [], timeframe = "") {
  const normalizedBars = normalizeBars(bars);
  return limitArtifactsNearLastBarByType(
    dedupeItems([
      ...buildSwingLevelItems(normalizedBars, timeframe),
      ...buildSwingPointEventItems(normalizedBars, timeframe),
      ...buildStructureTagEventItems(normalizedBars, timeframe),
      ...buildPreviousDayLevelItems(normalizedBars, timeframe),
      ...buildSupportDemandLevelItems(normalizedBars, timeframe),
      ...buildLiquidityItems(normalizedBars, timeframe),
      ...buildSweepItems(normalizedBars, timeframe),
      ...buildStructureBreakItems(normalizedBars, timeframe),
      ...buildFvgZoneItems(normalizedBars, timeframe),
      ...buildOrderBlockItems(normalizedBars, timeframe),
      ...buildTrendlineItems(normalizedBars, timeframe),
      ...buildRsiDivergenceItems(normalizedBars, timeframe),
      ...buildCandlePatternItems(normalizedBars, timeframe),
    ]),
    normalizedBars,
  );
}

export {
  artifactReferencePrice,
  artifactReferenceTime,
  buildCandlePatternItems,
  buildDerivedItemsFromBars,
  buildFvgZoneItems,
  buildItemId,
  buildLiquidityItems,
  buildOrderBlockItems,
  buildPreviousDayLevelItems,
  buildStructureBreakItems,
  buildSupportDemandLevelItems,
  buildSweepItems,
  buildSwingLevelItems,
  buildZigZagPivotPoints,
  candleBodySize,
  candleRangeSize,
  dedupeItems,
  findLastOpposingCandle,
  inferPatternAt,
  isMeaningfulFvgGap,
  isStrongDisplacementCandle,
  limitArtifactsNearLastBarByType,
  medianNumber,
  normalizeBars,
  normalizeChartArtifactItem,
  resolveAdaptiveStructurePivot,
  shouldLimitArtifactType,
  utcDayKeyFromUnixSec,
};
