function formatPrimitive(value) {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "symbol") return value.description || String(value);
  return String(value);
}

function walkDisplayValue(value, path, output, seen, limit) {
  if (output.length >= limit) return;
  if (value === null || value === undefined) {
    if (path) output.push(`${path} - ${formatPrimitive(value)}`);
    return;
  }
  if (typeof value !== "object") {
    output.push(path ? `${path} - ${formatPrimitive(value)}` : formatPrimitive(value));
    return;
  }
  if (seen.has(value)) {
    output.push(path ? `${path} - [circular]` : "[circular]");
    return;
  }

  seen.add(value);
  if (Array.isArray(value)) {
    if (!value.length) {
      output.push(path ? `${path} - []` : "[]");
    } else {
      value.forEach((item, index) => {
        walkDisplayValue(item, path ? `${path}[${index}]` : `[${index}]`, output, seen, limit);
      });
    }
    seen.delete(value);
    return;
  }

  const entries = Object.entries(value);
  if (!entries.length) {
    output.push(path ? `${path} - {}` : "{}");
    seen.delete(value);
    return;
  }
  entries.forEach(([key, child]) => {
    const nextPath = path ? `${path}.${key}` : key;
    walkDisplayValue(child, nextPath, output, seen, limit);
  });
  seen.delete(value);
}

export function formatDisplayValue(value, { maxEntries = 12 } = {}) {
  if (value === null || value === undefined) return formatPrimitive(value);
  if (typeof value !== "object") return formatPrimitive(value);
  const output = [];
  walkDisplayValue(value, "", output, new Set(), Math.max(1, Number(maxEntries) || 12));
  if (!output.length) return "";
  if (output.length > maxEntries) {
    return `${output.slice(0, maxEntries).join(", ")}, ...`;
  }
  return output.join(", ");
}
