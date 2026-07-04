import React from "react";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import InputComboSelect from "../../../shared/components/InputComboSelect";

export default function UserDetailSection({
  title,
  form,
  setForm,
  roleOptions = [],
  showRole = true,
  showActive = true,
  showPassword = true,
  disableRole = false,
  disableActive = false,
  passwordLabel = "New Password (optional)",
  primaryLabel = "💾 SAVE",
  onPrimary,
  primaryDisabled = false,
  secondaryLabel = "",
  onSecondary,
  secondaryDisabled = false,
  secondaryDanger = false,
  fieldErrors = {},
  formMessage = null,
  footer = null,
}) {
  return (
    <ResponsivePanel
      title={title}
      style={{ margin: 0, width: "100%" }}
      bodyClassName="stack-layout"
    >
      <div className="stack-layout" style={{ gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div className="minor-text">Name</div>
          <input 
            value={form.name || ""} 
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} 
            style={{ width: '100%', maxWidth: '400px' }}
          />
          {fieldErrors.name ? <div className="field-validation msg-error">{fieldErrors.name}</div> : null}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div className="minor-text">Email</div>
          <input 
            value={form.email || ""} 
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} 
            style={{ width: '100%', maxWidth: '400px' }}
          />
          {fieldErrors.email ? <div className="field-validation msg-error">{fieldErrors.email}</div> : null}
        </label>

        {showRole ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div className="minor-text">Primary Role</div>
            <InputComboSelect 
              value={Array.isArray(form.roles) && form.roles.length > 0 ? form.roles[0] : "buyer"} 
              onChange={(e) => setForm((p) => ({ ...p, roles: [e.target.value] }))} 
              disabled={disableRole}
              style={{ width: '100%', maxWidth: '400px' }}
            >
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </InputComboSelect>
          </label>
        ) : null}

        {showPassword ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div className="minor-text">{passwordLabel}</div>
            <input
              type="password"
              value={form.password || ""}
              onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              placeholder="Leave empty to keep current"
              style={{ width: '100%', maxWidth: '400px' }}
            />
            {fieldErrors.password ? <div className="field-validation msg-error">{fieldErrors.password}</div> : null}
          </label>
        ) : null}

        {showActive ? (
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={Boolean(form.is_active)}
              onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
              disabled={disableActive}
            />
            <span className="minor-text">Active Account</span>
          </label>
        ) : null}

        {formMessage?.text ? <div className={`form-message msg-${formMessage.type || "error"}`}>{formMessage.text}</div> : null}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="primary-button" onClick={onPrimary} disabled={primaryDisabled}>{primaryLabel}</button>
          {secondaryLabel ? (
            <button
              type="button"
              className={secondaryDanger ? "danger-button" : "secondary-button"}
              onClick={onSecondary}
              disabled={secondaryDisabled}
              style={secondaryDanger ? undefined : undefined}
            >
              {secondaryLabel}
            </button>
          ) : null}
        </div>

        {footer}
      </div>
    </ResponsivePanel>
  );
}
