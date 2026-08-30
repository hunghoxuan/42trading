"use strict";

const CONTEXT_ROOTS = new Set([
  "bar",
  "prev",
  "bars",
  "indicators",
  "prev_indicators",
  "levels",
  "market",
  "params",
  "strategy",
  "multiTf",
]);

const INFIX_OPERATORS = new Set([
  "crosses_above",
  "crosses_below",
  "touches",
  "retest",
  "rejected",
  "holds_above",
  "holds_below",
  "sweeps_above",
  "sweeps_below",
]);

class RuleTextSyntaxError extends Error {
  constructor(message, position = null) {
    super(position === null ? message : `${message} at position ${position + 1}`);
    this.name = "RuleTextSyntaxError";
    this.position = position;
  }
}

function normalizeVariableAlias(value = "", aliases = {}) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  if (Object.prototype.hasOwnProperty.call(aliases, raw)) {
    return String(aliases[raw] || raw).trim() || raw;
  }
  if (raw.includes(".")) return raw;
  if (["open", "high", "low", "close", "volume", "price"].includes(raw)) {
    return `bar.${raw === "price" ? "close" : raw}`;
  }
  const emaMatch = raw.match(/^ema_?(\d+)$/i);
  if (emaMatch) return `indicators.ema_${emaMatch[1]}`;
  const smaMatch = raw.match(/^sma_?(\d+)$/i);
  if (smaMatch) return `indicators.sma_${smaMatch[1]}`;
  if (CONTEXT_ROOTS.has(raw)) return raw;
  return `indicators.${raw}`;
}

function tokenizeRuleText(source = "") {
  const text = String(source || "");
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const start = index;
    const two = text.slice(index, index + 2);
    if ([">=", "<=", "==", "!=", "&&", "||"].includes(two)) {
      tokens.push({ type: "operator", value: two, position: start });
      index += 2;
      continue;
    }
    if ([">", "<", "+", "-", "*", "/", "!"].includes(char)) {
      tokens.push({ type: "operator", value: char, position: start });
      index += 1;
      continue;
    }
    if (["(", ")", ","].includes(char)) {
      tokens.push({ type: char, value: char, position: start });
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      index += 1;
      let value = "";
      let closed = false;
      while (index < text.length) {
        const current = text[index];
        if (current === "\\" && index + 1 < text.length) {
          value += text[index + 1];
          index += 2;
          continue;
        }
        if (current === quote) {
          closed = true;
          index += 1;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) throw new RuleTextSyntaxError("Unterminated string", start);
      tokens.push({ type: "string", value, position: start });
      continue;
    }
    const numberMatch = text.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (numberMatch) {
      tokens.push({ type: "number", value: Number(numberMatch[0]), position: start });
      index += numberMatch[0].length;
      continue;
    }
    const identifierMatch = text.slice(index).match(/^[a-zA-Z_][a-zA-Z0-9_.]*/);
    if (identifierMatch) {
      tokens.push({ type: "identifier", value: identifierMatch[0], position: start });
      index += identifierMatch[0].length;
      continue;
    }
    throw new RuleTextSyntaxError(`Unexpected character "${char}"`, start);
  }
  tokens.push({ type: "eof", value: "", position: text.length });
  return tokens;
}

class RuleTextParser {
  constructor(source, options = {}) {
    this.tokens = tokenizeRuleText(source);
    this.index = 0;
    this.aliases = options.aliases && typeof options.aliases === "object" ? options.aliases : {};
  }

  current() {
    return this.tokens[this.index];
  }

  consume() {
    const token = this.current();
    this.index += 1;
    return token;
  }

  matches(value) {
    const token = this.current();
    return token?.value === value || String(token?.value || "").toLowerCase() === value;
  }

  accept(value) {
    if (!this.matches(value)) return false;
    this.consume();
    return true;
  }

  expect(value) {
    if (!this.accept(value)) {
      throw new RuleTextSyntaxError(`Expected "${value}"`, this.current()?.position ?? null);
    }
  }

  parse() {
    const expression = this.parseOr();
    if (this.current().type !== "eof") {
      throw new RuleTextSyntaxError(
        `Unexpected token "${this.current().value}"`,
        this.current().position,
      );
    }
    return expression;
  }

  parseOr() {
    const nodes = [this.parseAnd()];
    while (this.accept("or") || this.accept("||")) nodes.push(this.parseAnd());
    return nodes.length === 1 ? nodes[0] : { or: nodes };
  }

  parseAnd() {
    const nodes = [this.parseNot()];
    while (this.accept("and") || this.accept("&&")) nodes.push(this.parseNot());
    return nodes.length === 1 ? nodes[0] : { and: nodes };
  }

  parseNot() {
    if (this.accept("not") || this.accept("!")) return { not: this.parseNot() };
    return this.parseComparison();
  }

  parseComparison() {
    const left = this.parseAdditive();
    const token = this.current();
    const normalized = String(token?.value || "").toLowerCase();
    const operator =
      [">=", "<=", "==", "!=", ">", "<"].includes(normalized) ||
      INFIX_OPERATORS.has(normalized)
        ? normalized
        : "";
    if (!operator) return left;
    this.consume();
    return { [operator]: [left, this.parseAdditive()] };
  }

  parseAdditive() {
    let node = this.parseMultiplicative();
    while (this.matches("+") || this.matches("-")) {
      const operator = this.consume().value;
      node = { [operator]: [node, this.parseMultiplicative()] };
    }
    return node;
  }

  parseMultiplicative() {
    let node = this.parseUnary();
    while (this.matches("*") || this.matches("/")) {
      const operator = this.consume().value;
      node = { [operator]: [node, this.parseUnary()] };
    }
    return node;
  }

  parseUnary() {
    if (this.accept("-")) return { "-": [this.parseUnary()] };
    if (this.accept("+")) return this.parseUnary();
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.current();
    if (this.accept("(")) {
      const node = this.parseOr();
      this.expect(")");
      return node;
    }
    if (token.type === "number" || token.type === "string") {
      this.consume();
      return token.value;
    }
    if (token.type !== "identifier") {
      throw new RuleTextSyntaxError("Expected a value", token.position);
    }
    this.consume();
    const name = String(token.value || "");
    const lowerName = name.toLowerCase();
    if (lowerName === "true") return true;
    if (lowerName === "false") return false;
    if (lowerName === "null") return null;
    if (this.accept("(")) {
      const args = [];
      if (!this.accept(")")) {
        do {
          args.push(this.parseOr());
        } while (this.accept(","));
        this.expect(")");
      }
      return { fn: name, args };
    }
    return { var: normalizeVariableAlias(name, this.aliases) };
  }
}

function parseRuleText(source = "", options = {}) {
  const text = String(source || "").trim();
  if (!text) throw new RuleTextSyntaxError("Expression is empty", 0);
  return new RuleTextParser(text, options).parse();
}

function compileRuleExpression(value, options = {}) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new RuleTextSyntaxError(`Invalid JSON expression: ${error.message}`);
    }
  }
  return parseRuleText(text, options);
}

function expressionFromDefinition(definition = {}, options = {}) {
  const source =
    definition?.condition ??
    definition?.when ??
    definition?.expression ??
    definition?.text ??
    null;
  return compileRuleExpression(source, options);
}

export {
  RuleTextSyntaxError,
  compileRuleExpression,
  expressionFromDefinition,
  normalizeVariableAlias,
  parseRuleText,
  tokenizeRuleText,
};
