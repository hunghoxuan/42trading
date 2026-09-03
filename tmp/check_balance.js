#!/usr/bin/env node
// Line-based brace/paren/bracket balance checker for C# source.
// Skips: line comments, block comments, regular strings, char literals,
// verbatim strings (@"), interpolated verbatim strings ($@"...").
const fs = require("fs");
const path = process.argv[2];
if (!path) { console.error("usage: node check_balance.js <file>"); process.exit(2); }
const src = fs.readFileSync(path, "utf8");

let depth = { "{": 0, "}": 0, "(": 0, ")": 0, "[": 0, "]": 0 };
let stack = [];
let lineNo = 1;
let inBlock = false;
let inVerbatim = false;   // @"... " or $@"..."
let inString = false;     // "..."
let inChar = false;       // '...'
let inInterp = false;     // $"..."
let verbatimDollar = false;
let problems = [];

function push(ch, ln) {
  stack.push({ ch, ln });
}
function pop(ch, ln) {
  const open = { "}": "{", ")": "(", "]": "[" }[ch];
  if (stack.length === 0) { problems.push(`line ${ln}: unmatched closing '${ch}'`); return; }
  const top = stack.pop();
  if (top.ch !== open) {
    problems.push(`line ${ln}: expected '${open}' (opened line ${top.ln}) but found '${ch}'`);
  }
}

for (let i = 0; i < src.length; i++) {
  const c = src[i];
  const n = src[i + 1];
  if (c === "\n") { lineNo++; continue; }

  if (inBlock) {
    if (c === "*" && n === "/") { inBlock = false; i++; }
    continue;
  }
  if (inVerbatim) {
    if (c === "\"") {
      if (n === "\"") { i++; continue; } // escaped quote inside verbatim
      inVerbatim = false;
    }
    continue;
  }
  if (inString) {
    if (c === "\\") { i++; continue; }
    if (c === "\"") inString = false;
    continue;
  }
  if (inChar) {
    if (c === "\\") { i++; continue; }
    if (c === "'") inChar = false;
    continue;
  }

  // not inside any literal/comment
  if (c === "/" && n === "/") { // line comment
    while (i < src.length && src[i] !== "\n") i++;
    if (src[i] === "\n") { lineNo++; }
    continue;
  }
  if (c === "/" && n === "*") { inBlock = true; i++; continue; }
  if (c === "@" && n === "\"") { inVerbatim = true; verbatimDollar = false; i++; continue; }
  if (c === "$" && n === "@" && src[i + 2] === "\"") { inVerbatim = true; verbatimDollar = true; i += 2; continue; }
  if (c === "$" && n === "\"") { inString = true; i++; continue; }
  if (c === "\"") { inString = true; continue; }
  if (c === "'") { inChar = true; continue; }

  if (c === "{" || c === "(" || c === "[") push(c, lineNo);
  else if (c === "}" || c === ")" || c === "]") pop(c, lineNo);
}

if (inBlock) problems.push("unterminated block comment at EOF");
if (inVerbatim) problems.push("unterminated verbatim string at EOF");
if (inString) problems.push("unterminated string at EOF");
if (inChar) problems.push("unterminated char literal at EOF");
for (const t of stack) problems.push(`line ${t.ln}: unclosed '${t.ch}'`);

if (problems.length) {
  console.error(`FAIL ${path}`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log(`OK ${path} (braces/parens/brackets balanced, ${lineNo} lines)`);
