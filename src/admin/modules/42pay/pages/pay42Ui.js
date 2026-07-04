export function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function formatMetric(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? "0");
  if (Math.abs(num) >= 1000 || String(value).includes(".")) {
    return formatMoney(num);
  }
  return new Intl.NumberFormat("en-US").format(num);
}

export function statusTone(status) {
  const value = String(status || "").trim().toUpperCase();
  if (value === "PAID" || value === "COMPLETED" || value === "ACTIVE") {
    return "#1fc7d4";
  }
  if (value === "CREATED" || value === "DRAFT") return "#f5c542";
  if (value === "INACTIVE" || value === "EXPIRED") return "#9fb0c7";
  return "#ff7b72";
}

export function roleLabel(user = null) {
  if (!Array.isArray(user?.roles) || user.roles.length === 0) return "buyer";
  return String(user.roles[0] || "buyer").trim().toLowerCase() || "buyer";
}
