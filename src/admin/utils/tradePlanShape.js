export function isCurrentAiTradePlan(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.execution_plan &&
      typeof value.execution_plan === "object" &&
      (value.direction ||
        value.symbol ||
        value.risk_management ||
        value.analysis),
  );
}
