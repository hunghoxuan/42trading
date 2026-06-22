# Ticket: Implement Advanced Order Panel

## Summary
Create a new `AdvancedOrderPanel` component that combines the existing `SizeCalculator` logic with a signal-dispatching execution form.

## Tasks
- [ ] **Component Development**:
    - Create `src/ui/src/components/AdvancedOrderPanel.jsx`.
    - Port logic from `SizeCalculator.jsx` (Risk calc, Lot sizing).
    - Port UI from `TradePlanEditor.jsx` (Entry/SL/TP sliders and inputs).
- [ ] **Execution Logic**:
    - Implement `handleSubmit` to call `api.createSignal`.
    - Support `source: "MANUAL"` and `type: "limit|market|stop"`.
- [ ] **Dashboard Integration**:
    - Replace the basic `SizeCalculator` in `DashboardPage.jsx` with the new `AdvancedOrderPanel`.
    - Ensure it reacts to symbol changes from other dashboard components.

## Constraints
- Must use `symbol_metrics` from the selected account.
- Must provide clear feedback (success/error) after placement.
- Must respect `MaxRiskAmount` and `MaxVolumePercent` (if applicable).

## Related
- Feature: [../features/1-plan/advanced_order_entry.md]
