import css from "./invoicePrint.css?raw";
import { buildInvoiceDocument, type InvoiceData } from "./invoiceTemplate";
import type { Language } from "./i18n";

export function printInvoice(invoice: InvoiceData, language: Language): Promise<void> {
  return new Promise((resolve, reject) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = document.createElement("iframe");
    frame.title = "Invoice print document";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;bottom:0;left:-10000px;width:80mm;height:1px;border:0;pointer-events:none;opacity:0";
    let cleanupTimer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(cleanupTimer);
      const wasFocused = document.activeElement === frame;
      frame.remove();
      if (wasFocused && previousFocus?.isConnected) previousFocus.focus();
    };
    frame.onerror = () => { cleanup(); reject(new Error("Could not open invoice print document")); };
    frame.onload = async () => {
      try {
        const target = frame.contentWindow;
        if (!target) throw new Error("Could not open invoice print document");
        await target.document.fonts.ready;
        await new Promise<void>(ready => requestAnimationFrame(() => ready()));
        target.addEventListener("afterprint", cleanup, { once: true });
        // Keep the isolated document alive while the browser's print dialog is open.
        cleanupTimer = setTimeout(cleanup, 5 * 60 * 1000);
        target.focus();
        target.print();
        resolve();
      } catch (error) { cleanup(); reject(error); }
    };
    frame.srcdoc = buildInvoiceDocument(invoice, language, css);
    document.body.appendChild(frame);
  });
}
