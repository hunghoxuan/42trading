function formatSummaryNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

function metricColor(value, threshold = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "var(--muted)";
  return num < threshold ? "#ef4444" : "#10b981";
}

export default function BacktestSummaryMetaRow({
  leadLabel = "",
  leadTone = "var(--muted)",
  winRateValue = null,
  rrValue = null,
  realizedRValue = null,
  plannedOutcomeRValue = null,
  plannedOutcomeAvailable = true,
  totalPnlValue = null,
  rangeLabel = "",
  title = "",
}) {
  const resolvedLead = String(leadLabel || "").trim();
  const resolvedRange = String(rangeLabel || "").trim();
  const safeWinRate = Number(winRateValue);
  const safeRealizedR = Number(
    realizedRValue ?? rrValue,
  );
  const safePlannedOutcomeR = Number(plannedOutcomeRValue);
  const safeTotalPnl = Number(totalPnlValue);

  return (
    <div
      className="minor-text"
      data-component="BacktestSummaryMetaRow"
      style={{
        fontSize: 10,
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}
      title={title || undefined}
    >
      {resolvedLead ? <span style={{ color: leadTone }}>{resolvedLead}</span> : null}
      <span
        style={{
          fontWeight: 700,
          color: metricColor(safeWinRate, 50),
        }}
      >
        WR {formatSummaryNumber(safeWinRate, 0)}%
      </span>
      <span
        style={{
          fontWeight: 700,
          color: metricColor(safeRealizedR, 0),
        }}
      >
        Real {formatSummaryNumber(safeRealizedR, 1)}r
      </span>
      {plannedOutcomeAvailable ? (
        <span
          style={{
            fontWeight: 700,
            color: metricColor(safePlannedOutcomeR, 0),
          }}
        >
          Plan {Number.isFinite(safePlannedOutcomeR) ? formatSummaryNumber(safePlannedOutcomeR, 1) : "-"}{Number.isFinite(safePlannedOutcomeR) ? "r" : ""}
        </span>
      ) : null}
      {Number.isFinite(safeTotalPnl) ? (
        <span
          style={{
            fontWeight: 700,
            color: metricColor(safeTotalPnl, 0),
          }}
        >
          ${formatSummaryNumber(safeTotalPnl, 0)}
        </span>
      ) : null}
      <span>{resolvedRange || "Data -"}</span>
    </div>
  );
}
