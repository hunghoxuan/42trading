"use strict";

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFilePart(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildRangeValues(spec) {
  if (Array.isArray(spec)) return spec.slice();
  if (spec && typeof spec === "object") {
    const start = Number(spec.start);
    const end = Number(spec.end);
    const step = Number(spec.step ?? 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || step <= 0) {
      throw new Error(`Invalid range spec: ${JSON.stringify(spec)}`);
    }
    const values = [];
    for (let n = start; n <= end + step / 1000; n += step) {
      values.push(Number(n.toFixed(10)));
    }
    return values;
  }
  return [spec];
}

function expandMatrix(matrixSpec) {
  const entries = Object.entries(matrixSpec || {});
  const expanded = entries.map(([key, spec]) => [key, buildRangeValues(spec)]);
  const rows = [];

  function walk(index, current) {
    if (index >= expanded.length) {
      rows.push({ ...current });
      return;
    }
    const [key, values] = expanded[index];
    for (const value of values) {
      current[key] = value;
      walk(index + 1, current);
    }
  }

  walk(0, {});
  return rows;
}

function toCTraderValue(value) {
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

function buildOutputName(index, combo, namingKeys) {
  const parts = [`set_${String(index + 1).padStart(4, "0")}`];
  for (const key of namingKeys) {
    if (!(key in combo)) continue;
    parts.push(`${sanitizeFilePart(key)}-${sanitizeFilePart(combo[key])}`);
  }
  return `${parts.join("__")}.cbotset`;
}

function main() {
  const args = parseArgs(process.argv);
  const configPath = path.resolve(args.config || "");
  if (!configPath) {
    throw new Error("Usage: node scripts/generate-ctrader-cbotset-matrix.js --config <file.json>");
  }

  const config = readJson(configPath);
  const templatePath = path.resolve(config.template);
  const outputDir = path.resolve(config.outputDir);
  const template = readJson(templatePath);
  const chart = template.Chart || {};
  const parameters = { ...(template.Parameters || {}) };
  const combos = expandMatrix(config.matrix);
  const namingKeys = Array.isArray(config.namingKeys) ? config.namingKeys : [];

  ensureDir(outputDir);

  const summary = {
    template: templatePath,
    outputDir,
    files: [],
    count: combos.length,
  };

  combos.forEach((combo, index) => {
    const payload = {
      Chart: {
        Symbol: combo.ChartSymbol ?? config.chartSymbol ?? chart.Symbol ?? "XAUUSD",
        Period: combo.ChartPeriod ?? config.chartPeriod ?? chart.Period ?? "m1",
      },
      Parameters: { ...parameters },
    };

    for (const [key, value] of Object.entries(combo)) {
      if (key === "ChartSymbol" || key === "ChartPeriod") continue;
      payload.Parameters[key] = toCTraderValue(value);
    }

    const fileName = buildOutputName(index, combo, namingKeys);
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    summary.files.push({
      file: filePath,
      chart: `${payload.Chart.Symbol} ${payload.Chart.Period}`,
      combo,
    });
  });

  fs.writeFileSync(
    path.join(outputDir, "_summary.json"),
    JSON.stringify(summary, null, 2),
  );

  process.stdout.write(
    `Generated ${summary.count} cbotset files in ${outputDir}\n`,
  );
}

main();
