import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api";

const KIND_OPTIONS = ["", "tv", "api", "manual", "bot"];
const AUTH_OPTIONS = ["token", "api_key", "signature", "none"];
const PAGE_SIZE_OPTIONS = [50, 100, 200];

function newId(prefix = "src") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export default function SourcesPage() {
  const { sourceId } = useParams();
  const navigate = useNavigate();
  const EMPTY_MSG = { type: "", text: "" };
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(EMPTY_MSG);

  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [rotatedSecret, setRotatedSecret] = useState("");
  const [secretLast4, setSecretLast4] = useState("");
  const [secretPlain, setSecretPlain] = useState("");
  const [revealSecret, setRevealSecret] = useState(false);
  const [mode, setMode] = useState("view");
  const [form, setForm] = useState({
    source_id: newId("src"),
    name: "",
    kind: "api",
    auth_mode: "token",
    is_active: true,
  });

  const filtered = useMemo(() => {
    const needle = String(q || "")
      .trim()
      .toLowerCase();
    return rows.filter((r) => {
      if (kindFilter && String(r.kind || "") !== kindFilter) return false;
      if (statusFilter) {
        const active = Boolean(r.is_active);
        if (statusFilter === "ACTIVE" && !active) return false;
        if (statusFilter === "INACTIVE" && active) return false;
      }
      if (!needle) return true;
      return (
        String(r.source_id || "")
          .toLowerCase()
          .includes(needle) ||
        String(r.name || "")
          .toLowerCase()
          .includes(needle) ||
        String(r.kind || "")
          .toLowerCase()
          .includes(needle) ||
        String(r.auth_mode || "")
          .toLowerCase()
          .includes(needle)
      );
    });
  }, [rows, q, kindFilter, statusFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.max(1, Math.min(page, pages));
  const pageRows = filtered.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  async function loadSources() {
    setLoading(true);
    try {
      const out = await api.v2Sources();
      const items = Array.isArray(out?.items) ? out.items : [];
      setRows(items);
      setMsg(EMPTY_MSG);
    } catch (e) {
      setMsg({ type: "error", text: e?.message || "Failed to load sources" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (sourceId && rows.length > 0 && !selectedSourceId) {
      const match = rows.find(
        (r) => String(r.source_id || "") === String(sourceId),
      );
      if (match) {
        openEditMode(match);
      }
    }
  }, [sourceId, rows, selectedSourceId]);

  useEffect(() => {
    loadSources();
  }, []);
  useEffect(() => {
    setPage(1);
  }, [q, kindFilter, statusFilter, pageSize]);
  useEffect(() => {
    if (
      mode === "edit" &&
      selectedSourceId &&
      !rows.some((r) => String(r.source_id || "") === String(selectedSourceId))
    ) {
      setMode("view");
      setSelectedSourceId("");
    }
  }, [rows, mode, selectedSourceId]);

  function openCreateMode() {
    setMode("create");
    setSelectedSourceId("");
    setRotatedSecret("");
    setSecretLast4("");
    setSecretPlain("");
    setRevealSecret(false);
    setForm({
      source_id: newId("src"),
      name: "",
      kind: "api",
      auth_mode: "token",
      is_active: true,
    });
  }

  function openEditMode(row) {
    setMode("edit");
    setSelectedSourceId(String(row.source_id || ""));
    setRotatedSecret("");
    const metadata =
      row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    setSecretLast4(String(metadata.auth_secret_last4 || ""));
    setSecretPlain("");
    setRevealSecret(false);
    setForm({
      source_id: String(row.source_id || ""),
      name: String(row.name || ""),
      kind: String(row.kind || "api"),
      auth_mode: String(row.auth_mode || "token"),
      is_active: Boolean(row.is_active),
    });
  }

  async function onSaveSource() {
    const name = String(form.name || "").trim();
    if (!name) {
      setMsg({ type: "error", text: "Source name is required." });
      return;
    }
    setSaving(true);
    try {
      if (mode === "edit") {
        await api.v2UpdateSource(form.source_id, {
          name,
          kind: String(form.kind || "api"),
          auth_mode: String(form.auth_mode || "token"),
          is_active: Boolean(form.is_active),
        });
        setMsg({ type: "success", text: "Source updated." });
      } else {
        const sourceId = String(form.source_id || "").trim() || newId("src");
        await api.v2CreateSource({
          source_id: sourceId,
          name,
          kind: String(form.kind || "api"),
          auth_mode: String(form.auth_mode || "token"),
          is_active: true,
        });
        setMsg({ type: "success", text: "Source created." });
        setSelectedSourceId(sourceId);
        setMode("edit");
      }
      await loadSources();
    } catch (e) {
      setMsg({ type: "error", text: e?.message || "Failed to save source" });
    } finally {
      setSaving(false);
      window.setTimeout(() => setMsg(EMPTY_MSG), 2200);
    }
  }

  async function onToggleSource() {
    if (mode === "create") return;
    setSaving(true);
    try {
      await api.v2UpdateSource(form.source_id, {
        name: form.name,
        kind: form.kind,
        auth_mode: form.auth_mode,
        is_active: !Boolean(form.is_active),
      });
      setForm((p) => ({ ...p, is_active: !Boolean(p.is_active) }));
      setMsg({
        type: "success",
        text: `Source ${form.is_active ? "deactivated" : "activated"}.`,
      });
      await loadSources();
    } catch (e) {
      setMsg({ type: "error", text: e?.message || "Failed to update source" });
    } finally {
      setSaving(false);
      window.setTimeout(() => setMsg(EMPTY_MSG), 2200);
    }
  }

  async function onRevokeAndRegenerateSecret() {
    if (mode === "create") return;
    if (
      !window.confirm(
        `Revoke current auth secret and generate a new secret for source ${form.source_id}?`,
      )
    )
      return;
    setSaving(true);
    try {
      const out = await api.v2RotateSourceSecret(form.source_id);
      const nextPlain = String(out?.source_secret_plaintext || "");
      setRotatedSecret(nextPlain);
      setSecretPlain(nextPlain);
      setSecretLast4(
        String(out?.source_secret_last4 || nextPlain.slice(-4) || ""),
      );
      setRevealSecret(false);
      setMsg({
        type: "warning",
        text: "Source secret replaced with a new one.",
      });
      await loadSources();
    } catch (e) {
      setMsg({
        type: "error",
        text: e?.message || "Failed to replace source secret",
      });
    } finally {
      setSaving(false);
      window.setTimeout(() => setMsg(EMPTY_MSG), 2200);
    }
  }

  async function onCopySecret() {
    if (!secretPlain) {
      setMsg({
        type: "warning",
        text: "No plaintext secret available. Revoke to generate one, then copy.",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(secretPlain);
      setMsg({ type: "success", text: "Secret copied to clipboard." });
    } catch {
      setMsg({ type: "error", text: "Failed to copy secret." });
    }
    window.setTimeout(() => setMsg(EMPTY_MSG), 1800);
  }

  return (
    <section className="logs-page-container stack-layout">
      <h2 className="page-title">Sources</h2>

      <div className="toolbar-panel">
        <div className="toolbar-group toolbar-pagination">
          <div className="pager-area">
            <strong>{filtered.length}</strong>
            {pages > 1 ? (
              <div className="pager-mini">
                <button
                  className="secondary-button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  &lt;
                </button>
                <span className="minor-text">
                  {safePage}/{pages}
                </span>
                <button
                  className="secondary-button"
                  disabled={safePage >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  &gt;
                </button>
              </div>
            ) : null}
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          className="toolbar-group toolbar-search-filter"
          style={{ flexWrap: "wrap" }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search source id/name..."
            style={{ width: 220 }}
          />
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k ? `KIND: ${k.toUpperCase()}` : "ALL KINDS"}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">ALL STATUS</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
        </div>

        <div className="toolbar-group toolbar-bulk-action">
          <button
            className="primary-button"
            onClick={openCreateMode}
            disabled={saving}
          >
            + ADD SOURCE
          </button>
        </div>
      </div>

      {msg?.text ? (
        <div className={`form-message msg-${msg.type || "error"}`}>
          {msg.text}
        </div>
      ) : null}

      <div className="logs-layout-split">
        <div className="logs-list-pane">
          <div className="events-table-wrap">
            <table className="events-table">
              <thead>
                <tr>
                  <th>SOURCE</th>
                  <th>KIND</th>
                  <th>AUTH</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="loading">
                      Loading sources...
                    </td>
                  </tr>
                ) : pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-state">
                      No sources found.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row) => (
                    <tr
                      key={row.source_id}
                      className={
                        selectedSourceId === row.source_id ? "active" : ""
                      }
                      onClick={() => {
                        openEditMode(row);
                        navigate(`/system/sources/${row.source_id}`);
                      }}
                    >
                      <td>
                        <div className="cell-wrap">
                          <div className="cell-major">
                            {row.name || row.source_id}
                          </div>
                          <div className="cell-minor">{row.source_id}</div>
                        </div>
                      </td>
                      <td>{row.kind || "-"}</td>
                      <td>{row.auth_mode || "-"}</td>
                      <td>
                        <span
                          className={`badge ${row.is_active ? "ACTIVE" : "INACTIVE"}`}
                        >
                          {row.is_active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="logs-detail-pane">
          {!(mode === "create" || (mode === "edit" && selectedSourceId)) ? (
            <div className="empty-state minor-text">
              SELECT A SOURCE TO INSPECT DETAIL
            </div>
          ) : (
            <div className="stack-layout" style={{ gap: 14 }}>
              <div className="panel-label" style={{ marginBottom: 0 }}>
                {mode === "create" ? "CREATE SOURCE" : "EDIT SOURCE"}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
                  gap: 10,
                }}
              >
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <div className="minor-text">Source ID</div>
                  <input
                    value={form.source_id}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, source_id: e.target.value }))
                    }
                    disabled={mode === "edit"}
                  />
                </label>
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <div className="minor-text">Name</div>
                  <input
                    value={form.name}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, name: e.target.value }))
                    }
                    placeholder="Display name"
                  />
                </label>
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <div className="minor-text">Kind</div>
                  <select
                    value={form.kind}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, kind: e.target.value }))
                    }
                  >
                    {KIND_OPTIONS.filter(Boolean).map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <div className="minor-text">Auth Mode</div>
                  <select
                    value={form.auth_mode}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, auth_mode: e.target.value }))
                    }
                  >
                    {AUTH_OPTIONS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 20,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(form.is_active)}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, is_active: e.target.checked }))
                    }
                  />
                  <span className="minor-text">Active</span>
                </label>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  className="primary-button"
                  onClick={onSaveSource}
                  disabled={saving || loading}
                >
                  {mode === "create" ? "ADD" : "SAVE"}
                </button>
                {mode === "edit" ? (
                  <button
                    className="secondary-button"
                    onClick={onToggleSource}
                    disabled={saving}
                  >
                    {form.is_active ? "DEACTIVATE" : "ACTIVATE"}
                  </button>
                ) : null}
              </div>

              <div className="panel" style={{ padding: 12 }}>
                <div className="panel-label" style={{ marginBottom: 8 }}>
                  AUTH SECRET
                </div>
                <div className="minor-text" style={{ marginBottom: 10 }}>
                  Last4: {secretLast4 ? `****${secretLast4}` : "(not set)"}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto auto",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <input
                    type={revealSecret ? "text" : "password"}
                    value={secretPlain || ""}
                    readOnly
                    placeholder="No plaintext secret. Revoke to generate a new one."
                  />
                  <button
                    className="secondary-button"
                    onClick={() => setRevealSecret((v) => !v)}
                    disabled={!secretPlain}
                  >
                    {revealSecret ? "HIDE" : "SHOW"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={onCopySecret}
                    disabled={saving || !secretPlain}
                    title={
                      secretPlain
                        ? "Copy current plaintext secret"
                        : "No plaintext secret in memory. Revoke to generate a new secret, then copy it."
                    }
                  >
                    COPY
                  </button>
                  {mode === "edit" ? (
                    <button
                      className="danger-button"
                      onClick={onRevokeAndRegenerateSecret}
                      disabled={saving}
                    >
                      REVOKE
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
