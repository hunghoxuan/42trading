"use strict";

let persistentLogWritesEnabled = false;

function normalizeLogWriteSetting(value) {
  const raw =
    value && typeof value === "object"
      ? value.enabled ?? value.value ?? value.write_logs
      : value;
  return ["1", "true", "yes", "on", "enabled"].includes(
    String(raw ?? "")
      .trim()
      .toLowerCase(),
  );
}

function setPersistentLogWritesEnabled(value) {
  persistentLogWritesEnabled = normalizeLogWriteSetting(value);
  return persistentLogWritesEnabled;
}

function isPersistentLogWritesEnabled() {
  return persistentLogWritesEnabled;
}

module.exports = {
  isPersistentLogWritesEnabled,
  normalizeLogWriteSetting,
  setPersistentLogWritesEnabled,
};
