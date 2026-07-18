"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sourcePath = path.join(__dirname, "chartStrategyChecks.js");
let source = fs.readFileSync(sourcePath, "utf8");

const exportNames = [];
source = source.replace(/^import\s+.+?;\s*$/gm, "");
source = source.replace(/^export function\s+([A-Za-z0-9_]+)\s*\(/gm, (_match, name) => {
  exportNames.push(name);
  return `function ${name}(`;
});

const compiledSource = `
const sharedArtifactDetection = require("../../../shared/rules-engine/features/detectArtifacts.cjs");
const strategyEventFunctions = require("../../../shared/rules-engine/features/strategyEventFunctions.cjs");
const strategyScanEngine = require("../../../shared/utils/strategyScanEngine.cjs");
const sharedRulesEngine = require("../../../shared/rules-engine/index.cjs");
${source}
module.exports = { ${exportNames.join(", ")} };
`;

const sandbox = {
  require,
  module: { exports: {} },
  exports: {},
  __dirname,
  __filename: sourcePath,
  console,
  process,
  Buffer,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
sandbox.global = sandbox;
sandbox.globalThis = sandbox;

vm.runInNewContext(compiledSource, sandbox, {
  filename: sourcePath,
  displayErrors: true,
});

module.exports = sandbox.module.exports;
