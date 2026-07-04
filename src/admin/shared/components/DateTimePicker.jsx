function pad(value) {
  return String(value).padStart(2, "0");
}

function normalizePickerMode(mode = "datetime") {
  const raw = String(mode || "datetime").trim().toLowerCase();
  if (raw === "date" || raw === "time") return raw;
  return "datetime";
}

function inputTypeForMode(mode = "datetime") {
  const normalized = normalizePickerMode(mode);
  if (normalized === "date") return "date";
  if (normalized === "time") return "time";
  return "datetime-local";
}

function formatDateValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const exactMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (exactMatch) return exactMatch[0];
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return "";
  return new Date(time).toISOString().slice(0, 10);
}

function formatTimeValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const exactMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (exactMatch) {
    return `${pad(Number(exactMatch[1]))}:${pad(Number(exactMatch[2]))}`;
  }
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTimeValue(value = "") {
  const time = new Date(value || "").getTime();
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function formatDateTimePickerValue(value = "", mode = "datetime") {
  const normalizedMode = normalizePickerMode(mode);
  if (normalizedMode === "date") return formatDateValue(value);
  if (normalizedMode === "time") return formatTimeValue(value);
  return formatDateTimeValue(value);
}

function normalizeDateValue(value = "") {
  return formatDateValue(value);
}

function normalizeTimeValue(value = "") {
  return formatTimeValue(value);
}

function normalizeDateTimeValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return "";
  return new Date(time).toISOString();
}

export function normalizeDateTimePickerValue(value = "", mode = "datetime") {
  const normalizedMode = normalizePickerMode(mode);
  if (normalizedMode === "date") return normalizeDateValue(value);
  if (normalizedMode === "time") return normalizeTimeValue(value);
  return normalizeDateTimeValue(value);
}

export default function DateTimePicker({
  mode = "datetime",
  value = "",
  onChange,
  onValueChange,
  min,
  max,
  className,
  ...props
}) {
  const normalizedMode = normalizePickerMode(mode);
  const displayValue = formatDateTimePickerValue(value, normalizedMode);
  const displayMin = formatDateTimePickerValue(min, normalizedMode);
  const displayMax = formatDateTimePickerValue(max, normalizedMode);

  return (
    <input
      {...props}
      type={inputTypeForMode(normalizedMode)}
      className={className}
      value={displayValue}
      min={displayMin || undefined}
      max={displayMax || undefined}
      onChange={(event) => {
        const normalizedValue = normalizeDateTimePickerValue(
          event?.target?.value,
          normalizedMode,
        );
        const patchedEvent = {
          ...event,
          target: {
            ...event.target,
            value: normalizedValue,
          },
          currentTarget: {
            ...event.currentTarget,
            value: normalizedValue,
          },
        };
        onChange?.(patchedEvent);
        onValueChange?.(normalizedValue, patchedEvent);
      }}
    />
  );
}
