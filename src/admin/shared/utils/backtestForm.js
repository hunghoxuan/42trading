function normalizeRunLimit(value, fallback = "3000") {
  if (value === 0) return "all";
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return String(Math.round(num));
  return String(fallback || "300");
}

function normalizeDirection(value, fallback = "all") {
  const normalized = String(value || fallback || "all").trim().toLowerCase();
  if (["buy", "sell", "all"].includes(normalized)) return normalized;
  if (normalized === "long") return "buy";
  if (normalized === "short") return "sell";
  return String(fallback || "all").trim().toLowerCase() || "all";
}

function normalizeSession(value, fallback = "Any") {
  const normalized = String(value || "").trim();
  if (!normalized) return String(fallback || "Any");
  const aliases = {
    any: "Any",
    london: "London",
    "new york": "New York",
    newyork: "New York",
    ny: "New York",
    asian: "Asian",
    asia: "Asian",
    "london+ny": "London+NY",
    "london + ny": "London+NY",
  };
  return aliases[normalized.toLowerCase()] || normalized;
}

export function deriveBacktestFormFromRun(run = {}, currentForm = {}) {
  const nextForm = {
    ...currentForm,
  };

  if (run?.symbol) nextForm.symbol = String(run.symbol).trim().toUpperCase();
  if (run?.tf) nextForm.tf = String(run.tf).trim();
  nextForm.limit = normalizeRunLimit(run?.limit, currentForm?.limit || "3000");
  nextForm.limit_mode = "bars";
  nextForm.limit_bars_value = nextForm.limit;
  nextForm.tfs = nextForm.tf ? [nextForm.tf] : currentForm?.tfs || [];

  const nextStrategyKey = String(
    run?.strategy_key || run?.strategy_id || currentForm?.strategy_key || "",
  ).trim();
  if (nextStrategyKey) {
    nextForm.strategy_key = nextStrategyKey;
    nextForm.strategy_keys = [nextStrategyKey];
  }
  nextForm.direction = normalizeDirection(
    run?.direction ?? run?.execution_options?.direction,
    currentForm?.direction || "all",
  );
  nextForm.session = normalizeSession(
    run?.session ?? run?.execution_options?.session,
    currentForm?.session || "Any",
  );
  if (run?.one_r_value !== undefined || run?.execution_options?.one_r_value !== undefined) {
    nextForm.one_r_value = String(
      run?.one_r_value ?? run?.execution_options?.one_r_value ?? currentForm?.one_r_value ?? "100",
    );
  }

  return nextForm;
}
