"use strict";

function parseCsv(raw) {
  const input = String(raw || "").replace(/^\uFEFF/, "");
  if (!input || Buffer.byteLength(input) > 1024 * 1024) throw new Error("CSV must be between 1 byte and 1 MB");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("Unclosed quoted CSV field");
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("CSV needs a header and at least one product");
  if (rows.length > 501) throw new Error("Import at most 500 products at a time");
  const headers = rows.shift().map((cell) => cell.trim().toLowerCase());
  for (const required of ["sku", "name"]) if (!headers.includes(required)) throw new Error("Missing CSV column: " + required);
  return rows.map((cells, index) => {
    const output = { row_number: index + 2 };
    headers.forEach((name, column) => { output[name] = String(cells[column] || "").trim(); });
    return output;
  });
}

function integerCell(value, label, rowNumber, errors, allowEmpty = true) {
  if (value === "" && allowEmpty) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    errors.push("Row " + rowNumber + ": " + label + " must be a non-negative integer");
    return null;
  }
  return number;
}

function validateRows(rows, existingProducts) {
  const errors = [];
  const bySku = new Map(existingProducts.filter((product) => product.sku).map((product) => [product.sku, product]));
  const codeOwner = new Map();
  for (const product of existingProducts) for (const code of product.barcodes || []) codeOwner.set(code, product.sku);
  const seen = new Set();
  const normalized = rows.map((raw) => {
    const rowNumber = raw.row_number;
    const sku = String(raw.sku || "").trim();
    const name = String(raw.name || "").trim();
    if (!sku) errors.push("Row " + rowNumber + ": product number is required");
    if (!name) errors.push("Row " + rowNumber + ": name is required");
    if (seen.has(sku)) errors.push("Row " + rowNumber + ": duplicate product number in file");
    seen.add(sku);
    const barcodes = [...new Set(String(raw.barcodes || "").split("|").map((code) => code.trim()).filter(Boolean))];
    for (const code of barcodes) {
      if (codeOwner.has(code) && codeOwner.get(code) !== sku) errors.push("Row " + rowNumber + ": barcode belongs to another product: " + code);
      codeOwner.set(code, sku);
    }
    const price_minor = integerCell(raw.price_minor, "price_minor", rowNumber, errors);
    const opening_stock = integerCell(raw.opening_stock, "opening_stock", rowNumber, errors);
    const vat_rate_bps = integerCell(raw.vat_rate_bps, "vat_rate_bps", rowNumber, errors) ?? 0;
    if (vat_rate_bps > 10000) errors.push("Row " + rowNumber + ": VAT rate exceeds 100%");
    if (opening_stock !== null && bySku.has(sku)) {
      errors.push("Row " + rowNumber + ": opening_stock is only allowed before stock exists");
    }
    return { sku, name, barcodes, category: String(raw.category || ""),
      price_minor, opening_stock, vat_rate_bps, current: bySku.get(sku) || null };
  });
  return { rows: normalized, errors };
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function toCsv(headers, rows) {
  return [headers.join(","), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\r\n") + "\r\n";
}

module.exports = { parseCsv, validateRows, toCsv };
