const fs = require("fs");
let f = fs.readFileSync("webhook/server.js", "utf8");

// 1. Add OPENROUTER_API_KEY to allowed set
f = f.replace(
  '"TWELVE_DATA_API_KEY",',
  '"TWELVE_DATA_API_KEY",\n  "OPENROUTER_API_KEY",'
);

// 2. Add openrouter to normalizeAiApiKeyName
f = f.replace(
  'if (name === "DEEPSEEK" || name === "DEEPSEEK_KEY") return "DEEPSEEK_API_KEY";',
  'if (name === "DEEPSEEK" || name === "DEEPSEEK_KEY") return "DEEPSEEK_API_KEY";\n  if (name === "OPENROUTER" || name === "OPENROUTER_KEY") return "OPENROUTER_API_KEY";'
);

// 3. In callAiProvider: detect openrouter model in provider routing
f = f.replace(
  'modelLower.includes("deepseek")',
  'modelLower.includes("openrouter") || modelLower.includes("deepseek")'
);

// 4. In callAiProvider key selection: openrouter uses its own key
f = f.replace(
  'provider === "deepseek"\n      ? cfg.DEEPSEEK_API_KEY',
  'provider === "deepseek"\n      ? cfg.DEEPSEEK_API_KEY\n      : provider === "openrouter"\n      ? (cfg.OPENROUTER_API_KEY || "")'
);

// 5. In callAiProvider endpoint: openrouter endpoint
f = f.replace(
  'provider === "deepseek"\n      ? "https://api.deepseek.com/chat/completions"',
  'provider === "openrouter"\n      ? "https://openrouter.ai/api/v1/chat/completions"\n      : provider === "deepseek"\n      ? "https://api.deepseek.com/chat/completions"'
);

// 6. OpenRouter supports images — skip the isDeepSeek image stripping
f = f.replace(
  "const isDeepSeek = provider === ",
  "const isDeepSeek = provider === "
);

// 7. In /v2/ai/generate: add openrouter provider
f = f.replace(
  '} else if (provider === "openai") {\n        endpoint = "https://api.openai.com/v1/chat/completions";',
  '} else if (provider === "openrouter") {\n        endpoint = "https://openrouter.ai/api/v1/chat/completions";\n        authHeader = `Bearer ${apiKey}`;\n        if (!requestModel) requestModel = "openai/gpt-4o";\n        bodyData = { model: requestModel, messages: [{ role: "user", content: finalPrompt }], response_format: { type: "json_object" } };\n      } else if (provider === "openai") {\n        endpoint = "https://api.openai.com/v1/chat/completions";'
);

// 8. In /v2/ai/generate key selection: add openrouter
f = f.replace(
  'provider === "deepseek"\n          ? config.DEEPSEEK_API_KEY\n          : provider === "openai"',
  'provider === "deepseek"\n          ? config.DEEPSEEK_API_KEY\n          : provider === "openrouter"\n          ? (config.OPENROUTER_API_KEY || "")\n          : provider === "openai"'
);

// 9. In /v2/ai/generate: detect openrouter from model name
f = f.replace(
  'const provider = (bodyProvider || service || "gemini").toLowerCase();',
  'let provider = (bodyProvider || service || "gemini").toLowerCase();\n      if (requestModel && (requestModel.includes("openrouter") || requestModel.includes("open-router"))) provider = "openrouter";'
);

// 10. Update error message
f = f.replace(
  "Allowed: GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, CLAUDE_API_KEY, TWELVE_DATA_API_KEY",
  "Allowed: GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, CLAUDE_API_KEY, OPENROUTER_API_KEY, TWELVE_DATA_API_KEY"
);

fs.writeFileSync("webhook/server.js", f);
console.log("done");
