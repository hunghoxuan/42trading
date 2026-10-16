import type { LocalSale } from "./storage";

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

const money = (value: number) => new Intl.NumberFormat("vi-VN", {
  style: "currency", currency: "VND", maximumFractionDigits: 0,
}).format(value);

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

export default function Receipt({ receipt, onClose }: { receipt: ReceiptData; onClose: () => void }) {
  return <div className="pos-receipt-overlay" role="dialog" aria-label="Sale receipt">
    <div className="pos-receipt">
      <div className="pos-receipt-actions"><button onClick={onClose}>Close</button><button onClick={() => window.print()}>Print</button></div>
      <h2>42Trade Store</h2>
      <p>Receipt {receipt.receipt_id}<br/>{new Date(receipt.sold_at).toLocaleString("vi-VN")}<br/>Cashier {receipt.cashier_id}</p>
      {receipt.pending && <strong className="pos-offline">OFFLINE · PENDING SYNC</strong>}
      {receipt.lines.map((line, index) => <div className="pos-receipt-line" key={index}>
        <span>{line.name}<small>{line.quantity} × {money(line.price_minor)}</small></span><strong>{money(line.total_minor)}</strong>
      </div>)}
      <div className="pos-receipt-line"><span>Subtotal</span><strong>{money(receipt.total_minor - receipt.vat_minor)}</strong></div>
      <div className="pos-receipt-line"><span>VAT</span><strong>{money(receipt.vat_minor)}</strong></div>
      <div className="pos-receipt-line"><strong>Total</strong><strong>{money(receipt.total_minor)}</strong></div>
      <div className="pos-receipt-line"><span>Cash received</span><strong>{money(receipt.cash_received_minor)}</strong></div>
      <div className="pos-receipt-line"><span>Change</span><strong>{money(receipt.cash_received_minor - receipt.total_minor)}</strong></div>
      <p>Thank you.</p>
    </div>
  </div>;
}
