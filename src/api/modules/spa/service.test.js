"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createSpaService } = require("./service");
const { handleSpaRequest } = require("./httpHandlers");
const { hasPermission } = require("../../shared/permissions");

const actor = { user_id: "spa-manager" };
async function fixture(t) {
  const service = createSpaService({ provider: "sqlite", sqlitePath: ":memory:", now: () => "2026-10-30T12:00:00Z" });
  t.after(() => service.repo.close());
  const save = async (entity, row, id) => (await service.save(entity, row, actor, id)).item;
  const branch = await save("branches", { name: "Cơ sở 1", address: "Hà Nội", is_active: true });
  const employee = await save("employees", { name: "Lan", branch_id: branch.id, start_date: "2026-10-01", base_salary: 6200000, salary_effective_from: "2026-10-01", is_active: true });
  const customer = await save("customers", { name: "Khách A", address: "Nhà khách", is_active: true });
  const treatment = await save("services", { name: "Trị liệu 60 phút", duration_minutes: 60, onsite_price: 500000, home_price: 600000, onsite_commission: 80000, home_commission: 120000, is_active: true });
  const log = await save("work_logs", { employee_id: employee.id, branch_id: branch.id, starts_at: "2026-10-29T08:00:00+07:00", ends_at: "2026-10-29T18:00:00+07:00", status: "worked", actual_starts_at: "2026-10-29T08:30:00+07:00", actual_ends_at: "2026-10-29T17:30:00+07:00" });
  const booking = { branch_id: branch.id, employee_id: employee.id, customer_id: customer.id, service_id: treatment.id, starts_at: "2026-10-29T09:00:00+07:00", ends_at: "2026-10-29T10:00:00+07:00", location: "onsite", status: "scheduled" };
  return { service, save, branch, employee, customer, treatment, log, booking };
}

test("onsite/home prices, frozen commissions, salary history and Vietnam dates", async t => {
  const f = await fixture(t);
  const first = await f.save("appointments", f.booking);
  await f.save("services", { ...f.treatment, onsite_price: 900000, onsite_commission: 160000 }, f.treatment.id);
  const done = await f.save("appointments", { ...first, status: "completed" }, first.id);
  assert.equal(done.service_price, 500000);
  assert.equal(done.commission, 80000);
  await f.save("appointments", { ...f.booking, starts_at: "2026-10-29T12:00:00+07:00", ends_at: "2026-10-29T13:00:00+07:00", location: "home", address: "Nhà khách", travel_minutes: 30, travel_fee: 40000, travel_allowance: 30000, status: "completed" });
  const report = await f.service.report({ from: "2026-10-29", to: "2026-10-29" });
  assert.equal(report.summary.service_revenue, 1100000);
  assert.equal(report.summary.travel_fees, 40000);
  assert.deepEqual(report.payroll.map(r => [r.base_salary, r.commission, r.travel_allowance, r.total, r.worked_hours, r.onsite_sessions, r.home_sessions]), [[200000, 200000, 30000, 430000, 9, 1, 1]]);
  await f.save("employees", { ...f.employee, base_salary: 9300000, salary_effective_from: "2026-10-30" }, f.employee.id);
  assert.equal((await f.service.report({ from: "2026-10-29", to: "2026-10-30" })).payroll[0].base_salary, 500000);
  assert.equal((await f.service.report({ from: "2026-10-01", to: "2026-10-31" })).payroll[0].base_salary, 6400000);
  await assert.rejects(f.save("appointments", { ...done, status: "cancelled" }, done.id), /giữ nguyên/);
});

