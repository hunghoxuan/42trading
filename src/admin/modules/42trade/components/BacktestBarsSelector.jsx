import { useEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import TabBar from "../../../shared/components/TabBar";
import DateTimePicker from "../../../shared/components/DateTimePicker";
import {
  BACKTEST_TIME_RANGE_PRESETS,
  resolveTimeRangeSelection,
} from "../../../shared/utils/backtestBarsRange.js";

const MODE_OPTIONS = [
  { value: "bars", label: "By bars" },
  { value: "time_range", label: "By time range" },
];

function barsOptionLabel(options = [], value = "") {
  return (
    options.find((option) => String(option?.value || "") === String(value || ""))?.label ||
    "Select..."
  );
}

function formatDateLabel(value = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "";
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function timeRangeSummary({ preset = "", startDate = "", endDate = "", computedBars = "" }) {
  const presetLabel =
    BACKTEST_TIME_RANGE_PRESETS.find((option) => option.value === preset)?.label || "";
  if (preset && preset !== "custom" && computedBars) {
    return `${presetLabel} · ${computedBars} bars`;
  }
  const startLabel = formatDateLabel(startDate);
  const endLabel = formatDateLabel(endDate);
  if (startLabel && endLabel && computedBars) {
    return `${startLabel} - ${endLabel} · ${computedBars} bars`;
  }
  if (computedBars) return `${computedBars} bars`;
  return "Select...";
}

function optionButtonStyle(active) {
  return {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "10px 12px",
    textAlign: "left",
    justifyContent: "space-between",
    background: active ? "rgba(34,211,238,0.12)" : "rgba(255,255,255,0.02)",
    color: active ? "var(--text)" : "var(--muted)",
    fontSize: 12,
    fontWeight: active ? 700 : 600,
    width: "100%",
  };
}

export default function BacktestBarsSelector({
  timeframe = "15",
  barsOptions = [],
  value = {},
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const [menuWidth, setMenuWidth] = useState(0);

  const mode = String(value?.limit_mode || "bars").trim() || "bars";
  const barsValue = String(value?.limit_bars_value || value?.limit || "3000").trim() || "3000";
  const preset = String(value?.limit_preset || "today").trim() || "today";
  const startDate = String(value?.limit_start_date || "").trim();
  const endDate = String(value?.limit_end_date || "").trim();
  const computedBars = mode === "time_range" ? String(value?.limit || "").trim() : "";

  useEffect(() => {
    const updateWidth = () => setMenuWidth(wrapperRef.current?.offsetWidth || 0);
    updateWidth();
    if (typeof window === "undefined") return undefined;
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  useEffect(() => {
    if (mode !== "time_range") return;
    const next = resolveTimeRangeSelection({
      mode,
      timeframe,
      preset,
      startDate,
      endDate,
    });
    if (
      next.limit === String(value?.limit || "") &&
      next.startDate === startDate &&
      next.endDate === endDate &&
      next.preset === preset
    ) {
      return;
    }
    onChange?.({
      limit: next.limit,
      limit_preset: next.preset,
      limit_start_date: next.startDate,
      limit_end_date: next.endDate,
    });
  }, [endDate, mode, onChange, preset, startDate, timeframe, value?.limit]);

  const triggerLabel = useMemo(() => {
    if (mode === "bars") return barsOptionLabel(barsOptions, barsValue);
    return timeRangeSummary({ preset, startDate, endDate, computedBars });
  }, [barsOptions, barsValue, computedBars, endDate, mode, preset, startDate]);

  return (
    <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
      <div
        ref={wrapperRef}
        style={{ width: "100%" }}
        data-component="BacktestBarsSelector"
      >
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="secondary-button combo-button-menu-trigger form-combo-select"
            style={{ width: "100%" }}
            aria-label="Bars selector"
            title={triggerLabel}
          >
            <span className="combo-button-menu-trigger__label">{triggerLabel}</span>
            <span aria-hidden="true" className="combo-button-menu-trigger__caret">
              ▾
            </span>
          </button>
        </DropdownMenu.Trigger>
      </div>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="combo-button-menu"
          style={
            menuWidth > 0
              ? {
                  width: Math.max(menuWidth, 220),
                  minWidth: Math.max(menuWidth, 220),
                  maxWidth: Math.max(menuWidth, 260),
                }
              : { minWidth: 220, maxWidth: 260 }
          }
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          sticky="partial"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="stack-layout" style={{ gap: 10, padding: 6 }}>
            <TabBar
              value={mode}
              options={MODE_OPTIONS}
              size="sm"
              ariaLabel="Bars selection mode"
              onChange={(nextMode) => {
                if (nextMode === "time_range") {
                  const next = resolveTimeRangeSelection({
                    mode: "time_range",
                    timeframe,
                    preset,
                    startDate,
                    endDate,
                  });
                  onChange?.({
                    limit_mode: "time_range",
                    limit: next.limit,
                    limit_preset: next.preset,
                    limit_start_date: next.startDate,
                    limit_end_date: next.endDate,
                  });
                  return;
                }
                onChange?.({
                  limit_mode: "bars",
                  limit: barsValue,
                });
              }}
            />

            {mode === "bars" ? (
              <div className="stack-layout" style={{ gap: 8 }}>
                {barsOptions.map((option) => {
                  const active = String(option.value) === barsValue;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={active ? "active" : ""}
                      style={optionButtonStyle(active)}
                      onClick={() => {
                        onChange?.({
                          limit: option.value,
                          limit_bars_value: option.value,
                        });
                        setOpen(false);
                      }}
                    >
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="stack-layout" style={{ gap: 10 }}>
                <div className="stack-layout" style={{ gap: 5 }}>
                  <span className="minor-text">Time range</span>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                    }}
                  >
                    {BACKTEST_TIME_RANGE_PRESETS.map((option) => {
                      const active = option.value === preset;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={active ? "active" : ""}
                          style={optionButtonStyle(active)}
                          onClick={() => {
                            const next = resolveTimeRangeSelection({
                              mode: "time_range",
                              timeframe,
                              preset: option.value,
                              startDate,
                              endDate,
                            });
                            onChange?.({
                              limit: next.limit,
                              limit_preset: next.preset,
                              limit_start_date: next.startDate,
                              limit_end_date: next.endDate,
                            });
                            setOpen(false);
                          }}
                        >
                          <span>{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: 8,
                  }}
                >
                  <label className="stack-layout" style={{ gap: 5 }}>
                    <span className="minor-text">Start</span>
                    <DateTimePicker
                      mode="date"
                      className="text-input"
                      value={startDate}
                      onKeyDown={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        const next = resolveTimeRangeSelection({
                          mode: "time_range",
                          timeframe,
                          preset: "custom",
                          startDate: event.target.value,
                          endDate,
                        });
                        onChange?.({
                          limit: next.limit,
                          limit_preset: "custom",
                          limit_start_date: event.target.value,
                          limit_end_date: endDate,
                        });
                      }}
                    />
                  </label>
                  <label className="stack-layout" style={{ gap: 5 }}>
                    <span className="minor-text">End</span>
                    <DateTimePicker
                      mode="date"
                      className="text-input"
                      value={endDate}
                      onKeyDown={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        const next = resolveTimeRangeSelection({
                          mode: "time_range",
                          timeframe,
                          preset: "custom",
                          startDate,
                          endDate: event.target.value,
                        });
                        onChange?.({
                          limit: next.limit,
                          limit_preset: "custom",
                          limit_start_date: startDate,
                          limit_end_date: event.target.value,
                        });
                      }}
                    />
                  </label>
                </div>

                <div className="minor-text" style={{ fontSize: 11 }}>
                  {computedBars ? `${computedBars} bars` : "Choose a valid date range"}
                </div>
              </div>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
