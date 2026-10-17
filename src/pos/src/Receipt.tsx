import type { LocalSale } from "./storage";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { t, type Language } from "./i18n";

type ReceiptData = {
  receipt_id: string;
  sold_at: string;
  cashier_id: string;
  lines: { name: string; quantity: number; price_minor: number; vat_minor: number; total_minor: number }[];
  total_minor: number;
  vat_minor: number;
  cash_received_minor: number;
  pending: boolean;
};

export function fromLocalSale(sale: LocalSale): ReceiptData {
  return { receipt_id: sale.receipt_id, sold_at: sale.sold_at, cashier_id: sale.cashier_id || "Offline cashier",
    lines: sale.receipt_lines, total_minor: sale.total_minor, vat_minor: sale.vat_minor,
    cash_received_minor: sale.cash_received_minor, pending: sale.sync_state !== "SYNCED" };
}

export function fromServerSale(sale: Record<string, unknown>): ReceiptData {
  return { receipt_id: String(sale.receipt_id), sold_at: String(sale.sold_at),
    cashier_id: String(sale.cashier_id), lines: sale.lines as ReceiptData["lines"],
    total_minor: Number(sale.total_minor), vat_minor: Number(sale.vat_minor || 0),
    cash_received_minor: Number(sale.cash_received_minor), pending: false };
}

export default function Receipt({ receipt, onClose, language, autoPrint = false }: { receipt: ReceiptData; onClose: () => void; language: Language; autoPrint?: boolean }) {
  const tr = (value: string) => t(language, value);
  const locale = language === "vi" ? "vi-VN" : "en-US";
  const money = (value: number) => new Intl.NumberFormat(locale, {
    style: "currency", currency: "VND", maximumFractionDigits: 0,
  }).format(value);
  const printed = useRef("");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!autoPrint || printed.current === receipt.receipt_id) return;
    const frame = requestAnimationFrame(() => {
      printed.current = receipt.receipt_id;
      window.print();
    });
    return () => cancelAnimationFrame(frame);
  }, [autoPrint, receipt.receipt_id]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return createPortal(<div ref={dialog} className="pos-receipt-overlay" role="dialog" aria-modal="true" aria-label={tr("Invoice")}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("button");
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <div className="pos-receipt">
      <div className="pos-receipt-actions"><button onClick={onClose}>{tr("Close")}</button><button onClick={() => window.print()}>{tr("Print invoice")}</button></div>
      <h2>{tr("42Trade Store")}</h2>
      <h3 className="pos-receipt-title">{tr("Invoice")}</h3>
      <p>{tr("Receipt")} {receipt.receipt_id}<br/>{new Date(receipt.sold_at).toLocaleString(locale)}<br/>{tr("Cashier")} {receipt.cashier_id}</p>
      {receipt.pending && <strong className="pos-offline">{tr("OFFLINE · PENDING SYNC")}</strong>}
      {receipt.lines.map((line, index) => <div className="pos-receipt-line" key={index}>
        <span>{line.name}<small>{line.quantity} × {money(line.price_minor)}</small></span><strong>{money(line.total_minor)}</strong>
      </div>)}
      <div className="pos-receipt-line"><span>{tr("Subtotal")}</span><strong>{money(receipt.total_minor - receipt.vat_minor)}</strong></div>
      <div className="pos-receipt-line"><span>{tr("VAT")}</span><strong>{money(receipt.vat_minor)}</strong></div>
      <div className="pos-receipt-line"><strong>{tr("Total")}</strong><strong>{money(receipt.total_minor)}</strong></div>
      <div className="pos-receipt-line"><span>{tr("Cash received")}</span><strong>{money(receipt.cash_received_minor)}</strong></div>
      <div className="pos-receipt-line"><span>{tr("Change")}</span><strong>{money(receipt.cash_received_minor - receipt.total_minor)}</strong></div>
      <p>{tr("Thank you.")}</p>
    </div>
  </div>, document.body);
}
