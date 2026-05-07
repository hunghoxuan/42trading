import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, setRuntimeActiveUserId } from "../../api";
import UserDetailSection from "../../components/UserDetailSection";

const ROLE_OPTIONS = ["System", "Admin", "User", "Guest"];
const ACCOUNT_STATUS_OPTIONS = ["ACTIVE", "INACTIVE"];
const PAGE_SIZE_OPTIONS = [50, 100, 200];
const BULK_ACTIONS = ["", "Deactivate Selected", "Delete Selected"];

function byCreatedAsc(a, b) {
  const ad = String(a?.created_at || "");
  const bd = String(b?.created_at || "");
  if (ad === bd)
    return String(a?.user_id || "").localeCompare(String(b?.user_id || ""));
  return ad.localeCompare(bd);
}

import { showDateTime } from "../../utils/format";

function fDate(v) {
  return showDateTime(v);
}

function statusLabel(v) {
  const s = String(v || "")
    .trim()
    .toUpperCase();
  if (s === "TRUE") return "ACTIVE";
  if (s === "FALSE") return "INACTIVE";
  if (s === "DISABLE" || s === "DISABLED") return "INACTIVE";
  return s || "-";
}

export default function UsersPage({ authUser }) {
  const { userId } = useParams();
  const navigate = useNavigate();
  const EMPTY_ALERT = { type: "", text: "" };
  const [users, setUsers] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pageAlert, setPageAlert] = useState(EMPTY_ALERT);
  const [createUserAlert, setCreateUserAlert] = useState(EMPTY_ALERT);
  const [profileAlert, setProfileAlert] = useState(EMPTY_ALERT);
  const [accountAlert, setAccountAlert] = useState(EMPTY_ALERT);
  const [createUserErrors, setCreateUserErrors] = useState({});
  const [profileErrors, setProfileErrors] = useState({});
  const [accountErrors, setAccountErrors] = useState({});

  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [bulkAction, setBulkAction] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailMode, setDetailMode] = useState("view");
  const [checkedUserIds, setCheckedUserIds] = useState(new Set());

  const [createUserForm, setCreateUserForm] = useState({
    name: "",
    email: "",
    role: "User",
    password: "",
  });
  const [profileForm, setProfileForm] = useState({
    name: "",
    email: "",
    role: "User",
    is_active: true,
    password: "",
  });
  const [accountForm, setAccountForm] = useState({
    name: "",
    balance: "",
    status: ACCOUNT_STATUS_OPTIONS[0],
  });
  const [editingAccountId, setEditingAccountId] = useState("");
  const [accountFormOpen, setAccountFormOpen] = useState(false);

  const filteredUsers = useMemo(() => {
    const q = String(searchQuery || "")
      .trim()
      .toLowerCase();
    return [...users]
      .filter((u) => {
        if (roleFilter && String(u.role || "") !== roleFilter) return false;
        if (!q) return true;
        return (
          String(u.name || "")
            .toLowerCase()
            .includes(q) ||
          String(u.email || "")
            .toLowerCase()
            .includes(q) ||
          String(u.user_id || "")
            .toLowerCase()
            .includes(q)
        );
      })
      .sort(byCreatedAsc);
  }, [users, searchQuery, roleFilter]);

  const pages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const safePage = Math.max(1, Math.min(page, pages));
  const pageRows = filteredUsers.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const selectedUser = useMemo(
    () =>
      users.find((u) => String(u.user_id) === String(selectedUserId)) || null,
    [users, selectedUserId],
  );
  const isDefaultUser = String(selectedUser?.user_id || "") === "default";
  const isSelf =
    String(selectedUser?.user_id || "") === String(authUser?.user_id || "");

  async function loadUsers() {
    try {
      setLoadingUsers(true);
      const out = await api.listUsers();
      const rows = Array.isArray(out?.users) ? out.users : [];
      setUsers(rows);
      if (
        selectedUserId &&
        !rows.some((u) => String(u.user_id) === String(selectedUserId))
      )
        setSelectedUserId("");
      setPageAlert(EMPTY_ALERT);
    } catch (e) {
      setPageAlert({
        type: "error",
        text: e?.message || "Failed to load users",
      });
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadDetail(userId) {
    if (!userId) {
      setDetail(null);
      return;
    }
    try {
      setLoadingDetail(true);
      const out = await api.userDetail(userId);
      setDetail(out);
      const user = out?.user || {};
      setProfileForm({
        name: String(user.name || ""),
        email: String(user.email || ""),
        role: String(user.role || "User"),
        is_active: Boolean(user.is_active),
        password: "",
      });
      setEditingAccountId("");
      setAccountForm({
        name: "",
        balance: "",
        status: ACCOUNT_STATUS_OPTIONS[0],
      });
      setAccountFormOpen(false);
      setPageAlert(EMPTY_ALERT);
    } catch (e) {
      setPageAlert({
        type: "error",
        text: e?.message || "Failed to load user detail",
      });
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (userId && !selectedUserId) {
      setSelectedUserId(String(userId));
    }
  }, [userId, selectedUserId]);

  useEffect(() => {
    loadUsers();
  }, []);
  useEffect(() => {
    if (detailMode === "create") return;
    if (selectedUserId) loadDetail(selectedUserId);
    else setDetail(null);
  }, [selectedUserId, detailMode]);
  useEffect(() => {
    setPage(1);
  }, [searchQuery, roleFilter, pageSize]);

  function openCreateMode() {
    setDetailMode("create");
    setSelectedUserId("");
    setDetail(null);
    setCreateUserForm({ name: "", email: "", role: "User", password: "" });
    setPageAlert(EMPTY_ALERT);
    setCreateUserErrors({});
    setCreateUserAlert(EMPTY_ALERT);
  }

  function cancelCreateMode() {
    setDetailMode("view");
    setSelectedUserId("");
  }

  function openViewMode(userId) {
    setDetailMode("view");
    setSelectedUserId(String(userId || ""));
  }

  async function onCreateUser() {
    const payload = {
      name: String(createUserForm.name || "").trim(),
      email: String(createUserForm.email || "").trim(),
      role: String(createUserForm.role || "User"),
      password: String(createUserForm.password || ""),
    };
    const nextErrors = {};
    if (!payload.name) nextErrors.name = "Name is required.";
    if (!payload.email) nextErrors.email = "Email is required.";
    if (!payload.password) nextErrors.password = "Password is required.";
    if (Object.keys(nextErrors).length) {
      setCreateUserErrors(nextErrors);
      setCreateUserAlert({
        type: "error",
        text: "Please fix validation errors.",
      });
      return;
    }
    try {
      setSaving(true);
      setCreateUserErrors({});
      setCreateUserAlert(EMPTY_ALERT);
      const out = await api.createUser(payload);
      const createdUserId = String(out?.user?.user_id || "");
      setCreateUserAlert({ type: "success", text: "User created." });
      await loadUsers();
      if (createdUserId) openViewMode(createdUserId);
    } catch (e) {
      setCreateUserAlert({
        type: "error",
        text: e?.message || "Failed to create user",
      });
    } finally {
      setSaving(false);
      window.setTimeout(() => setCreateUserAlert(EMPTY_ALERT), 1800);
    }
  }

  async function onSaveProfile() {
    if (!selectedUser) return;
    const payload = {
      name: String(profileForm.name || "").trim(),
      email: String(profileForm.email || "").trim(),
      role: String(profileForm.role || "User"),
      is_active: Boolean(profileForm.is_active),
    };
    if (profileForm.password)
      payload.password = String(profileForm.password || "");
    const nextErrors = {};
    if (!payload.name) nextErrors.name = "Name is required.";
    if (!payload.email) nextErrors.email = "Email is required.";
    if (payload.password && payload.password.length < 8)
      nextErrors.password = "Password must be at least 8 characters.";
    if (Object.keys(nextErrors).length) {
      setProfileErrors(nextErrors);
      setProfileAlert({ type: "error", text: "Please fix validation errors." });
      return;
    }
    try {
      setSaving(true);
      setProfileErrors({});
      setProfileAlert(EMPTY_ALERT);
      await api.updateUser(selectedUser.user_id, payload);
      setProfileAlert({ type: "success", text: "User profile updated." });
      await loadUsers();
      await loadDetail(selectedUser.user_id);
    } catch (e) {
      setProfileAlert({
        type: "error",
        text: e?.message || "Failed to update user profile",
      });
    } finally {
      setSaving(false);
      window.setTimeout(() => setProfileAlert(EMPTY_ALERT), 1800);
    }
  }

  async function onDeactivateUser() {
    if (!selectedUser) return;
    if (
      !window.confirm(
        `Deactivate ${selectedUser.name || selectedUser.user_id}?`,
      )
    )
      return;
    try {
      setSaving(true);
      await api.deactivateUser(selectedUser.user_id);
      setProfileAlert({ type: "warning", text: "User deactivated." });
      await loadUsers();
      await loadDetail(selectedUser.user_id);
    } catch (e) {
      setProfileAlert({
        type: "error",
        text: e?.message || "Failed to deactivate user",
      });
    } finally {
      setSaving(false);
      window.setTimeout(() => setProfileAlert(EMPTY_ALERT), 1800);
    }
  }

  async function onApplyBulkAction() {
    if (!bulkAction) return;
    if (checkedUserIds.size === 0) {
      setPageAlert({ type: "warning", text: "Select at least one user." });
      return;
    }
    const ids = Array.from(checkedUserIds);
    if (
      !window.confirm(
        `Are you sure you want to ${bulkAction.toLowerCase()} ${ids.length} users?`,
      )
    )
      return;
    try {
      setSaving(true);
      for (const id of ids) {
        if (bulkAction === "Deactivate Selected") {
          await api.deactivateUser(id);
        } else if (bulkAction === "Delete Selected") {
          await api.deleteUser(id);
        }
      }
      setPageAlert({
        type: "success",
        text: `Successfully applied ${bulkAction} to ${ids.length} users.`,
      });
      setCheckedUserIds(new Set());
      setBulkAction("");
      await loadUsers();
      if (checkedUserIds.has(selectedUserId)) {
        setDetail(null);
        setSelectedUserId("");
      }
    } catch (e) {
      setPageAlert({ type: "error", text: e?.message || "Failed bulk action" });
    } finally {
      setSaving(false);
      window.setTimeout(() => setPageAlert(EMPTY_ALERT), 3000);
    }
  }

  function toggleCheck(id) {
    setCheckedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCheckAll() {
    if (checkedUserIds.size === pageRows.length && pageRows.length > 0) {
      setCheckedUserIds(new Set());
    } else {
      setCheckedUserIds(new Set(pageRows.map((u) => u.user_id)));
    }
  }

  function handleSwitchUser(e, u) {
    e.stopPropagation();
    setRuntimeActiveUserId(u.user_id);
    window.location.reload();
  }

  async function onSaveAccount() {
    if (!selectedUser) return;
    const payload = {
      name: String(accountForm.name || "").trim(),
      balance: accountForm.balance === "" ? null : Number(accountForm.balance),
      status: String(accountForm.status || ACCOUNT_STATUS_OPTIONS[0]).trim(),
    };
    const nextErrors = {};
    if (!payload.name) nextErrors.name = "Account name is required.";
    if (accountForm.balance !== "" && Number.isNaN(Number(accountForm.balance)))
      nextErrors.balance = "Balance must be a valid number.";
    if (Object.keys(nextErrors).length) {
      setAccountErrors(nextErrors);
      setAccountAlert({ type: "error", text: "Please fix validation errors." });
      return;
    }

    try {
      setSaving(true);
      setAccountErrors({});
      setAccountAlert(EMPTY_ALERT);
      if (editingAccountId) {
        await api.updateUserAccount(
          selectedUser.user_id,
          editingAccountId,
          payload,
        );
        setAccountAlert({ type: "success", text: "Account updated." });
      } else {
        await api.createUserAccount(selectedUser.user_id, payload);
        setAccountAlert({ type: "success", text: "Account created." });
      }
      setEditingAccountId("");
      setAccountForm({
        name: "",
        balance: "",
        status: ACCOUNT_STATUS_OPTIONS[0],
      });
      setAccountFormOpen(false);
      await loadDetail(selectedUser.user_id);
    } catch (e) {
      setAccountAlert({
        type: "error",
        text: e?.message || "Failed to save account",
      });
    } finally {
      setSaving(false);
      window.setTimeout(() => setAccountAlert(EMPTY_ALERT), 1800);
    }
  }

  async function onDeactivateAccount(account) {
    if (!selectedUser || !account) return;
    if (!window.confirm(`Deactivate account ${account.account_id}?`)) return;
    try {
      setSaving(true);
      await api.updateUserAccount(selectedUser.user_id, account.account_id, {
        name: String(account.name || account.account_id || ""),
        balance:
          account.balance === null || account.balance === undefined
            ? null
            : Number(account.balance),
        status: "INACTIVE",
      });
      setAccountAlert({ type: "warning", text: "Account deactivated." });
      await loadDetail(selectedUser.user_id);
    } catch (e) {
      setAccountAlert({
        type: "error",
        text: e?.message || "Failed to deactivate account",
      });
    } finally {
      setSaving(false);
      window.setTimeout(() => setAccountAlert(EMPTY_ALERT), 1800);
    }
  }

  return (
    <div className="stack-layout fadeIn">
      <h2 className="page-title">Users</h2>

      <div className="toolbar-panel">
        <div className="toolbar-group toolbar-pagination">
          {pages > 1 ? (
            <div className="pager-mini">
              <button
                className="secondary-button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                &lt;
              </button>
              <span className="minor-text">
                {safePage}/{pages}
              </span>
              <button
                className="secondary-button"
                disabled={safePage >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
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

        <div className="toolbar-group toolbar-search-filter">
          <input
            placeholder="SEARCH USER, EMAIL..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "220px" }}
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="">ALL ROLES</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-group toolbar-bulk-action">
          <select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
          >
            {BULK_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a || "BULK ACTION..."}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary-button"
            onClick={onApplyBulkAction}
            disabled={saving || !bulkAction}
          >
            APPLY
          </button>
        </div>
      </div>

      <div className="logs-layout-split">
        <div className="logs-list-pane">
          {pageAlert.text ? (
            <div
              className={`form-message msg-${pageAlert.type || "error"}`}
              style={{ padding: 10 }}
            >
              {pageAlert.text}
            </div>
          ) : null}
          <div className="events-table-wrap">
            <table className="events-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={
                        pageRows.length > 0 &&
                        checkedUserIds.size === pageRows.length
                      }
                      onChange={toggleCheckAll}
                    />
                  </th>
                  <th>NAME</th>
                  <th>EMAIL</th>
                  <th>ROLE</th>
                  <th>STATUS</th>
                  {authUser?.role === "System" && (
                    <th style={{ textAlign: "right" }}>ACTIONS</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {loadingUsers ? (
                  <tr>
                    <td colSpan={4} className="loading">
                      Loading users...
                    </td>
                  </tr>
                ) : (
                  pageRows.map((u) => (
                    <tr
                      key={u.user_id}
                      className={
                        String(u.user_id) === String(selectedUserId) &&
                        detailMode !== "create"
                          ? "active"
                          : ""
                      }
                      onClick={() => {
                        openViewMode(u.user_id);
                        navigate(`/system/users/${u.user_id}`);
                      }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checkedUserIds.has(u.user_id)}
                          onChange={() => toggleCheck(u.user_id)}
                        />
                      </td>
                      <td>
                        <div className="cell-wrap">
                          <div className="cell-major">
                            {u.name || u.user_id}
                          </div>
                          <div className="cell-minor">{u.user_id}</div>
                        </div>
                      </td>
                      <td className="cell-minor">{u.email || "-"}</td>
                      <td>
                        <span className="badge">{u.role || "User"}</span>
                      </td>
                      <td>
                        <span
                          className={`badge ${u.is_active ? "ACTIVE" : "INACTIVE"}`}
                        >
                          {u.is_active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      {authUser?.role === "System" && (
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className="secondary-button"
                            style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                            onClick={(e) => handleSwitchUser(e, u)}
                          >
                            Switch User
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div
            style={{
              padding: "10px 12px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (detailMode === "create") cancelCreateMode();
                else openCreateMode();
              }}
              disabled={saving}
            >
              {detailMode === "create" ? "CANCEL" : "CREATE USER"}
            </button>
          </div>
        </div>

        <div className="logs-detail-pane">
          {detailMode === "create" ? (
            <div className="stack-layout">
              <UserDetailSection
                title="USER FORM"
                form={createUserForm}
                setForm={(updater) => {
                  setCreateUserForm((prev) =>
                    typeof updater === "function" ? updater(prev) : updater,
                  );
                  setCreateUserErrors({});
                  if (createUserAlert.type === "error")
                    setCreateUserAlert(EMPTY_ALERT);
                }}
                roleOptions={ROLE_OPTIONS}
                showActive={false}
                passwordLabel="Password"
                primaryLabel="💾 SAVE USER"
                onPrimary={onCreateUser}
                primaryDisabled={saving}
                fieldErrors={createUserErrors}
                formMessage={createUserAlert}
                secondaryLabel="✖ CANCEL"
                onSecondary={cancelCreateMode}
                secondaryDisabled={saving}
              />
            </div>
          ) : !selectedUser ? (
            <div className="empty-state minor-text">
              SELECT A USER TO INSPECT DETAIL
            </div>
          ) : loadingDetail ? (
            <div className="loading">Loading user detail...</div>
          ) : (
            <div className="stack-layout">
              <UserDetailSection
                title="USER DETAIL"
                form={profileForm}
                setForm={(updater) => {
                  setProfileForm((prev) =>
                    typeof updater === "function" ? updater(prev) : updater,
                  );
                  setProfileErrors({});
                  if (profileAlert.type === "error")
                    setProfileAlert(EMPTY_ALERT);
                }}
                roleOptions={ROLE_OPTIONS}
                disableRole={isDefaultUser}
                disableActive={isDefaultUser || isSelf}
                primaryLabel="💾 SAVE USER"
                onPrimary={onSaveProfile}
                primaryDisabled={saving}
                fieldErrors={profileErrors}
                formMessage={profileAlert}
                secondaryLabel="⏸ DEACTIVATE"
                onSecondary={onDeactivateUser}
                secondaryDisabled={
                  saving || isDefaultUser || isSelf || !selectedUser.is_active
                }
                secondaryDanger
              />

              <div className="panel" style={{ margin: 0 }}>
                <div className="panel-label">ACCOUNT MANAGEMENT</div>
                <div className="stack-layout" style={{ gap: 10 }}>
                  <div>
                    {accountFormOpen ? (
                      <div
                        style={{
                          display: "grid",
                          gap: 10,
                          gridTemplateColumns: "1fr 1fr 1fr",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          <div className="minor-text">Name</div>
                          <input
                            placeholder="Friendly Name"
                            value={accountForm.name}
                            onChange={(e) => {
                              setAccountForm((p) => ({
                                ...p,
                                name: e.target.value,
                              }));
                              setAccountErrors((p) => ({ ...p, name: "" }));
                              if (accountAlert.type === "error")
                                setAccountAlert(EMPTY_ALERT);
                            }}
                          />
                          {accountErrors.name ? (
                            <div className="field-validation msg-error">
                              {accountErrors.name}
                            </div>
                          ) : null}
                        </label>
                        <label
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          <div className="minor-text">Balance</div>
                          <input
                            placeholder="0.00"
                            value={accountForm.balance}
                            onChange={(e) => {
                              setAccountForm((p) => ({
                                ...p,
                                balance: e.target.value,
                              }));
                              setAccountErrors((p) => ({ ...p, balance: "" }));
                              if (accountAlert.type === "error")
                                setAccountAlert(EMPTY_ALERT);
                            }}
                          />
                          {accountErrors.balance ? (
                            <div className="field-validation msg-error">
                              {accountErrors.balance}
                            </div>
                          ) : null}
                        </label>
                        <label
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          <div className="minor-text">Status</div>
                          <select
                            value={accountForm.status}
                            onChange={(e) =>
                              setAccountForm((p) => ({
                                ...p,
                                status: e.target.value,
                              }))
                            }
                          >
                            {ACCOUNT_STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}
                  </div>
                  {accountFormOpen ? (
                    <>
                      {editingAccountId ? (
                        <div
                          className="cell-wrap"
                          style={{ marginTop: "-4px" }}
                        >
                          <div className="minor-text">
                            User ID: {selectedUser?.user_id || "-"}
                          </div>
                          <div className="minor-text">
                            Account ID: {editingAccountId}
                          </div>
                        </div>
                      ) : null}
                      {accountAlert.text ? (
                        <div
                          className={`form-message msg-${accountAlert.type || "error"}`}
                        >
                          {accountAlert.text}
                        </div>
                      ) : null}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={onSaveAccount}
                          disabled={saving}
                          style={{ padding: "8px 16px" }}
                        >
                          💾 SAVE ACCOUNT
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setAccountFormOpen(false);
                            setEditingAccountId("");
                            setAccountForm({
                              name: "",
                              balance: "",
                              status: ACCOUNT_STATUS_OPTIONS[0],
                            });
                            setAccountErrors({});
                          }}
                          disabled={saving}
                        >
                          ✖ CANCEL
                        </button>
                      </div>
                    </>
                  ) : null}

                  <div className="events-table-wrap" style={{ maxHeight: 220 }}>
                    <table className="events-table">
                      <thead>
                        <tr>
                          <th>ACCOUNT</th>
                          <th>BALANCE</th>
                          <th>STATUS</th>
                          <th style={{ textAlign: "right" }}>ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail?.accounts || []).map((a) => (
                          <tr key={a.account_id}>
                            <td>
                              <div className="cell-wrap">
                                <div className="cell-major">
                                  {a.name || a.account_id}
                                </div>
                                <div className="cell-minor">{a.account_id}</div>
                              </div>
                            </td>
                            <td className="cell-minor">
                              {a.balance === null || a.balance === undefined
                                ? "-"
                                : Number(a.balance).toLocaleString()}
                            </td>
                            <td>
                              <span
                                className={`badge ${statusLabel(a.status)}`}
                              >
                                {statusLabel(a.status)}
                              </span>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <button
                                type="button"
                                className="secondary-button icon-button"
                                title="Edit account"
                                aria-label="Edit account"
                                style={{ padding: "4px 10px" }}
                                onClick={() => {
                                  setEditingAccountId(
                                    String(a.account_id || ""),
                                  );
                                  setAccountFormOpen(true);
                                  setAccountForm({
                                    name: String(a.name || ""),
                                    balance:
                                      a.balance === null ||
                                      a.balance === undefined
                                        ? ""
                                        : String(a.balance),
                                    status: String(
                                      a.status || ACCOUNT_STATUS_OPTIONS[0],
                                    ),
                                  });
                                }}
                              >
                                ✏
                              </button>
                              <button
                                type="button"
                                className="danger-button icon-button"
                                title="Deactivate account"
                                aria-label="Deactivate account"
                                style={{ padding: "4px 10px", marginLeft: 6 }}
                                onClick={() => onDeactivateAccount(a)}
                              >
                                ⏸
                              </button>
                            </td>
                          </tr>
                        ))}
                        {(detail?.accounts || []).length === 0 ? (
                          <tr>
                            <td colSpan={4} className="minor-text">
                              No accounts yet.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ paddingTop: 2 }}>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        if (accountFormOpen) {
                          setAccountFormOpen(false);
                          setEditingAccountId("");
                          setAccountForm({
                            name: "",
                            balance: "",
                            status: ACCOUNT_STATUS_OPTIONS[0],
                          });
                          setAccountErrors({});
                        } else {
                          setAccountFormOpen(true);
                          setEditingAccountId("");
                          setAccountForm({
                            name: "",
                            balance: "",
                            status: ACCOUNT_STATUS_OPTIONS[0],
                          });
                          setAccountErrors({});
                          if (accountAlert.type === "error")
                            setAccountAlert(EMPTY_ALERT);
                        }
                      }}
                      disabled={saving}
                    >
                      {accountFormOpen ? "✖ CANCEL" : "＋ CREATE ACCOUNT"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="minor-text">
                User created: {fDate(detail?.user?.created_at)} | updated:{" "}
                {fDate(detail?.user?.updated_at)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
