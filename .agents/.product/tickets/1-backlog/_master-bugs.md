# Known Bugs

*(Format: `- [ ] [YYYY-MM-DD HH:MM] [SEV:P0/P1/P2] [STATUS:OPEN/IN_PROGRESS/BLOCKED/DONE] [Module] [Author: User|Gemini|Codex] Bug: description`)*

- [ ] [2026-05-21 09:43] [SEV:P1] [STATUS:OPEN] [ChartSnapshots/Settings] [Author: User] Bug: Save toolbar settings (bars/quality/merge) shows success toast but does not persist after refresh — load `useEffect` reads `res?.items` but API returns `res?.settings`. Ticket: `1-backlog/2026-05-21-chart-snapshot-save-settings-not-persisted.md`
- [ ] [2026-05-21 10:15] [SEV:P1] [STATUS:OPEN] [TradeDetail/InfoChart/TradePlanEdit] [Author: User] Bug: TP2/TP3 do not render in Info chart, labels include unwanted `P1` and price-change text, and chart edits for SL/TP1/TP2/TP3 revert in TradePlan Edit inputs. Ticket: `1-backlog/2026-05-21-trade-info-chart-tp-lines-and-edit-revert-regression.md`
- [ ] [2026-05-21 10:24] [SEV:P1] [STATUS:OPEN] [TradeDetail/TradePlanCards/AI] [Author: User] Bug: With multiple TradePlans, card UI overlaps between cards, selecting card 2 resets to card 1, and snapshots used by AI are not traceable/displayed in UI. Ticket: `1-backlog/2026-05-21-multi-tradeplan-ui-overlap-selection-and-ai-snapshot-trace.md`
