"use strict";

const { randomUUID } = require("node:crypto");
const { createSpaRepository, definitions } = require("./repo");

class SpaError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = message => { throw new SpaError(message); };
const text = (value, max = 4000) => String(value ?? "").trim().slice(0, max);
function amount(value, label = "Số tiền") {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1e12) fail(`${label} phải là số nguyên VND không âm (tối đa 1.000 tỷ)`);
  return n;
}
function integer(value, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) fail(`${label} phải từ ${min} đến ${max}`);
  return n;
}
function date(value, optional = false) {
  if (!value && optional) return "";
  const s = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) fail("Ngày không hợp lệ");
  return s;
}
function instant(value, optional = false) {
  if (!value && optional) return "";
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(String(value))) fail("Thời gian cần có múi giờ");
  const n = Date.parse(value);
  if (!Number.isFinite(n)) fail("Thời gian không hợp lệ");
  return new Date(n).toISOString();
}
function choice(value, values) {
  if (!values.includes(value)) fail(`Trạng thái không hợp lệ: ${value}`);
  return value;
}
const dayInVietnam = value => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const nextDay = day => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const overlaps = (a, b, c, d) => Date.parse(a) < Date.parse(d) && Date.parse(c) < Date.parse(b);
function occupied(row) {
  const travel = row.location === "home" ? row.travel_minutes * 60000 : 0;
  return [new Date(Date.parse(row.starts_at) - travel).toISOString(), new Date(Date.parse(row.ends_at) + travel).toISOString()];
}

