import ruleVariablesConfig from "../../../config/ruleVariables.json";

function normalizeValue(value = "") {
  return String(value || "").trim();
}

function dedupeValues(values = []) {
  const seen = new Set();
  const out = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = normalizeValue(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

export const STATIC_RULE_VARIABLE_VALUES = dedupeValues(
  Array.isArray(ruleVariablesConfig?.base) ? ruleVariablesConfig.base : [],
);

export const STATIC_RULE_VARIABLE_OPTIONS = STATIC_RULE_VARIABLE_VALUES.map((value) => ({
  value,
  label: value,
}));

export function buildRuleVariableValues({
  indicators = [],
  params = {},
  risk = {},
  extra = [],
} = {}) {
  const indicatorIds = Array.isArray(indicators)
    ? indicators.map((item) => normalizeValue(item?.id)).filter(Boolean)
    : [];
  const paramKeys =
    params && typeof params === "object" && !Array.isArray(params)
      ? Object.keys(params).map((key) => normalizeValue(key)).filter(Boolean)
      : [];
  const riskKeys =
    risk && typeof risk === "object" && !Array.isArray(risk)
      ? Object.keys(risk).map((key) => normalizeValue(key)).filter(Boolean)
      : [];

  return dedupeValues([
    ...STATIC_RULE_VARIABLE_VALUES,
    ...indicatorIds.map((id) => `indicators.${id}`),
    ...indicatorIds.map((id) => `prev_indicators.${id}`),
    ...paramKeys.map((key) => `params.${key}`),
    ...riskKeys.map((key) => `risk.${key}`),
    ...(Array.isArray(extra) ? extra : []),
  ]);
}

export function buildRuleVariableOptions(args = {}) {
  return buildRuleVariableValues(args).map((value) => ({
    value,
    label: value,
  }));
}
