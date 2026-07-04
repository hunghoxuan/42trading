import InputComboSelect from "./InputComboSelect";

export const SHARED_TIMEZONE_OPTIONS = [
  { value: "Local", label: "Local" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "NewYork" },
  { value: "Asia/Ho_Chi_Minh", label: "Vietnam" },
];

export function resolveBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function normalizeTimezoneSelection(value, browserTimezone = resolveBrowserTimezone()) {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "local") return browserTimezone;
  return raw;
}

export function displayTimezoneSelection(value, browserTimezone = resolveBrowserTimezone()) {
  const normalized = normalizeTimezoneSelection(value, browserTimezone);
  if (
    normalized !== "UTC" &&
    normalized !== "America/New_York" &&
    normalized !== "Asia/Ho_Chi_Minh"
  ) {
    return "Local";
  }
  return normalized;
}

export default function TimezoneComboSelect({
  value,
  onChange,
  browserTimezone = resolveBrowserTimezone(),
  ...props
}) {
  const displayValue = displayTimezoneSelection(value, browserTimezone);
  return (
    <InputComboSelect
      {...props}
      value={displayValue}
      onChange={(event) => {
        const nextValue = String(event?.target?.value || "Local");
        const normalized = normalizeTimezoneSelection(nextValue, browserTimezone);
        onChange?.({
          ...event,
          target: {
            ...event.target,
            value: normalized,
          },
        });
      }}
    >
      {SHARED_TIMEZONE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </InputComboSelect>
  );
}
