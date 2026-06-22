import React from "react";
import FormComboSelect from "../../shared/components/FormComboSelect";

export default function SearchFilterBar({
  search = null,
  filters = [],
  actions = null,
  style = {},
}) {
  return (
    <div
      className="toolbar-group toolbar-search-filter"
      style={{ flexWrap: "wrap", ...style }}
    >
      {search ? (
        <input
          type="text"
          placeholder={search.placeholder || "SEARCH..."}
          value={search.value || ""}
          onChange={(e) => search.onChange?.(e.target.value)}
          style={search.style}
        />
      ) : null}
      {filters.map((filter) => (
        <FormComboSelect
          key={filter.key}
          value={filter.value || ""}
          onChange={(e) => filter.onChange?.(e.target.value)}
          style={filter.style}
        >
          {(filter.options || []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </FormComboSelect>
      ))}
      {actions}
    </div>
  );
}
