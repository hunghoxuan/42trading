# AI Model Guide

## CLI
```bash
node scripts/ai.js --list
node scripts/ai.js --model deepseek-coder "Explain this code"
node scripts/ai.js --provider ollama "What is the trend?"
```

## Verify Model
- CLI prints provider/model before response.
- Example:
  - `Consulting [deepseek] using model [deepseek-coder]...`

## Config
- Project config: `.agents/provider_config.yaml`.
- Optional global config:
  - `~/.gemini/antigravity/provider_config.yaml`

## Provider Entry
```yaml
- provider: "provider_name"
  base_url: "https://api.endpoint.com/v1"
  api_key: "${ENV_VARIABLE_NAME}"
  model: "model-identifier"
```

## Notes
- Keep API keys in env.
- Do not commit real tokens.
