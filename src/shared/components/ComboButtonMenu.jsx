import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

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

export default function ComboButtonMenu({
  items = [],
  value = "",
  onChange,
  buttonText = "",
  placeholder = "Select...",
  disabled = false,
  selectId,
  ariaLabel = "Select item",
  align = "start",
  sideOffset = 6,
  triggerClassName = "",
  menuClassName = "",
  fullWidth = false,
  rootClassName = "",
}) {
  const options = normalizeItems(items);
  const selectedValue = String(value ?? "");
  const selectedLabel =
    buttonText ||
    options.find((option) => option.value === selectedValue)?.label ||
    placeholder;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          id={selectId}
          type="button"
          className={[
            "secondary-button",
            "combo-button-menu-trigger",
            fullWidth ? "is-full-width" : "",
            triggerClassName,
          ]
            .filter(Boolean)
            .join(" ")}
          disabled={disabled}
          aria-label={ariaLabel}
          data-component="ComboButtonMenu.Trigger"
        >
          <span className="combo-button-menu-trigger__label">
            {selectedLabel}
          </span>
          <span
            aria-hidden="true"
            className="combo-button-menu-trigger__caret"
          >
            ▾
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={["combo-button-menu", menuClassName]
            .filter(Boolean)
            .join(" ")}
          align={align}
          sideOffset={sideOffset}
          data-component="ComboButtonMenu"
        >
          {options.map((option) => (
            <DropdownMenu.Item asChild key={`${option.value}::${option.label}`}>
              <button
                type="button"
                className={selectedValue === option.value ? "active" : ""}
                onClick={() => onChange?.(option.value)}
              >
                {option.label}
              </button>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
