const field = (key, label, type = "text", extra = {}) => ({ key, label, type, ...extra });
const ref = (key, label, source, optional = false) => field(key, label, "reference", { source, optional });
const status = options => field("status", "Trạng thái", "select", { options });
const notes = field("notes", "Ghi chú", "textarea", { optional: true });
const name = field("name", "Tên");
const active = field("is_active", "Đang hoạt động", "checkbox");
const money = (key, label) => field(key, label, "number", { min: 0, defaultValue: 0 });
export const statuses = { planned: "Đã xếp lịch", worked: "Đã làm", leave: "Nghỉ", scheduled: "Đã đặt", confirmed: "Đã xác nhận", in_progress: "Đang thực hiện", completed: "Hoàn thành", cancelled: "Đã hủy", active: "Đang theo dõi", paused: "Tạm dừng", closed: "Đã đóng", onsite: "Tại cơ sở", home: "Tại nhà" };

export const configs = {
  branches: { label: "Cơ sở", fields: [name, field("address", "Địa chỉ", "text", { optional: true }), active], columns: ["name", "address", "is_active"] },
  services: { label: "Dịch vụ & giá", fields: [name, ref("branch_id", "Cơ sở (để trống: toàn chuỗi)", "branches", true), field("duration_minutes", "Thời lượng (phút)", "number", { min: 5, max: 720, defaultValue: 60 }), money("onsite_price", "Giá tại cơ sở (đ)"), money("home_price", "Giá tại nhà (đ)"), money("onsite_commission", "Hoa hồng tại cơ sở / ca (đ)"), money("home_commission", "Hoa hồng tại nhà / ca (đ)"), active, notes], columns: ["name", "branch_id", "duration_minutes", "onsite_price", "home_price", "onsite_commission", "home_commission", "is_active"] },
  employees: { label: "Nhân viên", fields: [name, field("phone", "Điện thoại", "tel", { optional: true }), ref("branch_id", "Cơ sở chính", "branches"), field("start_date", "Ngày bắt đầu", "date"), field("end_date", "Ngày nghỉ việc", "date", { optional: true }), money("base_salary", "Lương cứng / tháng (đ)"), field("salary_effective_from", "Ngày áp dụng mức lương", "date"), active, notes], columns: ["name", "phone", "branch_id", "start_date", "base_salary", "salary_effective_from", "is_active"] },
  customers: { label: "Khách hàng", fields: [name, field("phone", "Điện thoại", "tel", { optional: true }), field("address", "Địa chỉ", "text", { optional: true }), notes, active], columns: ["name", "phone", "address", "notes", "is_active"] },
  consultations: { label: "Tư vấn", fields: [ref("customer_id", "Khách hàng", "customers"), ref("employee_id", "Nhân viên tư vấn", "employees"), field("consulted_on", "Ngày tư vấn", "date"), field("needs", "Nhu cầu / đánh giá ban đầu", "textarea", { optional: true }), field("advice", "Nội dung tư vấn / hướng xử lý", "textarea", { optional: true }), field("follow_up_on", "Ngày hẹn chăm sóc lại", "date", { optional: true })], columns: ["customer_id", "employee_id", "consulted_on", "needs", "advice", "follow_up_on"] },
  treatment_plans: { label: "Liệu trình", fields: [name, ref("customer_id", "Khách hàng", "customers"), ref("service_id", "Dịch vụ", "services"), field("total_sessions", "Tổng số buổi", "number", { min: 1, max: 1000, defaultValue: 10 }), field("start_date", "Ngày bắt đầu", "date"), field("end_date", "Hạn kết thúc", "date", { optional: true }), status(["active", "paused", "closed"]), notes], columns: ["name", "customer_id", "service_id", "total_sessions", "used_sessions", "reserved_sessions", "remaining_sessions", "status"] },
  work_logs: { label: "Lịch & nhật ký làm việc", fields: [ref("employee_id", "Nhân viên", "employees"), ref("branch_id", "Cơ sở phụ trách", "branches"), field("starts_at", "Bắt đầu dự kiến", "datetime-local"), field("ends_at", "Kết thúc dự kiến", "datetime-local"), status(["planned", "worked", "leave"]), field("actual_starts_at", "Giờ vào thực tế", "datetime-local", { optional: true }), field("actual_ends_at", "Giờ ra thực tế", "datetime-local", { optional: true }), notes], columns: ["employee_id", "branch_id", "starts_at", "ends_at", "actual_starts_at", "actual_ends_at", "status", "notes"] },
  appointments: { label: "Lịch hẹn & phân ca", fields: [ref("branch_id", "Cơ sở phụ trách", "branches"), ref("customer_id", "Khách hàng", "customers"), ref("employee_id", "Nhân viên thực hiện", "employees"), ref("service_id", "Dịch vụ", "services"), ref("treatment_plan_id", "Liệu trình (nếu có)", "treatment_plans", true), field("location", "Địa điểm", "select", { options: ["onsite", "home"] }), field("starts_at", "Bắt đầu phục vụ", "datetime-local"), field("ends_at", "Kết thúc phục vụ", "datetime-local"), field("address", "Địa chỉ tại nhà", "text", { homeOnly: true }), field("travel_minutes", "Di chuyển mỗi chiều (phút)", "number", { min: 0, max: 360, defaultValue: 0, homeOnly: true }), { ...money("travel_fee", "Phí đi lại thu khách (đ)"), homeOnly: true }, { ...money("travel_allowance", "Hỗ trợ đi lại trả nhân viên (đ)"), homeOnly: true }, status(["scheduled", "confirmed", "in_progress", "completed", "cancelled"]), notes], columns: ["starts_at", "ends_at", "customer_id", "employee_id", "branch_id", "service_id", "location", "service_price", "travel_fee", "commission", "status"] },
};
export const extraLabels = { used_sessions: "Đã làm", reserved_sessions: "Đã đặt", remaining_sessions: "Còn lại", service_price: "Giá đã áp dụng", commission: "Hoa hồng đã áp dụng", travel_fee: "Phí đi lại" };
export function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
export function localInput(value) { return value ? new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 16) : ""; }
export function newDraft(entity) {
  return Object.fromEntries(configs[entity].fields.map(f => [f.key, f.defaultValue ?? (f.type === "checkbox" ? true : f.type === "select" ? f.options[0] : f.type === "date" && !f.optional ? today() : f.type === "datetime-local" && !f.optional ? `${today()}T${f.key === "ends_at" ? "17:00" : "08:00"}` : "")]));
}
export function reportRange(anchor, period) {
  const d = new Date(`${anchor}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return { from: today(), to: today() };
  if (period === "week") {
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    const from = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 6);
    return { from, to: d.toISOString().slice(0, 10) };
  }
  return { from: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) };
}
