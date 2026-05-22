const fs = require('fs');
let code = fs.readFileSync('web-ui/src/api.js', 'utf8');

const targetStr = `  dbCreateRow: (payload = {}) => post("/mt5/db/rows/create", payload),`;
const replaceStr = `  dbCreateRow: (payload = {}) => post("/mt5/db/rows/create", payload),
  dbSchema: (table) => get(\`/mt5/db/schema?table=\${encodeURIComponent(table)}\`),
  storageStats: () => get("/mt5/storage/stats"),
  storageCleanup: (target) => post("/mt5/storage/cleanup", { target }),`;

code = code.replace(targetStr, replaceStr);
fs.writeFileSync('web-ui/src/api.js', code);
console.log("Patched api.js");
