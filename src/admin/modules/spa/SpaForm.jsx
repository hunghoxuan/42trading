import { configs, statuses } from "./config";

export default function SpaForm({ entity, draft, data, onChange, onSave, onClose, saving, error }) {
  const config = configs[entity];
  return <section className="panel spa-editor" aria-label={`Biểu mẫu ${config.label}`}>
    <div className="spa-heading"><h2>{draft.id ? "Chỉnh sửa" : "Thêm"} {config.label.toLowerCase()}</h2><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Đóng</button></div>
    <form onSubmit={onSave} className="spa-form">
      {config.fields.filter(f => !f.homeOnly || draft.location === "home").map(f => {
        const id = `spa-${entity}-${f.key}`;
        const common = { id, name: f.key, required: !f.optional && f.type !== "checkbox", disabled: saving, value: draft[f.key] ?? "", onChange: e => onChange(f.key, e.target.value) };
        let options = data[f.source] || [];
        if (f.source) options = options.filter(row => row.is_active !== false || row.id === Number(draft[f.key]));
        if (f.source === "services" && draft.branch_id) options = options.filter(row => !row.branch_id || row.branch_id === Number(draft.branch_id) || row.id === Number(draft[f.key]));
        if (f.source === "treatment_plans") options = options.filter(row => (row.customer_id === Number(draft.customer_id) && row.service_id === Number(draft.service_id) && row.status === "active") || row.id === Number(draft[f.key]));
        return <div className={`form-item ${f.type === "textarea" ? "spa-field-wide" : ""}`} key={f.key}>
          <label htmlFor={id}>{f.label}{!f.optional && f.type !== "checkbox" ? " *" : ""}</label>
          {f.type === "reference" ? <select {...common}><option value="">{f.optional ? "Không chọn" : "Chọn…"}</option>{options.map(row => <option key={row.id} value={row.id}>{row.name}{row.phone ? ` · ${row.phone}` : ""}</option>)}</select>
            : f.type === "select" ? <select {...common}>{f.options.map(value => <option key={value} value={value}>{statuses[value]}</option>)}</select>
              : f.type === "textarea" ? <textarea {...common} rows={3} maxLength={4000} />
                : f.type === "checkbox" ? <input id={id} type="checkbox" checked={draft[f.key] === true} disabled={saving} onChange={e => onChange(f.key, e.target.checked)} />
                  : <input {...common} type={f.type} min={f.min} max={f.max ?? (f.type === "number" ? 1e12 : undefined)} step={f.type === "number" ? 1 : undefined} maxLength={f.type === "text" ? 4000 : undefined} />}
        </div>;
      })}
      {entity === "appointments" && <p className="minor-text spa-field-wide">Giờ Việt Nam (UTC+7). Nhân viên cần có lịch làm việc tại cơ sở phụ trách, bao gồm thời gian đi và về. Giá và hoa hồng lấy từ dịch vụ khi đặt ca. Ca hoàn thành/hủy được giữ nguyên lịch sử.</p>}
      {entity === "employees" && <p className="minor-text spa-field-wide">Khi đổi lương, chọn ngày áp dụng mới để lưu lịch sử. Cùng một ngày hiệu lực được xem là sửa mức lương của ngày đó.</p>}
      {entity === "work_logs" && <p className="minor-text spa-field-wide">Chọn “Đã làm” để ghi nhận giờ công. Nếu bỏ trống cả hai giờ thực tế, báo cáo dùng giờ dự kiến.</p>}
      {error && <p role="alert" className="msg-error spa-field-wide">{error}</p>}
      <div className="spa-form-actions spa-field-wide"><button className="primary-button" type="submit" disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</button><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Hủy</button></div>
    </form>
  </section>;
}
