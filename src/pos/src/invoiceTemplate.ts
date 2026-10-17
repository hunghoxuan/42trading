import { t, type Language } from "./i18n";

export type InvoiceData = {
  receipt_id: string;
  sold_at: string;
  cashier_id: string;
  lines: { name: string; quantity: number; price_minor: number; vat_minor: number; total_minor: number }[];
  total_minor: number;
  vat_minor: number;
  cash_received_minor: number;
  pending: boolean;
};

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]!));

// Print-only document. No POS markup, stylesheets, scripts or external assets.
export function buildInvoiceDocument(invoice: InvoiceData, language: Language, css: string): string {
  const locale = language === "vi" ? "vi-VN" : "en-US";
  const label = (value: string) => escapeHtml(t(language, value));
  const amount = (value: number) => escapeHtml(new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value));
  const summary = (name: string, value: number, className = "") =>
    `<div class="summary-row ${className}"><span>${label(name)}</span><strong>${amount(value)}</strong></div>`;
  const date = new Date(invoice.sold_at).toLocaleString(locale, { timeZone: "Asia/Ho_Chi_Minh" });
  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${label("Invoice")} ${escapeHtml(invoice.receipt_id)}</title><style>${css}</style></head>
<body><main class="invoice">
  <header class="invoice-header"><div class="store-name">${label("42Trade Store")}</div>
    <h1>${label("Invoice")}</h1><div class="invoice-reference">${escapeHtml(invoice.receipt_id)}</div></header>
  <dl class="invoice-meta"><div><dt>${label("Date")}</dt><dd>${escapeHtml(date)}</dd></div>
    <div><dt>${label("Cashier")}</dt><dd>${escapeHtml(invoice.cashier_id)}</dd></div></dl>
  ${invoice.pending ? `<p class="pending-stamp">${label("OFFLINE · PENDING SYNC")}</p>` : ""}
  <table class="invoice-items"><colgroup><col class="item-column"><col class="amount-column"></colgroup>
    <thead><tr><th>${label("Products")}</th><th>${label("Amount")} (VND)</th></tr></thead><tbody>
    ${invoice.lines.map(line => `<tr><td><div class="item-name">${escapeHtml(line.name)}</div>
      <div class="item-detail">${amount(line.quantity)} × ${amount(line.price_minor)}</div></td>
      <td class="line-amount">${amount(line.total_minor)}</td></tr>`).join("")}
    </tbody></table>
  <section class="invoice-summary">${summary("Subtotal", invoice.total_minor - invoice.vat_minor)}${summary("VAT", invoice.vat_minor)}
    ${summary("Total", invoice.total_minor, "grand-total")}</section>
  <section class="invoice-tender">${summary("Cash received", invoice.cash_received_minor)}
    ${summary("Change", invoice.cash_received_minor - invoice.total_minor)}</section>
  <footer>${label("Thank you.")}</footer>
</main></body></html>`;
}
