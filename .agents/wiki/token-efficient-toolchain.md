# Token-Efficient Toolchain (RTK + Helpers)

Use this stack to reduce token usage and speed up AI-assisted work.

## Install

```bash
bash scripts/install_token_toolchain.sh
```

## Core Principle

Wrap verbose commands with `rtk`, then use narrow/surgical CLI tools.

## Preferred Commands

- Find files: `rtk fd <pattern> .`
- Find text: `rtk rg -n "<pattern>" <path>`
- Read small range: `rtk sed -n '120,220p' <file>`
- Tail logs: `rtk tail -n 120 <file>`
- JSON query: `rtk jq '<query>' <file.json>`
- Git diff view: `rtk git -c core.pager=delta diff -- <path>`
- Fast benchmark: `rtk hyperfine '<cmd1>' '<cmd2>'`
- Disk usage summary: `rtk dust -d 2`

## Token-Saving Habits

- Never dump full files if a range is enough.
- Prefer scoped path queries over repo-wide scans.
- Cap output with `head`, `tail`, `sed -n`, or tool-specific limits.
- For huge logs, search first (`rg`), then read a narrow range.

## Quick Audit

```bash
rtk gain
rtk gain --history
```
