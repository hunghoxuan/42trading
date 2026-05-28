import { useEffect, useState } from "react";
import { api } from "../../api";
import { showToast } from "../../components/ToastContainer";
import MasterDetailLayout from "../../components/MasterDetailLayout";
import SidebarListItem from "../../components/SidebarListItem";
import { useConfirmDialog } from "../../components/ConfirmDialog";

export default function AccountsV2Page() {
  const confirm = useConfirmDialog();
  const [accounts, setAccounts] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState("");

  const [form, setForm] = useState({
    account_id: "",
    user_id: "default",
    name: "",
    status: "ACTIVE",
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
      showToast({ message: e?.message || "Load failed", type: "error" });
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
        metadata_json: JSON.stringify(selected.metadata || {}, null, 2),
      });
      setApiKeyForm({ plain: "", last4: selected.api_key_last4 || "", reveal: false });
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
        metadata,
      });
      showToast({ message: "Saved", type: "success" });
      load();
    } catch (e) {
      showToast({ message: e?.message || "Save failed", type: "error" });
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
      showToast({ message: `Account ${newStatus}`, type: "success" });
      load();
    } catch (e) {
      showToast({ message: e?.message || "Toggle failed", type: "error" });
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
      showToast({ message: "Account archived.", type: "success" });
      setSelectedId("");
      load();
    } catch (e) {
      showToast({ message: e?.message || "Archive failed", type: "error" });
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
      setApiKeyForm({ plain, last4: plain ? plain.slice(-4) : "", reveal: true });
      showToast({ message: "Key generated", type: "success" });
    } catch (e) {
      showToast({ message: e?.message || "Failed", type: "error" });
    } finally {
      setSaving(false);
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

  return (
    <div className="stack-layout fadeIn" style={{ paddingBottom: 40 }}>
      <h2 className="page-title">Accounts</h2>

      <MasterDetailLayout>
        {/* Left: Account list */}
        <div className="panel stack-layout" style={{ gap: 2, padding: 12 }}>
          <div className="panel-label" style={{ marginBottom: 8 }}>
            ACCOUNTS
          </div>
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
        </div>

        {/* Right: Edit form */}
        <div className="panel stack-layout" style={{ gap: 16, padding: 24 }}>
          {!selected ? (
            <span className="minor-text">Select an account.</span>
          ) : (
            <>
              {/* Header */}
              <div>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder={selected.account_id}
                  style={{ fontSize: 16, fontWeight: 700, border: "none", background: "transparent", color: "inherit", width: "100%", outline: "none", paddingLeft: 0 }}
                />
                <span className="minor-text" style={{ fontSize: 11 }}>ID: {selected.account_id}</span>
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
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, status: e.target.value }))
                  }
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
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
                <div
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
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
                    style={{ padding: "6px 12px", fontSize: 11 }}
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
                <button
                  className={
                    isActive ? "secondary-button" : "primary-button"
                  }
                  style={{ padding: "12px 24px", fontSize: 14 }}
                  onClick={handleToggleStatus}
                  disabled={saving}
                >
                  {isActive ? "DEACTIVATE" : "ACTIVATE"}
                </button>
                <button
                  className="danger-button"
                  style={{ padding: "12px 24px", fontSize: 14 }}
                  onClick={handleArchive}
                  disabled={saving}
                >
                  ARCHIVE
                </button>
                <div style={{ flex: 1 }} />
                <button
                  className="primary-button"
                  style={{ padding: "12px 32px", fontSize: 14 }}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "SAVING..." : "SAVE"}
                </button>
              </div>
            </>
          )}
        </div>
      </MasterDetailLayout>
    </div>
  );
}
