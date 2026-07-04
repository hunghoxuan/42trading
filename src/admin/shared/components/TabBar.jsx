import React from "react";
import GroupButtons from "./GroupButtons";

export default function TabBar({
  value,
  options = [],
  onChange,
  size = "md",
  className = "",
  style = null,
  ariaLabel = "Tab bar",
}) {
  const buttonStyle =
    size === "md"
      ? { fontSize: 12, padding: "10px 12px" }
      : { fontSize: 11, padding: "4px 10px" };
  return (
    <GroupButtons
      items={options.map((opt) => ({
        label: opt.label,
        value: opt.value,
        disabled: opt.disabled,
        style: opt.style,
      }))}
      selectedItems={[value]}
      selectionMode="single"
      onChange={([nextValue]) => onChange?.(nextValue)}
      border_type="multiple"
      size="md"
      buttonStyle={buttonStyle}
      className={className}
      style={style}
      ariaLabel={ariaLabel}
    />
  );
}
