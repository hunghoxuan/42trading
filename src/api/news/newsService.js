"use strict";

const SOURCE_TIME_ZONE = "America/New_York";
const DEFAULT_SOURCE_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const DEFAULT_BEFORE_MINUTES = 30;
const DEFAULT_DURING_MINUTES = 90;

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeSymbolList(values) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map(normalizeSymbol).filter(Boolean))];
}

function normalizeNewsTypeName(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeEffectiveDuration(
  value,
  fallbackBeforeMinutes = DEFAULT_BEFORE_MINUTES,
  fallbackDuringMinutes = DEFAULT_DURING_MINUTES,
) {
  if (Number.isFinite(Number(value))) {
    const mins = Math.max(0, Math.round(Number(value)));
    return {
      before_minutes: mins,
      during_minutes: mins,
    };
  }

  const raw = value && typeof value === "object" ? value : {};
  const beforeMinutes = Math.max(
    0,
    Math.round(Number(raw.before_minutes ?? fallbackBeforeMinutes) || 0),
  );
  const duringMinutes = Math.max(
    0,
    Math.round(Number(raw.during_minutes ?? fallbackDuringMinutes) || 0),
  );
  return {
    before_minutes: beforeMinutes,
    during_minutes: duringMinutes,
  };
}

function normalizeEffectiveSymbols(value) {
  if (Array.isArray(value)) {
    return { ALL: normalizeSymbolList(value) };
  }

  const raw = value && typeof value === "object" ? value : {};
  const entries = Object.entries(raw).map(([currency, symbols]) => [
    normalizeNewsTypeName(currency),
    normalizeSymbolList(symbols),
  ]);
  const normalized = Object.fromEntries(entries.filter(([key]) => key));
  return Object.keys(normalized).length ? normalized : { ALL: [] };
}

function normalizeNewsTypeConfig(
  raw,
  fallbackBeforeMinutes = DEFAULT_BEFORE_MINUTES,
  fallbackDuringMinutes = DEFAULT_DURING_MINUTES,
) {
  const newsType = normalizeNewsTypeName(raw?.news_type);
  if (!newsType) return null;
  const aliases = [
    newsType,
    ...(Array.isArray(raw?.aliases) ? raw.aliases : []),
    ...(Array.isArray(raw?.keywords) ? raw.keywords : []),
  ]
    .map(normalizeNewsTypeName)
    .filter(Boolean);
  return {
    news_type: newsType,
    aliases: [...new Set(aliases)],
    score: Math.max(0, Math.round(Number(raw?.score) || 0)),
    effective_symbols: normalizeEffectiveSymbols(raw?.effective_symbols),
    impact_rules:
      raw?.impact_rules && typeof raw.impact_rules === "object"
        ? raw.impact_rules
        : null,
    effective_duration: normalizeEffectiveDuration(
      raw?.effective_duration,
      fallbackBeforeMinutes,
      fallbackDuringMinutes,
    ),
  };
}

function normalizeNewsConfig(appConfig = {}) {
  const newsRoot =
    appConfig && typeof appConfig.news === "object" ? appConfig.news : {};
  const fallbackBeforeMinutes = Math.max(
    0,
    Math.round(Number(newsRoot.default_before_minutes) || DEFAULT_BEFORE_MINUTES),
  );
  const fallbackDuringMinutes = Math.max(
    0,
    Math.round(Number(newsRoot.default_during_minutes) || DEFAULT_DURING_MINUTES),
  );

  const types = (Array.isArray(newsRoot.types) ? newsRoot.types : [])
    .map((entry) =>
      normalizeNewsTypeConfig(
        entry,
        fallbackBeforeMinutes,
        fallbackDuringMinutes,
      ),
    )
    .filter(Boolean);

  return {
    source_url: String(newsRoot.source_url || DEFAULT_SOURCE_URL).trim(),
    source_timezone: String(newsRoot.source_timezone || SOURCE_TIME_ZONE).trim(),
    default_before_minutes: fallbackBeforeMinutes,
    default_during_minutes: fallbackDuringMinutes,
    types,
  };
}

function parseForexFactoryDate(dateValue) {
  const raw = String(dateValue || "").trim();
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  return {
    year: Number(yyyy),
    month: Number(mm),
    day: Number(dd),
  };
}

function parseForexFactoryTime(timeValue) {
  const raw = String(timeValue || "").trim().toLowerCase();
  const match = raw.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridian = match[3];
  if (meridian === "pm" && hour < 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function getTimeZoneOffsetMillis(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const utcLike = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return utcLike - date.getTime();
}

function zonedDateTimeToUtcMs(parts, timeZone = SOURCE_TIME_ZONE) {
  const baseUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0,
    0,
  );
  let guess = baseUtc;
  for (let i = 0; i < 2; i += 1) {
    const offset = getTimeZoneOffsetMillis(new Date(guess), timeZone);
    guess = baseUtc - offset;
  }
  return guess;
}

function parseForexFactoryTimestamp(
  dateValue,
  timeValue,
  timeZone = SOURCE_TIME_ZONE,
) {
  const isoLike = String(dateValue || "").trim();
  if (isoLike) {
    const directTs = Date.parse(isoLike);
    if (Number.isFinite(directTs) && /t/i.test(isoLike)) {
      return directTs;
    }
  }

  const dateParts = parseForexFactoryDate(dateValue);
  const timeParts = parseForexFactoryTime(timeValue);
  if (!dateParts || !timeParts) return null;
  return zonedDateTimeToUtcMs(
    {
      ...dateParts,
      ...timeParts,
      second: 0,
    },
    timeZone,
  );
}

function formatDateKeyInTimeZone(value, timeZone = SOURCE_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function findMatchingNewsType(eventTitle, normalizedConfig) {
  const haystack = normalizeNewsTypeName(eventTitle);
  if (!haystack) return null;
  return normalizedConfig.types.find((entry) =>
    entry.aliases.some((alias) => alias && haystack.includes(alias)),
  );
}

function resolveEffectiveSymbols(newsTypeConfig, currency) {
  const map =
    newsTypeConfig && typeof newsTypeConfig.effective_symbols === "object"
      ? newsTypeConfig.effective_symbols
      : {};
  const exact = normalizeNewsTypeName(currency);
  if (exact && Array.isArray(map[exact]) && map[exact].length) {
    return normalizeSymbolList(map[exact]);
  }
  return normalizeSymbolList(map.ALL || []);
}

function summarizeImpactRules(newsTypeConfig) {
  const rules = Array.isArray(newsTypeConfig?.impact_rules?.rules)
    ? newsTypeConfig.impact_rules.rules
    : [];
  const reasons = [];
  const seen = new Set();
  for (const rule of rules) {
    const text = String(rule?.reason || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    reasons.push(text);
    if (reasons.length >= 3) break;
  }
  return reasons;
}

function buildTrackedNewsEvent(
  rawEvent,
  normalizedConfig,
  now = Date.now(),
) {
  const match = findMatchingNewsType(rawEvent?.title, normalizedConfig);
  if (!match) return null;

  const startTs = parseForexFactoryTimestamp(
    rawEvent?.date,
    rawEvent?.time,
    normalizedConfig.source_timezone,
  );
  if (!Number.isFinite(startTs)) return null;

  const currency = normalizeNewsTypeName(rawEvent?.currency || rawEvent?.country);
  const effectiveSymbols = resolveEffectiveSymbols(match, currency);
  const scenarioSummary = summarizeImpactRules(match);
  const beforeMinutes = match.effective_duration.before_minutes;
  const duringMinutes = match.effective_duration.during_minutes;
  const notifyFromTs = startTs - beforeMinutes * 60 * 1000;
  const endTs = startTs + duringMinutes * 60 * 1000;
  const nowTs = Number(now) || Date.now();
  const phase = getNewsEventPhase(
    {
      notify_from_ts: notifyFromTs,
      start_ts: startTs,
      end_ts: endTs,
    },
    nowTs,
  );

  return hydrateNewsEventTiming({
    id: [
      match.news_type,
      currency || "GLOBAL",
      String(rawEvent?.date || "").trim(),
      String(rawEvent?.time || "").trim().toLowerCase(),
      String(rawEvent?.title || "").trim(),
    ].join("::"),
    title: String(rawEvent?.title || "").trim(),
    impact: String(rawEvent?.impact || "").trim() || "High",
    currency,
    country: String(rawEvent?.country || "").trim(),
    time: String(rawEvent?.time || "").trim(),
    date: String(rawEvent?.date || "").trim(),
    actual: rawEvent?.actual ?? null,
    forecast: rawEvent?.forecast ?? null,
    previous: rawEvent?.previous ?? null,
    score: match.score,
    news_type: match.news_type,
    effective_symbols: effectiveSymbols,
    scenario_summary: scenarioSummary,
    effective_duration: {
      before_minutes: beforeMinutes,
      during_minutes: duringMinutes,
    },
    notify_from_ts: notifyFromTs,
    start_ts: startTs,
    end_ts: endTs,
    notify_from_at: new Date(notifyFromTs).toISOString(),
    start_at: new Date(startTs).toISOString(),
    end_at: new Date(endTs).toISOString(),
  }, nowTs);
}

function getNewsEventPhase(event, now = Date.now()) {
  const nowTs = Number(now) || Date.now();
  const notifyFromTs = Number(event?.notify_from_ts);
  const startTs = Number(event?.start_ts);
  const endTs = Number(event?.end_ts);
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return "unknown";
  if (Number.isFinite(notifyFromTs) && nowTs >= notifyFromTs && nowTs < startTs) {
    return "before";
  }
  if (nowTs >= startTs && nowTs < endTs) {
    return "during";
  }
  if (nowTs < startTs) {
    return "upcoming";
  }
  return "done";
}

function hydrateNewsEventTiming(event, now = Date.now()) {
  const nowTs = Number(now) || Date.now();
  const startTs = Number(event?.start_ts);
  const endTs = Number(event?.end_ts);
  const phase = getNewsEventPhase(event, nowTs);
  return {
    ...event,
    phase,
    is_active: phase === "before" || phase === "during",
    minutes_until_start: Number.isFinite(startTs)
      ? Math.round((startTs - nowTs) / 60000)
      : null,
    minutes_until_end: Number.isFinite(endTs)
      ? Math.round((endTs - nowTs) / 60000)
      : null,
  };
}

function filterNewsEventsForDate(
  events,
  targetDateKey,
  timeZone = SOURCE_TIME_ZONE,
) {
  return (Array.isArray(events) ? events : []).filter((event) => {
    const startTs = Number(event?.start_ts);
    return (
      Number.isFinite(startTs) &&
      formatDateKeyInTimeZone(startTs, timeZone) === targetDateKey
    );
  });
}

function buildTrackedNewsEvents(rawEvents, appConfig = {}, now = Date.now()) {
  const normalizedConfig = normalizeNewsConfig(appConfig);
  const targetDateKey = formatDateKeyInTimeZone(now, normalizedConfig.source_timezone);
  const items = (Array.isArray(rawEvents) ? rawEvents : [])
    .map((item) => buildTrackedNewsEvent(item, normalizedConfig, now))
    .filter(Boolean)
    .sort((a, b) => a.start_ts - b.start_ts);
  return filterNewsEventsForDate(
    items,
    targetDateKey,
    normalizedConfig.source_timezone,
  );
}

function collectEffectiveSymbolsForPhase(events, now = Date.now()) {
  const symbols = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    const phase = getNewsEventPhase(event, now);
    if (phase !== "before" && phase !== "during") continue;
    for (const symbol of event.effective_symbols || []) {
      const normalized = normalizeSymbol(symbol);
      if (normalized) symbols.add(normalized);
    }
  }
  return [...symbols].sort((a, b) => a.localeCompare(b));
}

module.exports = {
  DEFAULT_BEFORE_MINUTES,
  DEFAULT_DURING_MINUTES,
  DEFAULT_SOURCE_URL,
  SOURCE_TIME_ZONE,
  normalizeNewsConfig,
  normalizeNewsTypeName,
  normalizeEffectiveDuration,
  normalizeEffectiveSymbols,
  parseForexFactoryTimestamp,
  formatDateKeyInTimeZone,
  getNewsEventPhase,
  buildTrackedNewsEvent,
  buildTrackedNewsEvents,
  collectEffectiveSymbolsForPhase,
  hydrateNewsEventTiming,
};