test("schedule requires availability; employee/customer/travel conflicts are rejected atomically", async t => {
  const f = await fixture(t);
  await assert.rejects(f.save("appointments", { ...f.booking, starts_at: "2026-10-28T09:00:00+07:00", ends_at: "2026-10-28T10:00:00+07:00" }), /bao phủ/);
  const outcomes = await Promise.allSettled([f.save("appointments", f.booking), f.save("appointments", f.booking)]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  assert.match(outcomes.find(r => r.status === "rejected").reason.message, /Trùng lịch/);
  await assert.rejects(f.save("appointments", { ...f.booking, location: "home", address: "Nhà", travel_minutes: 30, starts_at: "2026-10-29T10:15:00+07:00", ends_at: "2026-10-29T11:15:00+07:00" }), /Trùng lịch/);
  await assert.rejects(f.save("work_logs", { ...f.log, status: "leave" }, f.log.id), /đang có lịch hẹn/);
  const secondEmployee = await f.save("employees", { ...f.employee, name: "Mai" });
  await f.save("work_logs", { ...f.log, employee_id: secondEmployee.id });
  await assert.rejects(f.save("appointments", { ...f.booking, employee_id: secondEmployee.id }), /Trùng lịch/);
});

test("treatment sessions reserve capacity, cancellation releases it, completion consumes once", async t => {
  const f = await fixture(t);
  const plan = await f.save("treatment_plans", { name: "Liệu trình 1 buổi", customer_id: f.customer.id, service_id: f.treatment.id, total_sessions: 1, start_date: "2026-10-01", status: "active" });
  const first = await f.save("appointments", { ...f.booking, treatment_plan_id: plan.id });
  const later = { ...f.booking, treatment_plan_id: plan.id, starts_at: "2026-10-29T11:00:00+07:00", ends_at: "2026-10-29T12:00:00+07:00" };
  await assert.rejects(f.save("appointments", later), /hết số buổi/);
  await f.save("appointments", { ...first, status: "cancelled" }, first.id);
  await f.save("appointments", { ...later, status: "completed" });
  const snapshot = await f.service.snapshot();
  assert.deepEqual(snapshot.data.treatment_plans.map(p => [p.used_sessions, p.reserved_sessions, p.remaining_sessions]), [[1, 0, 0]]);
  assert.equal((await f.service.report({ from: "2026-10-29", to: "2026-10-29" })).payroll[0].commission, 80000);
});

test("consultations persist, validation rejects bad money/dates and stale updates", async t => {
  const f = await fixture(t);
  await f.save("consultations", { customer_id: f.customer.id, employee_id: f.employee.id, consulted_on: "2026-10-29", needs: "Đau vai", advice: "Theo dõi tiến triển", follow_up_on: "2026-11-05" });
  assert.equal((await f.service.snapshot()).data.consultations[0].needs, "Đau vai");
  const row = await f.save("branches", { ...f.branch, name: "Tên mới" }, f.branch.id);
  await assert.rejects(f.save("branches", f.branch, row.id), error => error.status === 409);
  await assert.rejects(f.save("services", { ...f.treatment, onsite_price: -1 }), /không âm/);
  await assert.rejects(f.save("services", { ...f.treatment, onsite_price: 1.5 }), /số nguyên/);
  await assert.rejects(f.service.report({ from: "2026-02-30", to: "2026-03-01" }), /Ngày không hợp lệ/);
  await assert.rejects(f.save("appointments", { ...f.booking, location: "home", address: "" }), /địa chỉ/);
  await assert.rejects(f.save("consultations", { customer_id: 999, employee_id: f.employee.id, consulted_on: "2026-10-29", advice: "Tư vấn" }), /không tồn tại/);
  assert.equal((await f.service.report({ from: "2026-11-01", to: "2026-11-30" })).payroll[0].base_salary, 6200000);
});

test("work hours are clipped to the report range using Vietnam midnight", async t => {
  const f = await fixture(t);
  await f.save("work_logs", { employee_id: f.employee.id, branch_id: f.branch.id, starts_at: "2026-10-28T22:00:00+07:00", ends_at: "2026-10-29T02:00:00+07:00", status: "worked" });
  assert.equal((await f.service.report({ from: "2026-10-28", to: "2026-10-28" })).payroll[0].worked_hours, 2);
  assert.equal((await f.service.report({ from: "2026-10-29", to: "2026-10-29" })).payroll[0].worked_hours, 11);
});

test("HTTP permission gate runs before initializing storage; real CRUD and malformed JSON", async t => {
  const f = await fixture(t);
  async function request(path, method = "GET", body = "", allowed = true) {
    const req = Readable.from([Buffer.from(body)]); req.method = method;
    const result = {};
    const context = { req, res: result, url: new URL(path, "http://localhost"), getService: () => { if (!allowed) throw new Error("must not initialize"); return f.service; }, json: (res, status, payload) => Object.assign(res, { status, payload }), requirePermission: (_req, res, permission) => { result.permission = permission; if (!allowed) Object.assign(res, { status: 401 }); return allowed; }, getActor: () => actor };
    const handled = await handleSpaRequest(context);
    return { ...result, handled };
  }
  assert.equal((await request("/spa/bootstrap", "GET", "", false)).status, 401);
  assert.equal((await request("/spa/customers", "POST", "{}", false)).permission, "apis.spa.write");
  assert.equal((await request("/spa/bootstrap")).payload.data.employees[0].name, "Lan");
  const created = await request("/spa/customers", "POST", JSON.stringify({ name: "Khách API", is_active: true }));
  assert.equal(created.status, 200);
  assert.equal(created.payload.item.updated_by, actor.user_id);
  assert.equal((await request("/spa/customers", "POST", "{")).status, 400);
  assert.equal((await request("/spa/salary_rates", "POST", "{}")).status, 404);
  assert.equal((await request("/spa/reports?from=2026-10-29&to=2026-10-29")).status, 200);
});

test("Spa manager and admin are authorized without granting access to other default roles", () => {
  for (const role of ["spa_manager", "admin"]) {
    for (const permission of ["pages.spa", "apis.spa.read", "apis.spa.write"]) assert.equal(hasPermission({ roles: [role] }, permission), true);
  }
  for (const role of ["buyer", "seller", "trader", "pos_cashier"]) assert.equal(hasPermission({ roles: [role] }, "apis.spa.read"), false);
});

test("archiving a catalog item preserves completion of an already booked appointment", async t => {
  const f = await fixture(t);
  const booked = await f.save("appointments", f.booking);
  await f.save("services", { ...f.treatment, is_active: false }, f.treatment.id);
  const completed = await f.save("appointments", { ...booked, status: "completed" }, booked.id);
  assert.equal(completed.commission, 80000);
  await assert.rejects(f.save("appointments", { ...f.booking, starts_at: "2026-10-29T11:00:00+07:00", ends_at: "2026-10-29T12:00:00+07:00" }), /ngừng hoạt động/);
});
