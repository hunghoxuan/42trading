export const PROFILE_PRESETS = {
  position: {
    label: "Position (w+d / 4h / 1h)",
    htf_tfs: ["w", "d"],
    exec_tfs: ["4h"],
    conf_tfs: ["1h"],
    sessions: "Any",
    rr: "3",
  },
  swing2: {
    label: "Swing2 (w+d / 4h / 15m)",
    htf_tfs: ["w", "d"],
    exec_tfs: ["4h"],
    conf_tfs: ["15m"],
    sessions: "Any",
    rr: "2.5",
  },
  swing: {
    label: "Swing (d+4h / 1h / 15m)",
    htf_tfs: ["d", "4h"],
    exec_tfs: ["1h"],
    conf_tfs: ["15m"],
    sessions: "Any",
    rr: "2",
  },
  daily2: {
    label: "Daily2 (d+4h / 1h / 5m)",
    htf_tfs: ["d", "4h"],
    exec_tfs: ["1h"],
    conf_tfs: ["5m"],
    sessions: "Any",
    rr: "1.75",
  },
  day: {
    label: "Daily (d+4h / 15m / 5m)",
    htf_tfs: ["d", "4h"],
    exec_tfs: ["15m"],
    conf_tfs: ["5m"],
    sessions: "Any",
    rr: "1.5",
  },
  scalping2: {
    label: "Scalping2 (4h / 15m / 1m)",
    htf_tfs: ["4h"],
    exec_tfs: ["15m"],
    conf_tfs: ["1m"],
    sessions: "Any",
    rr: "1.25",
  },
  scalper: {
    label: "Scalping (4h+1h / 5m / 1m)",
    htf_tfs: ["4h", "1h"],
    exec_tfs: ["5m"],
    conf_tfs: ["1m"],
    sessions: "Any",
    rr: "1",
  },
};

export const TIMEFRAME_PICKER_TF_OPTIONS = [
  { value: "w", label: "1w" },
  { value: "d", label: "1d" },
  { value: "4h", label: "4h" },
  { value: "1h", label: "1h" },
  { value: "15m", label: "15m" },
  { value: "5m", label: "5m" },
  { value: "1m", label: "1m" },
];

export const TIMEFRAME_PICKER_CUSTOM_PRESETS = [
  { value: "d|1h", label: "1d | 1h", tfs: ["d", "1h"] },
  { value: "4h|15m", label: "4h | 15m", tfs: ["4h", "15m"] },
  { value: "1h|5m", label: "1h | 5m", tfs: ["1h", "5m"] },
  { value: "15m|1m", label: "15m | 1m", tfs: ["15m", "1m"] },
];

export function buildProfilePresetTimeframes(preset = null) {
  return [
    ...(Array.isArray(preset?.htf_tfs) ? preset.htf_tfs : []),
    ...(Array.isArray(preset?.exec_tfs) ? preset.exec_tfs : []),
    ...(Array.isArray(preset?.conf_tfs) ? preset.conf_tfs : []),
  ];
}

export function normalizeTimeframeSelection(
  list = [],
  timeframeOptions = TIMEFRAME_PICKER_TF_OPTIONS,
) {
  const order = (Array.isArray(timeframeOptions) ? timeframeOptions : []).map(
    (option) => String(option?.value || "").trim().toLowerCase(),
  );
  const normalized = Array.isArray(list)
    ? list
        .map((item) =>
          String(item || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean)
    : [];
  const uniq = [...new Set(normalized)];
  return uniq.sort((a, b) => {
    const leftIndex = order.indexOf(a);
    const rightIndex = order.indexOf(b);
    const safeLeft = leftIndex >= 0 ? leftIndex : Number.MAX_SAFE_INTEGER;
    const safeRight = rightIndex >= 0 ? rightIndex : Number.MAX_SAFE_INTEGER;
    return safeLeft - safeRight;
  });
}

export function buildTimeframePickerPresetOptions() {
  return [
    ...Object.entries(PROFILE_PRESETS).map(([value, preset]) => ({
      value,
      label: preset.label,
      type: "profile",
      tfs: buildProfilePresetTimeframes(preset),
    })),
    ...TIMEFRAME_PICKER_CUSTOM_PRESETS.map((preset) => ({
      ...preset,
      type: "tfs",
    })),
  ];
}

export const SHARED_TIMEFRAME_PRESET_OPTIONS =
  buildTimeframePickerPresetOptions();

export const PROFILE_PRESET_SELECT_OPTIONS = Object.entries(PROFILE_PRESETS).map(
  ([value, preset]) => ({
    value,
    label: preset.label,
  }),
);

export const DEFAULT_ANALYZE_BROWSER_TFS = normalizeTimeframeSelection(
  buildProfilePresetTimeframes(PROFILE_PRESETS.day),
);

export function findMatchingTimeframePreset(
  selectedTfs = [],
  presetOptions = SHARED_TIMEFRAME_PRESET_OPTIONS,
  timeframeOptions = TIMEFRAME_PICKER_TF_OPTIONS,
) {
  const selectedKey = normalizeTimeframeSelection(
    selectedTfs,
    timeframeOptions,
  ).join("|");
  if (!selectedKey) return null;
  return (
    (Array.isArray(presetOptions) ? presetOptions : []).find((preset) => {
      const presetKey = normalizeTimeframeSelection(
        Array.isArray(preset?.tfs) ? preset.tfs : [],
        timeframeOptions,
      ).join("|");
      return presetKey && presetKey === selectedKey;
    }) || null
  );
}

export function buildTimeframeSummaryLabel(
  selectedTfs = [],
  presetOptions = SHARED_TIMEFRAME_PRESET_OPTIONS,
  timeframeOptions = TIMEFRAME_PICKER_TF_OPTIONS,
  emptyLabel = "Select TFs",
) {
  const matchedPreset = findMatchingTimeframePreset(
    selectedTfs,
    presetOptions,
    timeframeOptions,
  );
  if (matchedPreset?.label) return matchedPreset.label;
  const normalized = normalizeTimeframeSelection(selectedTfs, timeframeOptions);
  const labels = normalized.map((tf) => {
    const match = (Array.isArray(timeframeOptions) ? timeframeOptions : []).find(
      (option) =>
        String(option?.value || "")
          .trim()
          .toLowerCase() === tf,
    );
    return match?.label || tf;
  });
  return labels.length ? labels.join(" / ") : emptyLabel;
}