function createSpaService(options = {}) {
  const repo = options.repo || createSpaRepository(options);
  const entities = Object.keys(definitions).filter(name => name !== "salary_rates");
  const now = () => (options.now ? new Date(options.now()) : new Date()).toISOString();

  async function reference(tx, name, id, requireActive = false) {
    const key = Number(id);
    if (!Number.isSafeInteger(key) || key <= 0) fail("Vui lòng chọn đủ thông tin liên kết");
    const row = await tx.get(name, key);
    if (!row) fail("Thông tin liên kết không tồn tại");
    if (requireActive && row.is_active === false) fail("Thông tin đã ngừng hoạt động");
    return row;
  }

  async function validate(tx, entity, input, previous) {
    const row = {};
    for (const key of Object.keys(definitions[entity])) row[key] = input[key] ?? previous?.[key] ?? "";
    if (Object.hasOwn(row, "name")) {
      row.name = text(row.name, 200);
      if (!row.name) fail("Tên không được để trống");
    }
    if (Object.hasOwn(row, "is_active")) {
      if (row.is_active === "") row.is_active = true;
      if (typeof row.is_active !== "boolean") fail("Trạng thái hoạt động không hợp lệ");
    }
    for (const key of ["address", "phone", "notes", "needs", "advice"]) if (key in row) row[key] = text(row[key]);
    for (const key of ["base_salary", "onsite_price", "home_price", "onsite_commission", "home_commission", "travel_fee", "travel_allowance"]) if (key in row) row[key] = amount(row[key] || 0);
    for (const key of ["branch_id", "employee_id", "customer_id", "service_id"]) if (key in row) {
      if (key === "branch_id" && entity === "services" && !row[key]) row[key] = null;
      else row[key] = (await reference(tx, { branch_id: "branches", employee_id: "employees", customer_id: "customers", service_id: "services" }[key], row[key])).id;
    }
    if (entity === "employees") {
      row.start_date = date(row.start_date);
      row.end_date = date(row.end_date, true);
      row.salary_effective_from = date(row.salary_effective_from || row.start_date);
      if (row.end_date && row.end_date < row.start_date) fail("Ngày nghỉ việc phải sau ngày bắt đầu");
      if (row.salary_effective_from < row.start_date) fail("Ngày áp dụng lương phải từ ngày bắt đầu làm việc");
    }
    if (entity === "services") row.duration_minutes = integer(row.duration_minutes, 5, 720, "Thời lượng");
    if (entity === "consultations") {
      row.consulted_on = date(row.consulted_on);
      row.follow_up_on = date(row.follow_up_on, true);
      if (!row.needs && !row.advice) fail("Cần nhập nhu cầu hoặc nội dung tư vấn");
    }
    if (entity === "treatment_plans") {
      row.total_sessions = integer(row.total_sessions, 1, 1000, "Số buổi");
      row.start_date = date(row.start_date);
      row.end_date = date(row.end_date, true);
      row.status = choice(row.status || "active", ["active", "paused", "closed"]);
      if (row.end_date && row.end_date < row.start_date) fail("Hạn liệu trình phải sau ngày bắt đầu");
      const booked = (await tx.list("appointments")).filter(a => previous && a.treatment_plan_id === previous.id && a.status !== "cancelled").length;
      if (row.total_sessions < booked) fail("Số buổi không thể nhỏ hơn số buổi đã sử dụng/đặt");
      if (booked && (row.customer_id !== previous.customer_id || row.service_id !== previous.service_id)) fail("Liệu trình đã có lịch hẹn không thể đổi khách hoặc dịch vụ");
    }
    if (entity === "work_logs" || entity === "appointments") {
      row.starts_at = instant(row.starts_at);
      row.ends_at = instant(row.ends_at);
      if (row.ends_at <= row.starts_at || Date.parse(row.ends_at) - Date.parse(row.starts_at) > 86400000) fail("Giờ kết thúc phải sau giờ bắt đầu, tối đa 24 giờ");
      const employee = await reference(tx, "employees", row.employee_id);
      const workDay = dayInVietnam(row.starts_at);
      if (workDay < employee.start_date || (employee.end_date && workDay > employee.end_date)) fail("Thời gian nằm ngoài thời gian làm việc của nhân viên");
    }
    if (entity === "work_logs") {
      row.status = choice(row.status || "planned", ["planned", "worked", "leave"]);
      row.actual_starts_at = instant(row.actual_starts_at, true);
      row.actual_ends_at = instant(row.actual_ends_at, true);
      if (Boolean(row.actual_starts_at) !== Boolean(row.actual_ends_at)) fail("Cần nhập cả giờ vào và giờ ra thực tế");
      if (row.actual_starts_at && (row.actual_ends_at <= row.actual_starts_at || Date.parse(row.actual_ends_at) - Date.parse(row.actual_starts_at) > 86400000)) fail("Giờ làm thực tế không hợp lệ, tối đa 24 giờ");
      const logs = await tx.list("work_logs");
      if (logs.some(log => log.id !== previous?.id && log.employee_id === row.employee_id && overlaps(row.starts_at, row.ends_at, log.starts_at, log.ends_at))) fail("Nhân viên đã có lịch làm việc/nghỉ trong khoảng này");
      if (row.status === "worked" && logs.some(log => log.id !== previous?.id && log.status === "worked" && log.employee_id === row.employee_id && overlaps(row.actual_starts_at || row.starts_at, row.actual_ends_at || row.ends_at, log.actual_starts_at || log.starts_at, log.actual_ends_at || log.ends_at))) fail("Giờ làm thực tế trùng nhật ký khác");
      if (previous) {
        const booked = (await tx.list("appointments")).filter(a => a.status !== "cancelled" && a.employee_id === previous.employee_id && overlaps(...occupied(a), previous.starts_at, previous.ends_at));
        if (booked.some(a => row.status === "leave" || row.employee_id !== a.employee_id || row.branch_id !== a.branch_id || occupied(a)[0] < row.starts_at || occupied(a)[1] > row.ends_at)) fail("Lịch làm đang có lịch hẹn; hãy chuyển/hủy lịch hẹn trước");
      }
    }
    if (entity === "appointments") {
      row.status = choice(row.status || "scheduled", ["scheduled", "confirmed", "in_progress", "completed", "cancelled"]);
      row.location = choice(row.location || "onsite", ["onsite", "home"]);
      row.travel_minutes = row.location === "home" ? integer(row.travel_minutes || 0, 0, 360, "Thời gian di chuyển mỗi chiều") : 0;
      if (row.location === "home" && !row.address) fail("Cần nhập địa chỉ phục vụ tại nhà");
      if (row.location === "onsite") { row.travel_fee = 0; row.travel_allowance = 0; row.address = ""; }
      const service = await reference(tx, "services", row.service_id, row.status !== "cancelled" && (!previous || previous.service_id !== row.service_id));
      if (service.branch_id && service.branch_id !== row.branch_id) fail("Dịch vụ không thuộc cơ sở đã chọn");
      const samePricing = previous && previous.service_id === row.service_id && previous.location === row.location;
      row.service_price = samePricing ? previous.service_price : service[`${row.location}_price`];
      row.commission = samePricing ? previous.commission : service[`${row.location}_commission`];
      row.completed_at = row.status === "completed" ? now() : "";
      row.treatment_plan_id = row.treatment_plan_id ? (await reference(tx, "treatment_plans", row.treatment_plan_id)).id : null;
      const appointments = await tx.list("appointments");
      if (row.status !== "cancelled") {
        for (const [table, key] of [["branches", "branch_id"], ["employees", "employee_id"], ["customers", "customer_id"]]) await reference(tx, table, row[key], !previous || previous[key] !== row[key]);
        const [start, end] = occupied(row);
        const logs = await tx.list("work_logs");
        if (!logs.some(log => log.employee_id === row.employee_id && log.branch_id === row.branch_id && log.status !== "leave" && log.starts_at <= start && log.ends_at >= end)) fail("Cần có lịch làm việc bao phủ ca và thời gian di chuyển tại cơ sở phụ trách");
        if (appointments.some(a => a.id !== previous?.id && a.status !== "cancelled" && ((a.employee_id === row.employee_id && overlaps(start, end, ...occupied(a))) || (a.customer_id === row.customer_id && overlaps(row.starts_at, row.ends_at, a.starts_at, a.ends_at))))) fail("Trùng lịch nhân viên hoặc khách hàng (đã tính thời gian di chuyển)");
        if (row.treatment_plan_id) {
          const plan = await reference(tx, "treatment_plans", row.treatment_plan_id);
          const day = dayInVietnam(row.starts_at);
          if (plan.customer_id !== row.customer_id || plan.service_id !== row.service_id) fail("Liệu trình không khớp khách hàng/dịch vụ");
          if (plan.status !== "active" || day < plan.start_date || (plan.end_date && day > plan.end_date)) fail("Liệu trình không còn hiệu lực tại ngày hẹn");
          // Reserve a session for every non-cancelled booking, preventing overbooking.
          if (appointments.filter(a => a.id !== previous?.id && a.treatment_plan_id === plan.id && a.status !== "cancelled").length >= plan.total_sessions) fail("Liệu trình đã sử dụng/đặt hết số buổi");
        }
        if (row.status === "completed" && row.ends_at > now()) fail("Chưa thể hoàn thành ca trong tương lai");
      }
    }
    return row;
  }

  return {
    repo,
    entities,
    async snapshot() {
      return repo.read(async tx => {
        const data = {};
        for (const entity of entities) data[entity] = await tx.list(entity);
        data.treatment_plans = data.treatment_plans.map(plan => {
          const visits = data.appointments.filter(a => a.treatment_plan_id === plan.id);
          const used = visits.filter(a => a.status === "completed").length;
          const reserved = visits.filter(a => !["completed", "cancelled"].includes(a.status)).length;
          return { ...plan, used_sessions: used, reserved_sessions: reserved, remaining_sessions: plan.total_sessions - used };
        });
        return { ok: true, data, timezone: "Asia/Ho_Chi_Minh", currency: "VND" };
      });
    },
    async save(entity, input, actor = {}, id = null) {
      if (!entities.includes(entity)) throw new SpaError("Không tìm thấy danh mục", 404);
      if (!input || Array.isArray(input) || typeof input !== "object") fail("Dữ liệu không hợp lệ");
      return repo.transaction(async tx => {
        const previous = id ? await reference(tx, entity, id) : null;
        if (previous && input.updated_at !== previous.updated_at) throw new SpaError("Dữ liệu đã thay đổi. Hãy tải lại trước khi sửa.", 409);
        if (entity === "appointments" && previous && ["completed", "cancelled"].includes(previous.status)) fail("Ca đã hoàn thành/hủy được giữ nguyên để bảo toàn lịch sử");
        const row = await validate(tx, entity, input, previous);
        const stamp = new Date(Math.max(Date.parse(now()), previous ? Date.parse(previous.updated_at) + 1 : 0)).toISOString();
        const saved = await tx.save(entity, { ...row, id: previous?.id, sid: previous?.sid || `SPA_${randomUUID()}`, created_at: previous?.created_at || stamp, updated_at: stamp, updated_by: text(actor.user_id || "system", 200) });
        if (entity === "employees") {
          const rates = (await tx.list("salary_rates")).filter(r => r.employee_id === saved.id);
          if (!previous || saved.base_salary !== previous.base_salary || saved.salary_effective_from !== previous.salary_effective_from) {
            const existing = rates.find(r => r.effective_from === saved.salary_effective_from);
            await tx.save("salary_rates", { id: existing?.id, sid: existing?.sid || `SPA_${randomUUID()}`, employee_id: saved.id, effective_from: saved.salary_effective_from, monthly_salary: saved.base_salary, created_at: existing?.created_at || stamp, updated_at: stamp, updated_by: text(actor.user_id || "system", 200) });
          }
        }
        return { ok: true, item: saved };
      });
    },
    async report(params = {}) {
      const from = date(params.from || dayInVietnam(now()));
      const to = date(params.to || from);
      if (to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000) fail("Khoảng báo cáo phải từ 1 đến 367 ngày");
      return repo.read(async tx => {
        const employees = await tx.list("employees");
        const rates = await tx.list("salary_rates");
        const appointments = (await tx.list("appointments")).filter(a => { const d = dayInVietnam(a.starts_at); return d >= from && d <= to; });
        const completed = appointments.filter(a => a.status === "completed");
        const logs = (await tx.list("work_logs")).filter(log => log.status === "worked");
        const rangeStart = Date.parse(`${from}T00:00:00+07:00`);
        const rangeEnd = Date.parse(`${nextDay(to)}T00:00:00+07:00`);
        const payroll = employees.map(employee => {
          const salaryRates = rates.filter(r => r.employee_id === employee.id).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
          let base = 0;
          for (let day = from; day <= to; day = nextDay(day)) {
            if (day < employee.start_date || (employee.end_date && day > employee.end_date)) continue;
            const rate = salaryRates.find(r => r.effective_from <= day);
            const [y, m] = day.split("-").map(Number);
            base += (rate?.monthly_salary || 0) / new Date(Date.UTC(y, m, 0)).getUTCDate();
          }
          const visits = completed.filter(a => a.employee_id === employee.id);
          const commission = visits.reduce((sum, a) => sum + a.commission, 0);
          const allowance = visits.reduce((sum, a) => sum + a.travel_allowance, 0);
          const hours = logs.filter(log => log.employee_id === employee.id).reduce((sum, log) => sum + Math.max(0, Math.min(Date.parse(log.actual_ends_at || log.ends_at), rangeEnd) - Math.max(Date.parse(log.actual_starts_at || log.starts_at), rangeStart)) / 3600000, 0);
          return { employee_id: employee.id, sid: employee.sid, name: employee.name, worked_hours: Math.round(hours * 100) / 100, onsite_sessions: visits.filter(a => a.location === "onsite").length, home_sessions: visits.filter(a => a.location === "home").length, base_salary: Math.round(base), commission, travel_allowance: allowance, total: Math.round(base) + commission + allowance };
        });
        return { ok: true, from, to, payroll, summary: { appointments: appointments.length, completed: completed.length, cancelled: appointments.filter(a => a.status === "cancelled").length, service_revenue: completed.reduce((s, a) => s + a.service_price, 0), travel_fees: completed.reduce((s, a) => s + a.travel_fee, 0), payroll_total: payroll.reduce((s, e) => s + e.total, 0) }, salary_policy: "Lương tạm tính toàn chuỗi: lương tháng chia số ngày lịch của từng tháng, nhân số ngày trong kỳ thuộc thời gian làm việc; áp dụng lịch sử mức lương theo ngày hiệu lực. Không phụ thuộc giờ công. Hoa hồng và hỗ trợ đi lại chỉ tính ca hoàn thành, theo ngày hẹn (giờ Việt Nam). Chưa gồm thuế, bảo hiểm, khấu trừ hoặc xác nhận đã thanh toán." };
      });
    },
  };
}

module.exports = { createSpaService, SpaError, dayInVietnam };
