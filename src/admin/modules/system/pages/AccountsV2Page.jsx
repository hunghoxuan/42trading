import { useEffect, useState } from "react";
import { api } from "../../../app/api";
import MasterDetailLayout from "../../../shared/components/MasterDetailLayout";
import SidebarListItem from "../components/SidebarListItem";
import { useConfirmDialog } from "../../../shared/components/ConfirmDialog";
import SecretInput from "../../../shared/components/SecretInput";
import ToggleButton from "../../../shared/components/ToggleButton";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import PageHeader from "../../../shared/components/PageHeader";
import {
  MasterDetailContentPanel,
  MasterDetailSidebarPanel,
} from "../../../shared/components/MasterDetailPanel";

export default function AccountsV2Page() {
  const confirm = useConfirmDialog();
  const [accounts, setAccounts] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessResult, setReadinessResult] = useState(null);
  const [pageMessage, setPageMessage] = useState("");

  const [form, setForm] = useState({
    account_id: "",
    user_id: "default",
    name: "",
    status: "ACTIVE",
    broker_type: "MT5",
    broker_mode: "Demo",
    broker_login: "",
    broker_password: "",
    broker_server: "",
    metadata_json: "{}",
  });
  const [apiKeyForm, setApiKeyForm] = useState({
    plain: "",
    last4: "",
    reveal: false,
  });

  const selected = accounts.find((a) => a.account_id === selectedId);

  const load = async () => {
    setLoading(true);
    try {
      const [aRes, sRes] = await Promise.all([
        api.v2Accounts(),
        api.v2Sources(),
      ]);
      const list = Array.isArray(aRes?.items) ? aRes.items : [];
      setAccounts(list);
      setSources(Array.isArray(sRes?.items) ? sRes.items : []);
      if (!selectedId && list.length) setSelectedId(list[0].account_id);
    } catch (e) {
      setPageMessage(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (selected) {
      setForm({
        account_id: selected.account_id,
        user_id: selected.user_id || "default",
        name: selected.name || "",
        status: selected.status || "ACTIVE",
        broker_type: selected.broker?.Type || "MT5",
        broker_mode: selected.broker?.Mode || "Demo",
        broker_login: selected.broker?.Login || "",
        broker_password: selected.broker?.Password || "",
        broker_server: selected.broker?.Server || "",
        metadata_json: JSON.stringify(selected.metadata || {}, null, 2),
      });
      setApiKeyForm({
        plain: "",
        last4: selected.api_key_last4 || "",
        reveal: false,
      });
      setReadinessResult(null);
    }
  }, [selectedId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      let metadata;
      try {
        metadata = JSON.parse(form.metadata_json);
      } catch {
        metadata = {};
      }
      await api.v2UpdateAccount(form.account_id, {
        user_id: form.user_id,
        name: form.name,
        status: form.status,
        broker: {
          Type: form.broker_type,
          Mode: form.broker_mode,
          Login: form.broker_login,
          Password: form.broker_password,
          Server: form.broker_server,
        },
        metadata,
      });
      setPageMessage("Saved");
      load();
    } catch (e) {
      setPageMessage(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!selected) return;
    const newStatus =
      String(selected.status || "").toUpperCase() === "ACTIVE"
        ? "INACTIVE"
        : "ACTIVE";
    setSaving(true);
    try {
      await api.v2UpdateAccount(selected.account_id, { status: newStatus });
      setPageMessage(`Account ${newStatus}`);
      load();
    } catch (e) {
      setPageMessage(e?.message || "Toggle failed");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!selected) return;
    if (
      !(await confirm({
        title: "Archive account?",
        message: `Archive account "${selected.name || selected.account_id}"? This cannot be undone.`,
        confirmLabel: "Archive",
        tone: "danger",
      }))
    )
      return;
    setSaving(true);
    try {
      await api.v2ArchiveAccount(selected.account_id);
      setPageMessage("Account archived.");
      setSelectedId("");
      load();
    } catch (e) {
      setPageMessage(e?.message || "Archive failed");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateKey = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const r = await api.v2RotateAccountApiKey(selected.account_id);
      const plain = String(r?.api_key_plaintext || "");
      setApiKeyForm({
        plain,
        last4: plain ? plain.slice(-4) : "",
        reveal: true,
      });
      setPageMessage("Key generated");
    } catch (e) {
      setPageMessage(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  };

  const handleCheckReadiness = async () => {
    if (!selected) return;
    setReadinessLoading(true);
    try {
      const out = await api.v2AccountBridgeReadiness(selected.account_id);
      setReadinessResult(out?.readiness || null);
      setPageMessage(
        out?.readiness?.ready === true
          ? "MT5 account is ready."
          : out?.readiness?.message || "MT5 account is not ready.",
      );
    } catch (e) {
      setReadinessResult({
        ready: false,
        message: e?.message || "Failed to check MT5 readiness.",
        blockers: [],
      });
      setPageMessage(e?.message || "Failed to check MT5 readiness.");
    } finally {
      setReadinessLoading(false);
    }
  };

  if (loading && !accounts.length)
    return (
      <div className="panel" style={{ padding: 24 }}>
        <span className="minor-text">Loading...</span>
      </div>
    );

  const isActive =
    selected && String(selected.status || "").toUpperCase() === "ACTIVE";

  const revealBrokerPassword = async () => {
    if (!selected?.account_id) return "";
    const out = await api.getAccountSecret(
      selected.account_id,
      "broker_password",
    );
    return String(out?.value || "");
  };

  return (
    <div className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <PageHeader title="Accounts" />
      {pageMessage ? (
        <div className="minor-text" style={{ fontSize: 11 }}>
          {pageMessage}
        </div>
      ) : null}

      <MasterDetailLayout>
        {/* Left: Account list */}
        <MasterDetailSidebarPanel label="ACCOUNTS">
          {accounts.map((a) => {
            const ok = String(a.status).toUpperCase() === "ACTIVE";
            return (
              <SidebarListItem
                key={a.account_id}
                active={selectedId === a.account_id}
                enabled={ok}
                title={a.name || a.account_id}
                subtitle={a.user_id}
                onClick={() => setSelectedId(a.account_id)}
              />
            );
          })}
        </MasterDetailSidebarPanel>

        {/* Right: Edit form */}
        <MasterDetailContentPanel>
          {!selected ? (
            <span className="minor-text">Select an account.</span>
          ) : (
            <>
              {/* Header */}
              <div>
                <input
                  value={form.name}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, name: e.target.value }))
                  }
                  placeholder={selected.account_id}
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    border: "none",
                    background: "transparent",
                    color: "inherit",
                    width: "100%",
                    outline: "none",
                    paddingLeft: 0,
                  }}
                />
                <span className="minor-text" style={{ fontSize: 11 }}>
                  ID: {selected.account_id}
                </span>
              </div>

              {/* User ID */}
              <div className="stack-layout" style={{ gap: 6 }}>
                <span className="panel-label" style={{ fontSize: 10 }}>
                  USER ID
                </span>
                <input
                  value={form.user_id}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, user_id: e.target.value }))
                  }
                />
              </div>

              {/* Name */}
              <div className="stack-layout" style={{ gap: 6 }}>
                <span className="panel-label" style={{ fontSize: 10 }}>
                  NAME
                </span>
                <input
                  value={form.name}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, name: e.target.value }))
                  }
                />
              </div>

              {/* Status */}
              <div className="stack-layout" style={{ gap: 6 }}>
                <span className="panel-label" style={{ fontSize: 10 }}>
                  STATUS
                </span>
                <InputComboSelect
                  value={form.status}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, status: e.target.value }))
                  }
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </InputComboSelect>
              </div>

              {/* Broker Connection */}
              <div className="stack-layout" style={{ gap: 10 }}>
                <span className="panel-label" style={{ fontSize: 10 }}>
                  BROKER
                </span>
                <div className="stack-layout" style={{ gap: 6 }}>
                  <span className="panel-label" style={{ fontSize: 10 }}>
                    TYPE
                  </span>
                  <InputComboSelect
                    value={form.broker_type}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, broker_type: e.target.value }))
                    }
                  >
                    <option value="MT5">MT5</option>
                    <option value="Ctrader">Ctrader</option>
                  </InputComboSelect>
                </div>
                <div className="stack-layout" style={{ gap: 6 }}>
                  <span className="panel-label" style={{ fontSize: 10 }}>
                    MODE
                  </span>
                  <InputComboSelect
                    value={form.broker_mode}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, broker_mode: e.target.value }))
                    }
                  >
                    <option value="Demo">Demo</option>
                    <option value="Paper">Paper</option>
                    <option value="Live">Live</option>
                  </InputComboSelect>
                </div>
                <div className="stack-layout" style={{ gap: 6 }}>
                  <span className="panel-label" style={{ fontSize: 10 }}>
                    LOGIN
                  </span>
                  <input
                    value={form.broker_login}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, broker_login: e.target.value }))
                    }
                    placeholder="12345678"
                  />
                </div>
                <div className="stack-layout" style={{ gap: 6 }}>
                  <span className="panel-label" style={{ fontSize: 10 }}>
                    PASSWORD
                  </span>
                  <SecretInput
                    value={form.broker_password}
                    onChange={(next) =>
                      setForm((p) => ({ ...p, broker_password: next }))
                    }
                    placeholder="Enter broker password"
                    secretName="Broker Password"
                    revealSecret={revealBrokerPassword}
                    onMessage={(text) => setPageMessage(String(text || ""))}
                  />
                </div>
                <div className="stack-layout" style={{ gap: 6 }}>
                  <span className="panel-label" style={{ fontSize: 10 }}>
                    SERVER
                  </span>
                  <input
                    value={form.broker_server}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, broker_server: e.target.value }))
                    }
                    placeholder="ICMarketsSC-Demo"
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    className="secondary-button"
                    onClick={handleCheckReadiness}
                    disabled={saving || readinessLoading}
                  >
                    {readinessLoading ? "CHECKING..." : "CHECK MT5 READINESS"}
                  </button>
                  {readinessResult && (
                    <span
                      className="minor-text"
                      style={{
                        fontSize: 11,
                        color: readinessResult.ready
                          ? "var(--success)"
                          : "var(--danger)",
                      }}
                    >
                      {readinessResult.message ||
                        (readinessResult.ready ? "Ready" : "Not ready")}
                    </span>
                  )}
                </div>
                {readinessResult &&
                  Array.isArray(readinessResult.blockers) &&
                  readinessResult.blockers.length > 0 && (
                    <div
                      className="minor-text"
                      style={{ fontSize: 11, lineHeight: 1.5 }}
                    >
                      {readinessResult.blockers.map((item, idx) => (
                        <div key={idx}>
                          - {item?.message || item?.code || "Unknown blocker"}
                        </div>
                      ))}
                    </div>
                  )}
              </div>

              {/* Metadata */}
              <div className="stack-layout" style={{ gap: 6 }}>
                <span className="panel-label" style={{ fontSize: 10 }}>
                  METADATA (JSON)
                </span>
                <textarea
                  rows={6}
                  style={{ fontFamily: "monospace", fontSize: 11 }}
                  value={form.metadata_json}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, metadata_json: e.target.value }))
                  }
                />
              </div>

              {/* API Key */}
              <div className="stack-layout" style={{ gap: 6 }}>
                <span className="panel-label" style={{ fontSize: 10 }}>
                  API KEY
                </span>
                <span className="minor-text" style={{ fontSize: 11 }}>
                  Account API key for broker/EA-facing account access. This is
                  separate from MT5 login credentials.
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    value={
                      apiKeyForm.reveal
                        ? apiKeyForm.plain
                        : apiKeyForm.last4
                          ? `••••${apiKeyForm.last4}`
                          : "No key"
                    }
                    readOnly
                    style={{ flex: 1 }}
                  />
                  <button
                    className="secondary-button"
                    onClick={handleGenerateKey}
                    disabled={saving}
                  >
                    Generate
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  paddingTop: 20,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <ToggleButton
                  active={isActive}
                  classActive="secondary-button"
                  classInActive="primary-button"
                  labelActive="DEACTIVATE"
                  labelInActive="ACTIVATE"
                  onClick={handleToggleStatus}
                  disabled={saving}
                />
                <button
                  className="danger-button"
                  onClick={handleArchive}
                  disabled={saving}
                >
                  ARCHIVE
                </button>
                <div style={{ flex: 1 }} />
                <button
                  className="primary-button"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "SAVING..." : "SAVE"}
                </button>
              </div>
            </>
          )}
        </MasterDetailContentPanel>
      </MasterDetailLayout>
    </div>
  );
}
