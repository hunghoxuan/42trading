import { useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import AdminPageToolbar, {
  AdminToolbarGroup,
} from "../../../shared/components/AdminPageToolbar";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import "./SystemToolsPages.css";

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(size) / Math.log(1024)),
  );
  const amount = size / Math.pow(1024, index);
  return `${amount.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function tone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (["ok", "ready", "connected", "enabled", "active", "true"].includes(normalized)) {
    return "ok";
  }
  if (["warn", "warning", "partial", "degraded"].includes(normalized)) {
    return "warn";
  }
  if (["error", "disabled", "false", "down"].includes(normalized)) {
    return "error";
  }
  return "neutral";
}

function HealthCard({ label, value, meta = "" }) {
  return (
    <div className="system-tool-health-card">
      <div className="system-tool-health-card__label">{label}</div>
      <div className="system-tool-health-card__value">{value}</div>
      {meta ? <div className="minor-text">{meta}</div> : null}
    </div>
  );
}

export default function SystemHealthPage() {
  const [health, setHealth] = useState(null);
  const [storage, setStorage] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadData() {
    try {
      setLoading(true);
      const [healthOut, storageOut] = await Promise.all([
        api.healthVerbose(),
        api.storageStats().catch(() => null),
      ]);
      setHealth(healthOut || null);
      setStorage(storageOut?.stats || null);
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load health data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const services = useMemo(
    () => (Array.isArray(health?.services) ? health.services : []),
    [health?.services],
  );
  const connections = useMemo(
    () => (Array.isArray(health?.connections) ? health.connections : []),
    [health?.connections],
  );

  return (
    <section className="system-tool-page">
      <PageHeader title="System Health" />
      <AdminPageToolbar
        className="system-tool-toolbar"
        actions={
          <AdminToolbarGroup className="system-tool-toolbar__group">
            <button type="button" className="secondary-button" onClick={loadData}>
              Refresh
            </button>
            {loading ? <span className="minor-text">Loading...</span> : null}
          </AdminToolbarGroup>
        }
      />

      {error ? (
        <div className="panel card-flat" style={{ padding: 12 }}>
          <span className="msg-error">{error}</span>
        </div>
      ) : null}

      <div className="system-tool-health-grid">
        <HealthCard
          label="Overall"
          value={health?.ok ? "Healthy" : "Needs Attention"}
          meta={`storage=${health?.storage || "-"} redis=${health?.redis || "-"}`}
        />
        <HealthCard
          label="Postgres"
          value={String(health?.postgres || "-").toUpperCase()}
          meta={health?.active_db?.name || ""}
        />
        <HealthCard
          label="Redis"
          value={String(health?.redis || "-").toUpperCase()}
          meta={health?.redisEnabled ? "enabled" : "disabled"}
        />
        <HealthCard
          label="Snapshots"
          value={storage ? String(storage.snapshots_count || 0) : "-"}
          meta={storage ? formatBytes(storage.snapshots_size_bytes) : ""}
        />
      </div>

      <div className="system-tool-layout system-tool-layout--compact-detail">
        <ResponsivePanel title="Services" showToggle={false}>
          <div className="system-tool-panel__body system-tool-panel__body--scroll">
            <div className="system-tool-list">
              {services.map((service) => (
                <div key={service.id} className="system-tool-list__item">
                  <div className="system-tool-list__title">{service.label}</div>
                  <div className="system-tool-list__meta">
                    <span
                      className={[
                        "system-tool-pill",
                        `system-tool-pill--${tone(service.status)}`,
                      ].join(" ")}
                    >
                      {service.status || "unknown"}
                    </span>
                    <span>{service.port ? `:${service.port}` : ""}</span>
                  </div>
                  <div className="minor-text">{service.details || ""}</div>
                </div>
              ))}
            </div>
          </div>
        </ResponsivePanel>

        <ResponsivePanel title="Storage & Connections" showToggle={false}>
          <div className="system-tool-panel__body system-tool-panel__body--scroll">
            {storage ? (
              <dl className="system-tool-kv" style={{ marginBottom: 16 }}>
                <dt>Disk Used</dt>
                <dd>{formatBytes(storage.disk_used_bytes)}</dd>
                <dt>Disk Free</dt>
                <dd>{formatBytes(storage.disk_avail_bytes)}</dd>
                <dt>Postgres Logs</dt>
                <dd>{formatBytes(storage.system_postgres_logs_size_bytes)}</dd>
                <dt>NPM Cache</dt>
                <dd>{formatBytes(storage.system_npm_cache_size_bytes)}</dd>
              </dl>
            ) : null}
            <div className="system-tool-list">
              {connections.map((connection) => (
                <div key={connection.id} className="system-tool-list__item">
                  <div className="system-tool-list__title">{connection.name}</div>
                  <div className="system-tool-list__meta">
                    <span>{connection.kind || "-"}</span>
                    <span>{connection.active ? "active" : ""}</span>
                  </div>
                  <div className="minor-text">{connection.note || ""}</div>
                </div>
              ))}
            </div>
          </div>
        </ResponsivePanel>
      </div>
    </section>
  );
}
