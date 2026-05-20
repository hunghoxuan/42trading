# Handoff: AI info density + semantic color coding + object label update

## Read First
- `/Users/macmini/Trade/Bot/trading/.agents/.product/tickets/1-backlog/plan-update-feature-ai-info-density-color-coding-and-object-labeling.md`
- `/Users/macmini/Trade/Bot/trading/AI.md`
- `/Users/macmini/Trade/Bot/trading/.agents/BOOTSTRAP.md`
- `/Users/macmini/Trade/Bot/trading/.agents/rules/ui.md`
- `/Users/macmini/Trade/Bot/trading/.agents/rules/testing.md`

## User Intent
Improve scan speed and decision clarity by:
1. Mirroring Screen-1 top decision info in Screen-2.
2. Applying semantic colors for status semantics:
   - green = proceed/positive
   - red = danger/negative
   - yellow = warning/caution
   - white = neutral/normal
3. Increasing information density in context/risk/object editor surfaces.
4. Enforcing chart label format `type + label` when Type changes.

## Screenshot Anchors
- Screen 1: strategy/entry/grade/risk/confidence/eta/action badges
- Screen 2: target area to include mirrored badge info + strength colors
- Screen 3: context/info should be 4-5 columns desktop
- Screen 4: yes/no true/false high/low should be colorized
- Screen 5: object editor 6-column dense layout + label format fix

## Execution Scope
- `web-ui` only.
- No backend/API/schema changes.
- Keep all unrelated behavior unchanged.

## Required Checks
```bash
rtk npm --prefix web-ui run build
```

## Return Format
- root-cause / rationale
- file list changed
- exact semantic mapping table
- desktop/mobile breakpoint notes
- screenshot parity notes for screens 1-5
- deploy status (if deployed)
