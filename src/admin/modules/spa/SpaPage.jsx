import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../app/api";
import { hasPermission } from "../../shared/utils/permissions";
import ResponsivePanel from "../../shared/components/ResponsivePanel";
import SpaForm from "./SpaForm";
import { configs, extraLabels, localInput, newDraft, reportRange, statuses, today } from "./config";
import "./SpaPage.css";

const money = value => `${Number(value || 0).toLocaleString("vi-VN")} đ`;
const displayTime = value => value ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
const moneyKeys = new Set(["base_salary", "onsite_price", "home_price", "onsite_commission", "home_commission", "service_price", "commission", "travel_fee", "travel_allowance", "total"]);
const sourceFor = { branch_id: "branches", employee_id: "employees", customer_id: "customers", service_id: "services", treatment_plan_id: "treatment_plans" };
const PAGE_SIZE = 15;

function downloadPayroll(report) {
  const keys = ["sid", "name", "worked_hours", "onsite_sessions", "home_sessions", "base_salary", "commission", "travel_allowance", "total"];
  const escape = value => `"${String(value ?? "").replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
  const header = ["Mã nhân viên", "Nhân viên", "Giờ công", "Ca cơ sở", "Ca tại nhà", "Lương cứng phân bổ", "Hoa hồng", "Hỗ trợ đi lại", "Tổng tạm tính"];
  const csv = [header, ...report.payroll.map(row => keys.map(key => row[key]))].map(row => row.map(escape).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `spa-luong-tam-tinh-${report.from}-${report.to}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SpaPage({ authUser }) {
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("");
  const [dateFilter, setDateFilter] = useState(today());
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState("month");
  const [anchor, setAnchor] = useState(today());
  const [report, setReport] = useState(null);
  const [reportError, setReportError] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportVersion, setReportVersion] = useState(0);
  const loadVersion = useRef(0);
  const canWrite = hasPermission(authUser, "apis.spa.write");
  const range = useMemo(() => reportRange(anchor, period), [anchor, period]);

  async function load() {
    const version = ++loadVersion.current;
    setLoading(true); setError("");
    try {
      const result = await api.spaBootstrap();
      if (version === loadVersion.current) setData(result.data || {});
    } catch (e) { if (version === loadVersion.current) setError(e.message || "Không thể tải dữ liệu"); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }
  useEffect(() => { load(); return () => { loadVersion.current++; }; }, []);
  useEffect(() => {
    if (tab !== "reports") return;
    let cancelled = false;
    setReportLoading(true); setReportError(""); setReport(null);
    api.spaReport(range.from, range.to).then(result => { if (!cancelled) setReport(result); }).catch(e => { if (!cancelled) setReportError(e.message); }).finally(() => { if (!cancelled) setReportLoading(false); });
    return () => { cancelled = true; };
  }, [tab, range.from, range.to, reportVersion]);
  useEffect(() => { setPage(1); }, [tab, search, branch, dateFilter]);

  function switchTab(value) {
    if (saving) return;
    setTab(value); setDraft(null); setFormError(""); setSearch(""); setNotice("");
  }
  function edit(row) {
    const next = row ? { ...row } : newDraft(tab);
    for (const f of configs[tab].fields) if (f.type === "datetime-local" && row) next[f.key] = localInput(row[f.key]);
    setDraft(next); setFormError(""); setNotice("");
  }
  function changeField(key, value) {
    setDraft(current => {
      const next = { ...current, [key]: value };
      if (tab === "appointments" && ["customer_id", "service_id"].includes(key)) next.treatment_plan_id = "";
      if (tab === "appointments" && ["service_id", "starts_at"].includes(key)) {
        const service = data.services?.find(s => s.id === Number(next.service_id));
        if (service && next.starts_at) next.ends_at = localInput(new Date(Date.parse(`${next.starts_at}+07:00`) + service.duration_minutes * 60000).toISOString());
      }
      if (tab === "appointments" && key === "customer_id" && next.location === "home") next.address = data.customers?.find(c => c.id === Number(value))?.address || "";
      if (tab === "appointments" && key === "location" && value === "home" && !next.address) next.address = data.customers?.find(c => c.id === Number(next.customer_id))?.address || "";
      return next;
    });
  }
  async function save(event) {
    event.preventDefault(); setSaving(true); setFormError("");
    try {
      const payload = { ...draft };
      for (const f of configs[tab].fields) {
        if (f.type === "datetime-local") payload[f.key] = draft[f.key] ? new Date(`${draft[f.key]}+07:00`).toISOString() : "";
        if (f.type === "number") payload[f.key] = Number(draft[f.key] || 0);
      }
      await api.spaSave(tab, payload, draft.id);
      setDraft(null); setNotice("Đã lưu dữ liệu."); setReportVersion(v => v + 1);
      await load();
    } catch (e) { setFormError(e.message || "Không thể lưu dữ liệu"); }
    finally { setSaving(false); }
  }
  function label(key) { return configs[tab]?.fields.find(f => f.key === key)?.label || extraLabels[key] || key; }
  function value(key, row) {
    if (sourceFor[key]) return data[sourceFor[key]]?.find(r => r.id === row[key])?.name || (key === "branch_id" ? "Toàn chuỗi" : "—");
    if (moneyKeys.has(key)) return money(row[key]);
    if (key.endsWith("_at")) return displayTime(row[key]);
    if (key === "is_active") return row[key] ? "Đang hoạt động" : "Ngừng hoạt động";
    if (key === "status" || key === "location") return statuses[row[key]] || row[key];
    return row[key] === "" || row[key] == null ? "—" : String(row[key]);
  }
  const rows = useMemo(() => {
    const columns = configs[tab]?.columns || [];
    return (data[tab] || []).filter(row => {
      if (branch && row.branch_id && row.branch_id !== Number(branch)) return false;
      if (["appointments", "work_logs"].includes(tab) && dateFilter && localInput(row.starts_at).slice(0, 10) !== dateFilter) return false;
      const haystack = [row.sid, ...columns.map(key => value(key, row))].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return haystack.includes(search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
    }).sort((a, b) => a.starts_at && b.starts_at ? a.starts_at.localeCompare(b.starts_at) : b.id - a.id);
  }, [data, tab, branch, dateFilter, search]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pageCount);
  const tabs = [{ key: "overview", label: "Tổng quan" }, ...Object.entries(configs).map(([key, config]) => ({ key, label: config.label })), { key: "reports", label: "Báo cáo & lương" }];
  const todaysVisits = (data.appointments || []).filter(a => localInput(a.starts_at).slice(0, 10) === today());
  const todaysLogs = (data.work_logs || []).filter(a => localInput(a.starts_at).slice(0, 10) === today());

  return <main className="spa-module">
    <div className="spa-heading"><div><h1>Spa · Vật lý trị liệu</h1><p className="minor-text">Quản lý toàn chuỗi · Giờ Việt Nam · VND</p></div><button type="button" className="secondary-button" disabled={loading || saving} onClick={() => { load(); setReportVersion(v => v + 1); }}>Tải lại</button></div>
    <nav className="spa-tabs" aria-label="Chức năng Spa">{tabs.map(item => <button key={item.key} type="button" disabled={saving} aria-current={tab === item.key ? "page" : undefined} className={`secondary-button ${tab === item.key ? "active" : ""}`} onClick={() => switchTab(item.key)}>{item.label}</button>)}</nav>
    {error && <div role="alert" className="panel msg-error">{error}<button type="button" className="secondary-button" onClick={load}>Thử lại</button></div>}
    {notice && <p role="status" className="money-pos">{notice}</p>}
    {loading && <p role="status">Đang tải dữ liệu…</p>}

    {tab === "overview" && <>
      <div className="spa-stats">{[["Cơ sở hoạt động", (data.branches || []).filter(b => b.is_active).length], ["Nhân viên hoạt động", (data.employees || []).filter(e => e.is_active).length], ["Khách hàng", data.customers?.length || 0], ["Lịch hẹn hôm nay", todaysVisits.filter(a => a.status !== "cancelled").length]].map(([title, count]) => <div className="card-dense" key={title}><span className="minor-text">{title}</span><strong>{count}</strong></div>)}</div>
      <ResponsivePanel title="Bắt đầu sử dụng" showToggle={false}><p>Tạo cơ sở → dịch vụ và giá → nhân viên → khách hàng → lịch làm việc → lịch hẹn. Sau khi phục vụ, cập nhật ca hoàn thành và nhật ký “Đã làm”.</p><div className="spa-quick-actions">{["branches", "services", "employees", "customers", "work_logs", "appointments"].map(key => <button type="button" className="secondary-button" key={key} onClick={() => switchTab(key)}>{configs[key].label} ({data[key]?.length || 0})</button>)}</div></ResponsivePanel>
      <ResponsivePanel title={`Công việc hôm nay · ${today()}`} showToggle={false}><p>{todaysLogs.length} lịch làm việc · {todaysVisits.filter(a => a.location === "home" && a.status !== "cancelled").length} ca tại nhà · {todaysVisits.filter(a => a.status === "completed").length} ca hoàn thành.</p>{todaysVisits.length === 0 ? <p className="minor-text">Chưa có lịch hẹn hôm nay.</p> : <div className="spa-table-scroll"><table className="table-dense"><thead><tr><th>Thời gian</th><th>Khách hàng</th><th>Nhân viên</th><th>Địa điểm</th><th>Trạng thái</th></tr></thead><tbody>{todaysVisits.sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map(row => <tr key={row.id}>{["starts_at", "customer_id", "employee_id", "location", "status"].map(key => <td key={key}>{value(key, row)}</td>)}</tr>)}</tbody></table></div>}</ResponsivePanel>
    </>}

    {configs[tab] && <>
      <div className="toolbar-panel spa-toolbar">
        <label>Tìm kiếm<input aria-label="Tìm kiếm" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tên, mã, số điện thoại…" /></label>
        {["employees", "services", "work_logs", "appointments"].includes(tab) && <label>Cơ sở<select aria-label="Lọc cơ sở" value={branch} onChange={e => setBranch(e.target.value)}><option value="">Tất cả cơ sở</option>{data.branches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        {["appointments", "work_logs"].includes(tab) && <><label>Ngày<input aria-label="Lọc ngày" type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} /></label><button type="button" className="secondary-button" onClick={() => setDateFilter("")}>Tất cả ngày</button></>}
        {canWrite && <button type="button" className="primary-button" disabled={loading || saving || Boolean(draft)} onClick={() => edit(null)}>Thêm mới</button>}
      </div>
      {draft && <SpaForm entity={tab} draft={draft} data={data} onChange={changeField} onSave={save} onClose={() => { setDraft(null); setFormError(""); }} saving={saving} error={formError} />}
      <section className="panel" aria-label={configs[tab].label}><div className="spa-table-scroll"><table className="table-dense"><thead><tr><th>Mã</th>{configs[tab].columns.map(key => <th key={key}>{label(key)}</th>)}{canWrite && <th>Thao tác</th>}</tr></thead><tbody>
        {rows.slice((visiblePage - 1) * PAGE_SIZE, visiblePage * PAGE_SIZE).map(row => <tr key={row.id}><td><span title={row.sid} className="spa-sid">{row.sid.slice(0, 12)}</span></td>{configs[tab].columns.map(key => <td key={key} className={moneyKeys.has(key) ? "spa-number" : ""}>{value(key, row)}</td>)}{canWrite && <td><button type="button" className="secondary-button" disabled={saving || (tab === "appointments" && ["completed", "cancelled"].includes(row.status))} onClick={() => edit(row)}>Sửa</button></td>}</tr>)}
        {rows.length === 0 && <tr><td colSpan={configs[tab].columns.length + (canWrite ? 2 : 1)} className="spa-empty">{loading ? "Đang tải…" : "Chưa có dữ liệu phù hợp. Dùng “Thêm mới” để bắt đầu."}</td></tr>}
      </tbody></table></div><div className="pager-area spa-pager"><span>{rows.length} bản ghi · Trang {visiblePage}/{pageCount}</span><button type="button" className="secondary-button" disabled={visiblePage <= 1} onClick={() => setPage(visiblePage - 1)}>Trước</button><button type="button" className="secondary-button" disabled={visiblePage >= pageCount} onClick={() => setPage(visiblePage + 1)}>Sau</button></div></section>
    </>}

    {tab === "reports" && <>
      <div className="toolbar-panel spa-toolbar"><label>Kỳ báo cáo<select value={period} onChange={e => setPeriod(e.target.value)}><option value="week">Tuần (thứ hai – chủ nhật)</option><option value="month">Tháng</option></select></label><label>Ngày trong kỳ<input type="date" value={anchor} required onChange={e => { if (e.target.value) setAnchor(e.target.value); }} /></label><span>{range.from} → {range.to} · Toàn chuỗi</span><button type="button" className="secondary-button" disabled={!report || reportLoading} onClick={() => downloadPayroll(report)}>Xuất lương CSV</button></div>
      {reportError && <p className="msg-error" role="alert">{reportError}</p>}
      {reportLoading && <p role="status">Đang tính báo cáo…</p>}
      {report && <><div className="spa-stats">{[["Lịch hẹn", report.summary.appointments], ["Ca hoàn thành", report.summary.completed], ["Giá trị dịch vụ thực hiện", money(report.summary.service_revenue)], ["Phí đi lại thu khách", money(report.summary.travel_fees)], ["Tổng lương tạm tính", money(report.summary.payroll_total)]].map(([title, count]) => <div className="card-dense" key={title}><span className="minor-text">{title}</span><strong>{count}</strong></div>)}</div><section className="panel"><h2>Bảng lương tạm tính</h2><p className="minor-text">{report.salary_policy}</p><p className="minor-text">Giờ công chỉ tính nhật ký “Đã làm”; khi không nhập giờ thực tế sẽ dùng giờ dự kiến. Giá trị dịch vụ là giá niêm yết được lưu của các ca hoàn thành, chưa phải số tiền đã thu.</p><div className="spa-table-scroll"><table className="table-dense"><thead><tr>{["Nhân viên", "Giờ công", "Ca cơ sở", "Ca tại nhà", "Lương cứng phân bổ", "Hoa hồng", "Hỗ trợ đi lại", "Tổng tạm tính"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{report.payroll.map(row => <tr key={row.employee_id}><td>{row.name}</td>{["worked_hours", "onsite_sessions", "home_sessions", "base_salary", "commission", "travel_allowance", "total"].map(key => <td key={key} className="spa-number">{moneyKeys.has(key) ? money(row[key]) : row[key]}</td>)}</tr>)}{!report.payroll.length && <tr><td colSpan={8} className="spa-empty">Chưa có nhân viên.</td></tr>}</tbody><tfoot><tr><th colSpan={7}>Tổng toàn chuỗi</th><th className="spa-number">{money(report.summary.payroll_total)}</th></tr></tfoot></table></div></section></>}
    </>}
  </main>;
}
