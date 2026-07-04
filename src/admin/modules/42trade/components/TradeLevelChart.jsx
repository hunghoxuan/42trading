import { createChart } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { getUiThemeColors } from "../../../shared/utils/uiTheme";

export default function TradeLevelChart({ trade }) {
  const ref = useRef(null);
  const themeMode = getUiThemeColors().mode;

  useEffect(() => {
    if (!ref.current || !trade) return undefined;
    const theme = getUiThemeColors();
    const isLight = theme.mode === "light";
    const chart = createChart(ref.current, {
      layout: {
        background: { color: isLight ? theme.surface : "#0b1020" },
        textColor: isLight ? theme.text : "#d7e0ea",
      },
      width: ref.current.clientWidth,
      height: 340,
      grid: {
        vertLines: {
          color: isLight ? "rgba(148,163,184,0.18)" : "#1a2333",
        },
        horzLines: {
          color: isLight ? "rgba(148,163,184,0.18)" : "#1a2333",
        },
      },
      rightPriceScale: { borderColor: isLight ? theme.border : "#2a3346" },
      timeScale: { borderColor: isLight ? theme.border : "#2a3346" },
    });

    const base = Number(trade.entry ?? trade.sl ?? trade.tp ?? 0) || 1;
    const startSec = Math.floor(new Date(trade.opened_at || trade.created_at || Date.now()).getTime() / 1000);
    const endSec = startSec + 3600;

    const line = chart.addLineSeries({ color: "#7aa2ff", lineWidth: 2 });
    line.setData([
      { time: startSec, value: base },
      { time: endSec, value: base },
    ]);

    const levels = [
      { v: trade.entry, label: "Entry", color: "#60a5fa" },
      { v: trade.sl, label: "SL", color: "#f87171" },
      { v: trade.tp, label: "TP", color: "#34d399" },
    ].filter((x) => Number.isFinite(Number(x.v)));

    for (const lv of levels) {
      line.createPriceLine({
        price: Number(lv.v),
        color: lv.color,
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: lv.label,
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!ref.current) return;
      chart.applyOptions({ width: ref.current.clientWidth });
    });
    resizeObserver.observe(ref.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [trade, themeMode]);

  return <div ref={ref} className="chart-box" />;
}
