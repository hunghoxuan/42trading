# Trading VPS MCP Wrapper

This package wraps your VPS API as MCP tools.

This package supports both:
- **local stdio MCP** (Claude Desktop)
- **remote Streamable HTTP MCP** (Claude.ai web custom connector)

## Support Matrix

- Claude Desktop local MCP: supported now (via `claude_desktop_config.json`)
- Claude.ai web (custom connectors): requires a **remote MCP server URL** (public HTTPS), not local stdio
- Claude mobile: can use remote connectors already added from Claude.ai

## 1) Install

```bash
cd /Users/macmini/Projects/moza/42trade/mcp-vps-api
npm install
```

## 2) Environment

Set env vars:

- `VPS_API_BASE_URL` (example: `https://trade.mozasolution.com`)
- `VPS_API_KEY` (your server API key)
- optional `VPS_DEFAULT_SYMBOL` (default `ICMARKETS:UK100`)

Remote MCP extras:

- `MCP_TRANSPORT_MODE=http`
- `MCP_PORT` (default `8443`)
- `MCP_SERVER_TOKEN` (optional but recommended)
- `MCP_HTTPS_ENABLED` (`1` default)
- `MCP_HTTPS_CERT_PATH` and `MCP_HTTPS_KEY_PATH`

## 3) Run (Local MCP / stdio)

```bash
npm start
```

## 4) Claude Desktop (Local MCP)

Add to Claude Desktop config:

```json
{
  "mcpServers": {
    "trading-vps-api": {
      "command": "node",
      "args": ["/Users/macmini/Projects/moza/42trade/mcp-vps-api/server.mjs"],
      "env": {
        "VPS_API_BASE_URL": "https://trade.mozasolution.com",
        "VPS_API_KEY": "YOUR_API_KEY",
        "VPS_DEFAULT_SYMBOL": "ICMARKETS:UK100"
      }
    }
  }
}
```

## 5) Run Remote MCP (Claude.ai Web)

Run locally (for server deployment testing):

```bash
MCP_TRANSPORT_MODE=http \
MCP_PORT=8443 \
MCP_SERVER_TOKEN=CHANGE_ME \
VPS_API_BASE_URL=https://trade.mozasolution.com/webhook \
VPS_API_KEY=YOUR_API_KEY \
node server.mjs
```

Health check:

```bash
curl -sS https://trade.mozasolution.com:8443/health
```

MCP endpoint URL:

- `https://trade.mozasolution.com:8443/mcp`

Auth header (if `MCP_SERVER_TOKEN` is set):

- `Authorization: Bearer <MCP_SERVER_TOKEN>`
- Recommended on this VPS: set `MCP_SERVER_TOKEN` = existing `SIGNAL_API_KEY`

## 6) Claude.ai Web Setup (Step-by-step)

1. Open Claude.ai → `Customize` → `Connectors`.
2. Click `Add custom connector`.
3. Name: `Trading VPS MCP`.
4. URL: `https://trade.mozasolution.com:8443/mcp`.
5. If using token auth, add header:
   - key: `Authorization`
   - value: `Bearer <MCP_SERVER_TOKEN>`
6. Save and enable connector in your chat/project.
7. Ask Claude: `run vps_health`.

Notes:

- Free plan may limit number of custom connectors.
- Remote connectors are in beta.
- Local `claude_desktop_config.json` MCP entries do not appear in Claude.ai web.

## 7) Skill Usage (Desktop + Web)

Use [CLAUDE_SKILL_TEMPLATE.md](./CLAUDE_SKILL_TEMPLATE.md) as:

- Claude Desktop: project/system instructions with MCP tools enabled.
- Claude.ai web: project instructions after enabling your remote connector.

## Exposed MCP tools

- `vps_health`
- `vps_symbol_search`
- `vps_capture_snapshots_3tf`
- `vps_analyze_latest_3_claude`
- `vps_add_signal`
