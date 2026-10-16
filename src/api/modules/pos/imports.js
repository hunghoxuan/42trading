"use strict";

function parseCsv(raw) {
  const input = String(raw || "").replace(/^\uFEFF/, "");
  if (!input || Buffer.byteLength(input) > 5 * 1024 * 1024) throw new Error("CSV must be between 1 byte and 5 MB");
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
  if (rows.length > 10001) throw new Error("Import at most 10,000 products at a time");
  const headers = rows.shift().map((cell) => cell.trim().toLowerCase());
  for (const required of ["sku", "name"]) if (!headers.includes(required)) throw new Error("Missing CSV column: " + required);
  return rows.map((cells, index) => {
    const output = { row_number: index + 2 };
    headers.forEach((name, column) => { output[name] = String(cells[column] || "").trim(); });
    return output;
  });
}

function parseProductRows(input) {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Import needs product rows");
  if (input.length > 10000) throw new Error("Import at most 10,000 products at a time");
  return input.map((row, index) => ({
    ...(row && typeof row === "object" ? row : {}),
    row_number: Number.isSafeInteger(row?.row_number) ? row.row_number : index + 2,
  }));
}

function integerCell(value, label, rowNumber, errors, allowEmpty = true) {
  if ((value === "" || value === null || value === undefined) && allowEmpty) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    errors.push("Row " + rowNumber + ": " + label + " must be a non-negative integer");
    return null;
  }
  return number;
}

function validateRows(rows, existingProducts) {
  const errors = [];
  const warnings = [];
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
    const rawBarcodes = Array.isArray(raw.barcodes) ? raw.barcodes : String(raw.barcodes || "").split(/[|,]/);
    const barcodes = [...new Set(rawBarcodes.map((code) => String(code).trim()).filter(Boolean))];
    for (const code of barcodes) {
      if (codeOwner.has(code) && codeOwner.get(code) !== sku) warnings.push("Row " + rowNumber + ": barcode is shared with another product: " + code);
      codeOwner.set(code, sku);
    }
    const price_minor = integerCell(raw.price_minor, "price_minor", rowNumber, errors);
    const opening_stock = integerCell(raw.opening_stock, "opening_stock", rowNumber, errors);
    const vat_rate_bps = integerCell(raw.vat_rate_bps, "vat_rate_bps", rowNumber, errors) ?? 0;
    const cost_minor = integerCell(raw.cost_minor, "cost_minor", rowNumber, errors);
    let min_stock = null;
    if (raw.min_stock !== "" && raw.min_stock !== null && raw.min_stock !== undefined) {
      min_stock = Number(raw.min_stock);
      if (!Number.isFinite(min_stock) || min_stock < 0) {
        errors.push("Row " + rowNumber + ": min_stock must be a non-negative number");
        min_stock = null;
      }
    }
    const source_on_hand = raw.source_on_hand === "" || raw.source_on_hand === null || raw.source_on_hand === undefined
      ? null : Number(raw.source_on_hand);
    if (source_on_hand !== null && (!Number.isSafeInteger(source_on_hand) || source_on_hand < 0)) {
      warnings.push("Row " + rowNumber + ": stock was not loaded because POS stock must be a non-negative whole number");
    }
    if (vat_rate_bps > 10000) errors.push("Row " + rowNumber + ": VAT rate exceeds 100%");
    if (opening_stock !== null && bySku.has(sku)) {
      errors.push("Row " + rowNumber + ": opening_stock is only allowed before stock exists");
    }
    return { sku, name, barcodes, category: String(raw.category || ""), supplier: String(raw.supplier || ""), unit: String(raw.unit || "each"),
      family_sku: String(raw.family_sku || ""), group_code: String(raw.group_code || ""),
      price_minor, cost_minor, min_stock, source_on_hand, opening_stock, vat_rate_bps,
      current: bySku.get(sku) || null };
  });
  return { rows: normalized, errors, warnings };
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function toCsv(headers, rows) {
  return [headers.join(","), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\r\n") + "\r\n";
}

module.exports = { parseCsv, parseProductRows, validateRows, toCsv };
