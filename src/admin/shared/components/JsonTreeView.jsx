import "./JsonTreeView.css";

function isPlainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function humanizeKey(key) {
  return String(key || "")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function primitiveLabel(value) {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return String(value);
}

function primitiveTone(value) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return "neutral";
  if (
    [
      "true",
      "yes",
      "ok",
      "pass",
      "passed",
      "success",
      "safe",
      "valid",
      "active",
      "buy",
      "bullish",
      "long",
      "high",
    ].some((token) => raw.includes(token))
  ) {
    return "good";
  }
  if (
    [
      "false",
      "no",
      "fail",
      "failed",
      "error",
      "invalid",
      "reject",
      "rejected",
      "danger",
      "bearish",
      "short",
      "low",
    ].some((token) => raw.includes(token))
  ) {
    return "bad";
  }
  if (
    ["warn", "warning", "pending", "review", "medium", "caution", "wait"].some(
      (token) => raw.includes(token),
    )
  ) {
    return "warn";
  }
  return "neutral";
}

function stringifyValue(value) {
  if (value == null || value === "") return "-";
  if (typeof value !== "object") return primitiveLabel(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function ObjectLeaf({ name, value }) {
  const isPrimitive =
    value == null || typeof value !== "object" || value instanceof Date;
  if (isPrimitive) {
    const label = primitiveLabel(value);
    const usePill = label.length < 10;
    return (
      <div className="json-tree-view__field">
        <div className="json-tree-view__label">{humanizeKey(name)}</div>
        {usePill ? (
          <div
            className={[
              "json-tree-view__pill",
              `json-tree-view__pill--${primitiveTone(value)}`,
            ].join(" ")}
          >
            {label}
          </div>
        ) : (
          <div className="json-tree-view__text-value">{label}</div>
        )}
      </div>
    );
  }

  return (
    <div className="json-tree-view__field json-tree-view__field--wide">
      <div className="json-tree-view__label">{humanizeKey(name)}</div>
      <div className="json-tree-view__inline-json">{stringifyValue(value)}</div>
    </div>
  );
}

function JsonArray({ name, value, depth, maxDepth }) {
  if (!value.length) {
    return <ObjectLeaf name={name} value="[]" />;
  }
  const primitiveArray = value.every((item) => item == null || typeof item !== "object");
  if (primitiveArray) {
    return (
      <div className="json-tree-view__section">
        <div className="json-tree-view__section-title">{humanizeKey(name)}</div>
        <div className="json-tree-view__pill-row">
          {value.map((item, index) => (
            primitiveLabel(item).length < 10 ? (
              <span
                key={`${name}-${index}`}
                className={[
                  "json-tree-view__pill",
                  `json-tree-view__pill--${primitiveTone(item)}`,
                ].join(" ")}
              >
                {primitiveLabel(item)}
              </span>
            ) : (
              <span key={`${name}-${index}`} className="json-tree-view__text-chip">
                {primitiveLabel(item)}
              </span>
            )
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="json-tree-view__section">
      <div className="json-tree-view__section-title">{humanizeKey(name)}</div>
      <div className="json-tree-view__array">
        {value.map((item, index) => (
          <div key={`${name}-${index}`} className="json-tree-view__array-item">
            <JsonNode
              name={`Item ${index + 1}`}
              value={item}
              depth={depth + 1}
              maxDepth={maxDepth}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function JsonObject({ name, value, depth, maxDepth }) {
  const entries = Object.entries(value || {}).filter(([, child]) => {
    if (child == null || child === "") return false;
    if (Array.isArray(child)) return child.length > 0;
    if (isPlainObject(child)) return Object.keys(child).length > 0;
    return true;
  });

  if (!entries.length) return <ObjectLeaf name={name} value="{}" />;

  const primitiveEntries = [];
  const nestedEntries = [];
  for (const entry of entries) {
    const [, child] = entry;
    if (child == null || typeof child !== "object") primitiveEntries.push(entry);
    else nestedEntries.push(entry);
  }

  return (
    <div className={depth === 0 ? "json-tree-view__root" : "json-tree-view__section"}>
      {name ? (
        <div className="json-tree-view__section-title">{humanizeKey(name)}</div>
      ) : null}
      {primitiveEntries.length ? (
        <div className="json-tree-view__grid">
          {primitiveEntries.map(([key, child]) => (
            <ObjectLeaf key={key} name={key} value={child} />
          ))}
        </div>
      ) : null}
      {nestedEntries.map(([key, child]) => (
        <JsonNode
          key={key}
          name={key}
          value={child}
          depth={depth + 1}
          maxDepth={maxDepth}
        />
      ))}
    </div>
  );
}

function JsonNode({ name = "", value, depth = 0, maxDepth = 6 }) {
  if (depth >= maxDepth) return <ObjectLeaf name={name} value={value} />;
  if (Array.isArray(value)) {
    return <JsonArray name={name} value={value} depth={depth} maxDepth={maxDepth} />;
  }
  if (isPlainObject(value)) {
    return <JsonObject name={name} value={value} depth={depth} maxDepth={maxDepth} />;
  }
  return <ObjectLeaf name={name} value={value} />;
}

export default function JsonTreeView({
  value,
  title = "",
  maxDepth = 6,
  className = "",
}) {
  return (
    <div className={["json-tree-view", className].filter(Boolean).join(" ")}>
      {title ? <div className="json-tree-view__title">{title}</div> : null}
      <JsonNode value={value} depth={0} maxDepth={maxDepth} />
    </div>
  );
}
