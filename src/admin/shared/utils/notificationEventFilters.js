function buildSortedEvents(events = []) {
  return [...(Array.isArray(events) ? events : [])].sort((left, right) => {
    const leftLabel = String(left?.label || left?.event || "").toUpperCase();
    const rightLabel = String(right?.label || right?.event || "").toUpperCase();
    return leftLabel.localeCompare(rightLabel);
  });
}

function matchesEventSearch(event, searchText) {
  const query = String(searchText || "")
    .trim()
    .toLowerCase();
  if (!query) return true;
  const haystack = [
    event?.label,
    event?.event,
    event?.sound,
    event?.toast !== false ? "toast" : "",
    event?.console_log === true ? "console" : "",
    event?.ticker === true ? "ticker" : "",
    event?.db_log !== false ? "log" : "",
    event?.hub !== false ? "hub" : "",
    event?.telegram === true ? "telegram" : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function matchesEventFilter(event, filterValue) {
  switch (String(filterValue || "all")) {
    case "toast_on":
      return event?.toast !== false;
    case "console_on":
      return event?.console_log === true;
    case "ticker_on":
      return event?.ticker === true;
    case "log_on":
      return event?.db_log !== false;
    case "hub_on":
      return event?.hub !== false;
    case "telegram_on":
      return event?.telegram === true;
    case "sound_on":
      return Boolean(String(event?.sound || "").trim());
    case "muted":
      return !String(event?.sound || "").trim();
    case "all":
    default:
      return true;
  }
}

const EVENT_FILTERS = [
  { value: "all", label: "All events" },
  { value: "toast_on", label: "Toast on" },
  { value: "console_on", label: "Console on" },
  { value: "ticker_on", label: "Ticker on" },
  { value: "log_on", label: "Log on" },
  { value: "hub_on", label: "Hub on" },
  { value: "telegram_on", label: "Telegram on" },
  { value: "sound_on", label: "Sound set" },
  { value: "muted", label: "Muted" },
];

export {
  EVENT_FILTERS,
  buildSortedEvents,
  matchesEventFilter,
  matchesEventSearch,
};
