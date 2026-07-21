function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeStatus(value, fallback = "info") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "error" || raw === "fail" || raw === "failed") return "error";
  if (raw === "warn" || raw === "warning" || raw === "skip" || raw === "skipped")
    return "warn";
  if (raw === "info" || raw === "ok" || raw === "success") return "info";
  if (raw === "running") return "running";
  return fallback;
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [value].filter(Boolean);
}

function normalizeErrors(input) {
  if (Array.isArray(input)) {
    return input
      .map((item) => {
        if (!item) return null;
        if (typeof item === "string") return { code: "error", message: item };
        if (typeof item === "object") {
          return {
            code: String(item.code || item.error_code || item.type || "error").trim(),
            message: String(
              item.message || item.error || item.detail || item.reason || "",
            ).trim(),
            scope:
              item.scope !== undefined && item.scope !== null
                ? String(item.scope).trim()
                : undefined,
            context:
              item.context && typeof item.context === "object" ? item.context : undefined,
          };
        }
        return { code: "error", message: String(item) };
      })
      .filter((item) => item && item.message);
  }
  const text = String(input || "").trim();
  return text ? [{ code: "error", message: text }] : [];
}

function pickIds(payload, keys = []) {
  for (const key of keys) {
    const values = toArray(payload?.[key]).map((item) => String(item || "").trim()).filter(Boolean);
    if (values.length) return values;
  }
  return [];
}

function inferProcessed(payload = {}) {
  if (payload.processed !== undefined) return Math.max(0, asNumber(payload.processed, 0));
  if (payload.triggered !== undefined) return Math.max(0, asNumber(payload.triggered, 0));
  if (payload.total !== undefined) return Math.max(0, asNumber(payload.total, 0));
  if (payload.count !== undefined) return Math.max(0, asNumber(payload.count, 0));
  if (Array.isArray(payload.items)) return payload.items.length;
  if (Array.isArray(payload.results)) return payload.results.length;
  if (Array.isArray(payload.files)) return payload.files.length;
  if (Array.isArray(payload.symbols)) return payload.symbols.length;
  if (payload.trade && typeof payload.trade === "object") return 1;
  if (payload.item && typeof payload.item === "object") return 1;
  return 0;
}

function buildDefaultMessage(result) {
  const parts = [];
  if (result.processed > 0) parts.push(`processed ${result.processed}`);
  if (result.created > 0) parts.push(`created ${result.created}`);
  if (result.updated > 0) parts.push(`updated ${result.updated}`);
  if (result.deleted > 0) parts.push(`deleted ${result.deleted}`);
  if (result.skipped > 0) parts.push(`skipped ${result.skipped}`);
  if (!parts.length) {
    return result.status === "error"
      ? "Request failed"
      : result.status === "warn"
        ? "Completed with no changes"
        : result.status === "running"
          ? "Running"
          : "Completed";
  }
  return parts.join(", ");
}

function inferStatus(base, okValue = true) {
  if (base.errors.length || okValue === false) return "error";
  if (
    base.created > 0 ||
    base.updated > 0 ||
    base.deleted > 0 ||
    base.created_ids.length > 0 ||
    base.updated_ids.length > 0 ||
    base.deleted_ids.length > 0 ||
    base.affected_ids.length > 0
  ) {
    return "info";
  }
  if (base.processed > 0 || base.skipped > 0) return "warn";
  return "warn";
}

export function normalizeActivityResult(payload = {}, options = {}) {
  const source =
    payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const resultInput =
    source.result && typeof source.result === "object" ? source.result : {};
  const createdIds = pickIds(source, ["created_ids", "createdIds"]);
  const updatedIds = pickIds(source, ["updated_ids", "updatedIds"]);
  const deletedIds = pickIds(source, ["deleted_ids", "deletedIds"]);
  const affectedIds = pickIds(source, ["affected_ids", "affectedIds", "ids"]);
  const errors = normalizeErrors(resultInput.errors ?? source.errors ?? source.error);
  const processed = Math.max(
    0,
    asNumber(resultInput.processed, inferProcessed(source)),
  );
  const created = Math.max(
    0,
    asNumber(
      resultInput.created,
      source.created ??
        source.created_trades ??
        (createdIds.length ? createdIds.length : 0),
    ),
  );
  const updated = Math.max(
    0,
    asNumber(resultInput.updated, source.updated ?? (updatedIds.length ? updatedIds.length : 0)),
  );
  const deleted = Math.max(
    0,
    asNumber(
      resultInput.deleted,
      source.deleted ??
        source.deleted_files ??
        source.logs_deleted ??
        (deletedIds.length ? deletedIds.length : 0),
    ),
  );
  let skipped = Math.max(
    0,
    asNumber(resultInput.skipped, source.skipped ?? 0),
  );
  if (skipped === 0 && processed > 0) {
    skipped = Math.max(0, processed - created - updated - deleted);
  }
  const status = normalizeStatus(
    resultInput.status || source.status || source.level,
    inferStatus(
      {
        processed,
        created,
        updated,
        deleted,
        skipped,
        created_ids: createdIds,
        updated_ids: updatedIds,
        deleted_ids: deletedIds,
        affected_ids: affectedIds,
        errors,
      },
      source?.ok !== false && options.ok !== false,
    ),
  );
  const message = String(
    resultInput.message || source.message || source.error || "",
  ).trim() || buildDefaultMessage({
    status,
    processed,
    created,
    updated,
    deleted,
    skipped,
  });
  return {
    status,
    message,
    processed,
    created,
    updated,
    deleted,
    skipped,
    created_ids: createdIds,
    updated_ids: updatedIds,
    deleted_ids: deletedIds,
    affected_ids: affectedIds,
    errors,
  };
}

export function resultStatusToToastType(status = "") {
  const normalized = normalizeStatus(status, "info");
  if (normalized === "error") return "error";
  if (normalized === "warn") return "warning";
  return "info";
}
