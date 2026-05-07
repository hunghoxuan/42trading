import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api";

const PAGE_SIZE_OPTIONS = [50, 100, 200];

const EMPTY_MSG = { type: "", text: "" };

function newId(prefix = "acc") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function prettyMetadata(v) {
  try {
    return JSON.stringify(v || {}, null, 2);
  } catch {
    return "{}";
  }
}

export default function AccountsV2Page() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(EMPTY_MSG);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [mode, setMode] = useState("view");
  const [createdKey, setCreatedKey] = useState("");
  const [rotatedKey, setRotatedKey] = useState("");
  const [apiKeyPlain, setApiKeyPlain] = useState("");
  const [apiKeyLast4, setApiKeyLast4] = useState("");
  const [revealApiKey, setRevealApiKey] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState(new Set());
  const [updateKeyMode, setUpdateKeyMode] = useState(false);
  const [manualKeyInput, setManualKeyInput] = useState("");

  const [form, setForm] = useState({
    account_id: newId("acc"),
    user_id: "default",
    name: "",
    status: "ACTIVE",
    metadata_json: "{}",
  });

  const filtered = useMemo(() => {
    const needle = String(q || "")
      .trim()
      .toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && String(r.status || "").toUpperCase() !== statusFilter)
        return false;
      if (userFilter && String(r.user_id || "") !== userFilter) return false;
      if (!needle) return true;
      return (
        String(r.account_id || "")
          .toLowerCase()
          .includes(needle) ||
        String(r.user_id || "")
          .toLowerCase()
          .includes(needle) ||
        String(r.name || "")
          .toLowerCase()
          .includes(needle)
      );
    });
  }, [rows, q, statusFilter, userFilter]);

  const userOptions = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => String(r.user_id || "")).filter(Boolean)),
      ).sort(),
    [rows],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.max(1, Math.min(page, pages));
  const pageRows = filtered.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  async function loadBase() {
    setLoading(true);
    try {
      const [aOut, sOut] = await Promise.all([
        api.v2Accounts(),
        api.v2Sources(),
      ]);
      const accounts = Array.isArray(aOut?.items) ? aOut.items : [];
      const sourceItems = Array.isArray(sOut?.items) ? sOut.items : [];
      setRows(accounts);
      setSources(sourceItems);
      setMsg(EMPTY_MSG);
    } catch (e) {
      setMsg({ type: "error", text: e?.message || "Failed to load accounts" });
    } finally {
      setLoading(false);
    }
  }

  async function onSaveManualKey() {
    if (!manualKeyInput.trim()) return;
    setSaving(true);
    try {
      await api.v2UpdateAccountApiKey(form.account_id, manualKeyInput);
      setApiKeyLast4(manualKeyInput.slice(-4));
      setApiKeyPlain(""); // Clear after sync to DB
      setUpdateKeyMode(false);
      setManualKeyInput("");
      setMsg({ type: "success", text: "Manual API key saved." });
      await loadBase();
    } catch (e) {
      setMsg({ type: "error", text: e?.message || "Failed to save API key" });
    } finally {
      setSaving(false);
    }
  }

  async function openEditMode(row) {
    const accountId = String(row.account_id || "");
    setMode("edit");
    setSelectedAccountId(accountId);
    setCreatedKey("");
    setRotatedKey("");
    setApiKeyPlain("");
    setApiKeyLast4(String(row.api_key_last4 || ""));
    setRevealApiKey(false);
    setUpdateKeyMode(false);
    setManualKeyInput("");
    setForm({
      account_id: accountId,
      user_id: String(row.user_id || "default"),
      name: String(row.name || ""),
      status: String(row.status || "ACTIVE"),
      metadata_json: prettyMetadata(row.metadata || {}),
    });
    try {
      const out = await api.v2GetSubscriptions(accountId);
      const sourceIds = new Set(
        (Array.isArray(out?.items) ? out.items : [])
          .map((x) => String(x.source_id || ""))
          .filter(Boolean),
      );
      setSelectedSourceIds(sourceIds);
    } catch {
      setSelectedSourceIds(new Set());
    }
  }

  function openCreateMode() {
    setMode("create");
    setSelectedAccountId("");
    setCreatedKey("");
    setRotatedKey("");
    setApiKeyPlain("");
    setApiKeyLast4("");
    setRevealApiKey(false);
    setUpdateKeyMode(false);
    setManualKeyInput("");
    setSelectedSourceIds(new Set());
    setForm({
      account_id: newId("acc"),
      user_id: "default",
      name: "",
      status: "ACTIVE",
      metadata_json: "{}",
    });
  }

  useEffect(() => {
    if (accountId && rows.length > 0 && !selectedAccountId) {
      const match = rows.find(
        (r) => String(r.account_id || "") === String(accountId),
      );
      if (match) {
        openEditMode(match);
      }
    }
  }, [accountId, rows, selectedAccountId]);

  useEffect(() => {
    loadBase();
  }, []);
  useEffect(() => {
    setPage(1);
  }, [q, statusFilter, userFilter, pageSize]);
  useEffect(() => {
    if (
      mode === "edit" &&
      selectedAccountId &&
      !rows.some(
        (r) => String(r.account_id || "") === String(selectedAccountId),
      )
    ) {
      setMode("view");
      setSelectedAccountId("");
    }
  }, [rows, mode, selectedAccountId]);

  function parseMetadataInput(raw) {
    const txt = String(raw || "").trim();
    if (!txt) return {};
    const parsed = JSON.parse(txt);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("metadata must be a JSON object");
    return parsed;
  }

  async function saveSubscriptions(accountId) {
    const items = Array.from(selectedSourceIds).map((source_id) => ({
      source_id,
      is_active: true,
    }));
    await api.v2PutSubscriptions(accountId, items);
  }

  async function onSave() {
    setSaving(true);
    try {
      const accountId = String(form.account_id || "").trim() || newId("acc");
      const payload = {
        account_id: accountId,
        user_id: String(form.user_id || "default").trim() || "default",
        name: String(form.name || "").trim() || accountId,
        status: String(form.status || "ACTIVE").trim() || "ACTIVE",
        metadata: parseMetadataInput(form.metadata_json),
      };

      if (mode === "edit") {
        await api.v2UpdateAccount(accountId, payload);
        await saveSubscriptions(accountId);
        setMsg({ type: "success", text: "Account updated." });
      } else {
        const out = await api.v2CreateAccount(payload);
        const nextPlain = String(out?.api_key_plaintext || "");
        await saveSubscriptions(accountId);
        setCreatedKey(nextPlain);
        setApiKeyPlain(nextPlain);
        setApiKeyLast4(nextPlain ? nextPlain.slice(-4) : "");
        setMsg({ type: "success", text: "Account created." });
        setMode("edit");
        setSelectedAccountId(accountId);
      }

      await loadBase();
    } catch (e) {
      setMsg({ type: "error", text: e?.message || "Failed to save account" });
    } finally {
      setSaving(false);
      window.setTimeout(() => setMsg(EMPTY_MSG), 2200);
    }
  }

  async function onRevokeAndRegenerateApiKey() {
    if (mode === "create") return;
    if (
      !window.confirm(
        `Revoke current API key and generate a new API key for account ${form.account_id}?`,
      )
    )
      return;
    setSaving(true);
    try {
      const out = await api.v2RotateAccountApiKey(form.account_id);
      const nextPlain = String(out?.api_key_plaintext || "");
      setRotatedKey(nextPlain);
      setApiKeyPlain(nextPlain);
      setApiKeyLast4(nextPlain ? nextPlain.slice(-4) : "");
      setRevealApiKey(false);
      setUpdateKeyMode(false);
      setMsg({ type: "warning", text: "API key replaced with a new one." });
      await loadBase();
    } catch (e) {
      setMsg({
        type: "error",
        text: e?.message || "Failed to replace API key",
      });
    } finally {
      setSaving(false);
    }
  }

  async function onCopyApiKey() {
    if (!apiKeyPlain) {
      setMsg({
        type: "warning",
        text: "No plaintext API key available. Revoke to generate one, then copy.",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(apiKeyPlain);
      setMsg({ type: "success", text: "API key copied to clipboard." });
    } catch {
      setMsg({ type: "error", text: "Failed to copy API key." });
    }
    window.setTimeout(() => setMsg(EMPTY_MSG), 1800);
  }

  async function onToggleStatus() {
    if (mode === "create") return;
    const nextStatus =
      String(form.status || "").toUpperCase() === "ACTIVE"
        ? "INACTIVE"
        : "ACTIVE";
    setSaving(true);
    try {
      await api.v2UpdateAccount(form.account_id, {
        account_id: form.account_id,
        user_id: form.user_id,
        name: form.name,
        status: nextStatus,
        metadata: parseMetadataInput(form.metadata_json),
      });
      setForm((p) => ({ ...p, status: nextStatus }));
      setMsg({ type: "success", text: `Account ${nextStatus}.` });
      await loadBase();
    } catch (e) {
      setMsg({
        type: "error",
        text: e?.message || "Failed to update account status",
      });
    } finally {
      setSaving(false);
      window.setTimeout(() => setMsg(EMPTY_MSG), 2200);
    }
  }

  async function onArchive() {
    if (mode === "create") return;
    if (!window.confirm(`Archive account ${form.account_id}?`)) return;
    setSaving(true);
    try {
      await api.v2ArchiveAccount(form.account_id);
      setMsg({ type: "success", text: "Account archived." });
      await loadBase();
    } catch (e) {
      setMsg({
        type: "error",
        text: e?.message || "Failed to archive account",
      });
    } finally {
      setSaving(false);
      window.setTimeout(() => setMsg(EMPTY_MSG), 2200);
    }
  }

  return (
    <section className="logs-page-container stack-layout">
      <h2 className="page-title">Accounts</h2>

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
            placeholder="Search account/user/name..."
            style={{ width: 220 }}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">ALL STATUS</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
            <option value="PAUSED">PAUSED</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          >
            <option value="">ALL USERS</option>
            {userOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-group toolbar-bulk-action">
          <button
            className="primary-button"
            onClick={openCreateMode}
            disabled={saving}
          >
            + ADD ACCOUNT
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
                  <th>ACCOUNT</th>
                  <th>USER</th>
                  <th>STATUS</th>
                  <th>API</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="loading">
                      Loading accounts...
                    </td>
                  </tr>
                ) : pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-state">
                      No accounts found.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row) => (
                    <tr
                      key={row.account_id}
                      className={
                        selectedAccountId === row.account_id ? "active" : ""
                      }
                      onClick={() => {
                        openEditMode(row);
                        navigate(`/system/accounts/${row.account_id}`);
                      }}
                    >
                      <td>
                        <div className="cell-wrap">
                          <div className="cell-major">
                            {row.name || row.account_id}
                          </div>
                          <div className="cell-minor">{row.account_id}</div>
                        </div>
                      </td>
                      <td>{row.user_id || "-"}</td>
                      <td>
                        <span
                          className={`badge ${String(row.status || "").toUpperCase()}`}
                        >
                          {String(row.status || "-").toUpperCase()}
                        </span>
                      </td>
                      <td>
                        {row.api_key_last4 ? `****${row.api_key_last4}` : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="logs-detail-pane">
          {!(mode === "create" || (mode === "edit" && selectedAccountId)) ? (
            <div className="empty-state minor-text">
              SELECT AN ACCOUNT TO INSPECT DETAIL
            </div>
          ) : (
            <div className="stack-layout" style={{ gap: 14 }}>
              <div className="panel-label" style={{ marginBottom: 0 }}>
                {mode === "create" ? "CREATE ACCOUNT" : "EDIT ACCOUNT"}
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
                  <div className="minor-text">Account ID</div>
                  <input
                    value={form.account_id}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, account_id: e.target.value }))
                    }
                    disabled={mode === "edit"}
                  />
                </label>
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <div className="minor-text">User ID</div>
                  <input
                    value={form.user_id}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, user_id: e.target.value }))
                    }
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
                  <div className="minor-text">Status</div>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, status: e.target.value }))
                    }
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                    <option value="PAUSED">PAUSED</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </label>
              </div>

              <div className="panel" style={{ padding: 12 }}>
                <div className="panel-label" style={{ marginBottom: 8 }}>
                  SUBSCRIPTIONS
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Enabled</th>
                        <th>Source</th>
                        <th>Kind</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sources.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="muted">
                            No sources found.
                          </td>
                        </tr>
                      ) : (
                        sources.map((s) => {
                          const sourceId = String(s.source_id || "");
                          return (
                            <tr key={sourceId}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={selectedSourceIds.has(sourceId)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setSelectedSourceIds((prev) => {
                                      const next = new Set(prev);
                                      if (checked) next.add(sourceId);
                                      else next.delete(sourceId);
                                      return next;
                                    });
                                  }}
                                />
                              </td>
                              <td>
                                <div className="cell-wrap">
                                  <div className="cell-major">
                                    {s.name || sourceId}
                                  </div>
                                  <div className="cell-minor">{sourceId}</div>
                                </div>
                              </td>
                              <td>{s.kind || "-"}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <label
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <div className="minor-text">Metadata JSON</div>
                <textarea
                  value={form.metadata_json}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, metadata_json: e.target.value }))
                  }
                  rows={4}
                />
              </label>

              <div className="panel" style={{ padding: 12 }}>
                <div className="panel-label" style={{ marginBottom: 8 }}>
                  API KEY
                </div>
                <div className="minor-text" style={{ marginBottom: 10 }}>
                  Last4: {apiKeyLast4 ? `****${apiKeyLast4}` : "(not set)"}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto auto auto",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  {updateKeyMode ? (
                    <>
                      <input
                        type="text"
                        value={manualKeyInput}
                        onChange={(e) => setManualKeyInput(e.target.value)}
                        placeholder="Enter new manual API key..."
                      />
                      <button
                        className="primary-button"
                        onClick={onSaveManualKey}
                        disabled={saving}
                      >
                        SAVE
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setUpdateKeyMode(false);
                          setManualKeyInput("");
                        }}
                      >
                        CANCEL
                      </button>
                    </>
                  ) : (
                    <>
                      <input
                        type={revealApiKey ? "text" : "password"}
                        value={apiKeyPlain || ""}
                        readOnly
                        placeholder="No plaintext API key. Revoke to generate a new one."
                      />
                      <button
                        className="secondary-button"
                        onClick={() => setRevealApiKey((v) => !v)}
                        disabled={!apiKeyPlain}
                        title={revealApiKey ? "Hide" : "Show"}
                      >
                        {revealApiKey ? "👁️" : "👁️"}
                      </button>
                      <button
                        className="secondary-button"
                        onClick={onCopyApiKey}
                        disabled={saving || !apiKeyPlain}
                        title={apiKeyPlain ? "Copy" : "No plaintext key."}
                      >
                        📋
                      </button>
                      {mode === "edit" ? (
                        <>
                          <button
                            className="secondary-button"
                            onClick={() => setUpdateKeyMode(true)}
                            disabled={saving}
                            title="Manual Update"
                          >
                            ✏️
                          </button>
                          <button
                            className="danger-button"
                            onClick={onRevokeAndRegenerateApiKey}
                            disabled={saving}
                          >
                            REVOKE
                          </button>
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  className="primary-button"
                  onClick={onSave}
                  disabled={saving || loading}
                >
                  {mode === "create" ? "ADD" : "SAVE"}
                </button>
                {mode === "edit" ? (
                  <>
                    <button
                      className="secondary-button"
                      onClick={onToggleStatus}
                      disabled={saving}
                    >
                      {String(form.status || "").toUpperCase() === "ACTIVE"
                        ? "DEACTIVATE"
                        : "ACTIVATE"}
                    </button>
                    <button
                      className="danger-button"
                      onClick={onArchive}
                      disabled={
                        saving ||
                        String(form.status || "").toUpperCase() === "ARCHIVED"
                      }
                    >
                      ARCHIVE
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
