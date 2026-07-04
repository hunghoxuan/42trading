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
    direction: String(item.direction || fallback.direction || "").trim(),
    price: Number.isFinite(price) ? price : null,
    price_low: Number.isFinite(priceLow) ? priceLow : null,
    price_high: Number.isFinite(priceHigh) ? priceHigh : null,
    bar_start: Number.isFinite(barStart) ? barStart : null,
    bar_end: Number.isFinite(barEnd) ? barEnd : null,
    anchor_time: Number.isFinite(anchorTime) ? anchorTime : null,
    geometry:
      item.geometry && typeof item.geometry === "object" ? clone(item.geometry) : {},
    style: item.style && typeof item.style === "object" ? clone(item.style) : {},
    tags: Array.isArray(item.tags) ? [...item.tags] : [],
    metrics: item.metrics && typeof item.metrics === "object" ? clone(item.metrics) : {},
    payload: item.payload && typeof item.payload === "object" ? clone(item.payload) : {},
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
  const out = [];
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const patterns = inferPatternAt(bars, index);
    for (const pattern of patterns) {
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
          price: bar.close,
          anchor_time: bar.time,
          bar_start: bar.time,
          payload: { bar },
        }),
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

function candleRangeSize(bar = {}) {
  return Math.max(0, Number(bar?.high) - Number(bar?.low));
}

function buildSwingLevelItems(bars = [], timeframe = "", pivot = 5) {
  return buildZigZagPivotPoints(bars, pivot)
    .map((pivotPoint) => {
      const bar = pivotPoint?.bar || {};
      const range = candleRangeSize(bar);
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
        label: pivotPoint.type === "swing_high" ? "Swing High" : "Swing Low",
        timeframe,
        source: "derived",
        origin: "bars",
        price: pivotPoint.price,
        anchor_time: pivotPoint.time,
        bar_start: pivotPoint.time,
        payload: {
          bar_range: range,
          price_padding: Math.max(
            range * 0.18,
            Math.abs(Number(pivotPoint.price)) * 0.00015,
          ),
          extension_bars: 3,
          swing_algo: "zigzag",
          pivot_strength: pivot,
        },
      });
    })
    .slice(-80);
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
        normalizeChartArtifactItem({
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
        }),
      );
    }
    if (left.low > right.high && isStrongDisplacementCandle(bars, index, "bearish")) {
      const gapSize = Number(left.low) - Number(right.high);
      const middleRange = candleRangeSize(mid);
      if (!isMeaningfulFvgGap(gapSize, middleRange)) continue;
      out.push(
        normalizeChartArtifactItem({
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
  const out = [];
  for (let index = 1; index < bars.length - 1; index += 1) {
    const mid = bars[index];
    const right = bars[index + 1];
    if (!mid || !right) continue;
    if (isStrongDisplacementCandle(bars, index, "bullish")) {
      const candidate = findLastOpposingCandle(bars, index, "bullish");
      if (candidate?.bar && Number(right.close) > Number(candidate.bar.high)) {
        out.push(
          normalizeChartArtifactItem({
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
          }),
        );
      }
    }
    if (isStrongDisplacementCandle(bars, index, "bearish")) {
      const candidate = findLastOpposingCandle(bars, index, "bearish");
      if (candidate?.bar && Number(right.close) < Number(candidate.bar.low)) {
        out.push(
          normalizeChartArtifactItem({
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
          }),
        );
      }
    }
  }
  return out.slice(-60);
}

function buildLiquidityItems(bars = [], timeframe = "", pivot = 5) {
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
        }),
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
        }),
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
        }),
      );
    }
  }
  return out.slice(-60);
}

function buildStructureBreakItems(bars = [], timeframe = "", pivot = 5) {
  const out = [];
  const effectivePivot = resolveAdaptiveStructurePivot(bars, pivot);
  const pivots = buildZigZagPivotPoints(bars, effectivePivot);
  if (!pivots.length) return out;
  let pivotIndex = 0;
  let lastHigh = null;
  let lastLow = null;
  let lastBreakBias = "";
  const consumed = new Set();
  const recentBarRanges = bars
    .slice(-40)
    .map((bar) => candleRangeSize(bar))
    .filter((value) => Number.isFinite(value) && value > 0);
  const tolerance = Math.max((medianNumber(recentBarRanges) || 1) * 0.02, 0.0000001);

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
      const isChoch = lastBreakBias === "bearish";
      consumed.add(`bos-high:${lastHigh.time}`);
      lastBreakBias = "bullish";
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
          },
        }),
      );
    }

    if (
      lastLow &&
      !consumed.has(`bos-low:${lastLow.time}`) &&
      Number(bar.close) < Number(lastLow.price) - tolerance
    ) {
      const isChoch = lastBreakBias === "bullish";
      consumed.add(`bos-low:${lastLow.time}`);
      lastBreakBias = "bearish";
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
          },
        }),
      );
    }
  }
  return out.slice(-80);
}

function buildPreviousDayLevelItems(bars = [], timeframe = "") {
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
      }),
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
      }),
    );
  }
  return out.slice(-20);
}

function buildSupportDemandLevelItems(bars = [], timeframe = "", pivot = 5) {
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
        }),
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
      }),
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

function shouldLimitArtifactType() {
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
      ...buildPreviousDayLevelItems(normalizedBars, timeframe),
      ...buildSupportDemandLevelItems(normalizedBars, timeframe),
      ...buildLiquidityItems(normalizedBars, timeframe),
      ...buildSweepItems(normalizedBars, timeframe),
      ...buildStructureBreakItems(normalizedBars, timeframe),
      ...buildFvgZoneItems(normalizedBars, timeframe),
      ...buildOrderBlockItems(normalizedBars, timeframe),
      ...buildCandlePatternItems(normalizedBars, timeframe),
    ]),
    normalizedBars,
  );
}

module.exports = {
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
