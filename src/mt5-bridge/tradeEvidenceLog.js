"use strict";

const fs = require("fs");
const readline = require("readline");

const MARKER = "[TradeEvidenceJson] ";

async function collectTradeEvidence(logPaths, outputPath) {
  const records = [];
  const seen = new Set();
  for (const logPath of logPaths) {
    if (!logPath || !fs.existsSync(logPath)) continue;
    const lines = readline.createInterface({ input: fs.createReadStream(logPath), crlfDelay: Infinity });
    for await (const line of lines) {
      const markerIndex = line.indexOf(MARKER);
      if (markerIndex < 0) continue;
      try {
        const record = JSON.parse(line.slice(markerIndex + MARKER.length));
        if (!record || !Array.isArray(record.triggers) || !record.label) continue;
        const key = `${record.ticket || ""}|${record.label}|${record.signal_time_utc || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        records.push(record);
      } catch {
        // A malformed cTrader log line must not discard the completed report.
      }
    }
  }
  fs.writeFileSync(outputPath, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""), { mode: 0o600 });
  return records;
}

module.exports = { collectTradeEvidence };
