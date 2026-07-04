import { useConfirmDialog } from "./ConfirmDialog";
import ComboButtonMenu from "./ComboButtonMenu";

function normalizeItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (item && typeof item === "object") {
      return {
        value: String(item.value ?? ""),
        label: String(item.label ?? item.value ?? ""),
      };
    }
    return {
      value: String(item ?? ""),
      label: String(item ?? ""),
    };
  });
}

export default function BulkActionsButton({
  items = [],
  onClick,
  buttonText = "RUN",
  selectedItems = "",
  onSelectedItemsChange,
  displayMode = "combo",
  disabled = false,
  loading = false,
  buttonDisabled = false,
  selectId,
  ariaLabel = "Bulk Action",
  className = "",
  getConfirmOptions,
}) {
  const confirm = useConfirmDialog();
  const options = normalizeItems(items);
  const placeholderOption =
    options.find(
      (option) =>
        !String(option.value ?? "").trim() && String(option.label ?? "").trim(),
    ) || null;
  const actionableOptions = options.filter((option) =>
    Boolean(String(option.value ?? "").trim()),
  );
  const value = String(selectedItems ?? "");
  const normalizedDisplayMode = ["combo", "menu", "buttons"].includes(
    String(displayMode || "").toLowerCase(),
  )
    ? String(displayMode || "").toLowerCase()
    : "combo";

  async function runAction(nextValue) {
    const effectiveValue = String(nextValue ?? "");
    if (!effectiveValue) return;
    if (typeof getConfirmOptions === "function") {
      const confirmOptions = getConfirmOptions(effectiveValue);
      if (confirmOptions) {
        const ok = await confirm(confirmOptions);
        if (!ok) return;
      }
    }
    await onClick?.(effectiveValue);
  }

  function selectedLabel() {
    return (
      actionableOptions.find((option) => option.value === value)?.label ||
      placeholderOption?.label ||
      actionableOptions[0]?.label ||
      "Select..."
    );
  }

  return (
    <div
      className={`bulk-actions-button ${className}`.trim()}
      role="group"
      aria-label={ariaLabel}
      data-component="BulkActionsButton"
    >
      {normalizedDisplayMode === "combo" ? (
        <>
          <ComboButtonMenu
            items={actionableOptions}
            value={value}
            onChange={(nextValue) => onSelectedItemsChange?.(nextValue)}
            buttonText={selectedLabel()}
            disabled={disabled || loading}
            selectId={selectId}
            ariaLabel={ariaLabel}
            triggerClassName="bulk-actions-button-select bulk-actions-button-trigger"
          />
          <button
            type="button"
            className={`primary-button bulk-actions-button-run ${loading ? "btn-busy" : ""}`}
            onClick={() => runAction(value)}
            disabled={disabled || loading || buttonDisabled || !value}
          >
            {loading ? (
              <div className="spinner" style={{ width: 14, height: 14 }} />
            ) : (
              buttonText
            )}
          </button>
        </>
      ) : null}

      {normalizedDisplayMode === "menu" ? (
        <ComboButtonMenu
          items={actionableOptions}
          value={value}
          onChange={(nextValue) => runAction(nextValue)}
          buttonText={buttonText}
          disabled={disabled || loading || actionableOptions.length === 0}
          selectId={selectId}
          ariaLabel={ariaLabel}
          triggerClassName="bulk-actions-button-menu-trigger"
        />
      ) : null}

      {normalizedDisplayMode === "buttons" ? (
        <div
          className="bulk-actions-button-list"
          data-component="ComboButtonGroup"
        >
          {actionableOptions.map((option) => (
            <button
              key={`${option.value}::${option.label}`}
              type="button"
              className={
                value === option.value
                  ? "primary-button bulk-actions-button-list-item active"
                  : "secondary-button bulk-actions-button-list-item"
              }
              disabled={disabled || loading}
              onClick={() => runAction(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
