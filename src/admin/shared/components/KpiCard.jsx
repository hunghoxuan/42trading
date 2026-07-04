import Tooltip from "./Tooltip";

export default function KpiCard({ label, value, hint }) {
  return (
    <article className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {hint ? <Tooltip content={hint}><span>{value}</span></Tooltip> : value}
      </div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </article>
  );
}
