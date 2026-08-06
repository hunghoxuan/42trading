import { useMemo, useState } from "react";
import "./Accordion.css";

function normalizeDefaultOpenIds(defaultOpenIds, items) {
  if (Array.isArray(defaultOpenIds) && defaultOpenIds.length) {
    return defaultOpenIds.map((item) => String(item));
  }
  const firstEnabledItem = (Array.isArray(items) ? items : []).find((item) => !item?.disabled);
  return firstEnabledItem?.defaultOpen ? [String(firstEnabledItem.id)] : [];
}

export default function Accordion({
  items = [],
  multiple = true,
  defaultOpenIds = [],
  className = "",
}) {
  const normalizedItems = useMemo(
    () =>
      (Array.isArray(items) ? items : []).map((item, index) => ({
        ...item,
        id: String(item?.id || `accordion_${index}`),
      })),
    [items],
  );

  const [openIds, setOpenIds] = useState(() =>
    normalizeDefaultOpenIds(defaultOpenIds, normalizedItems),
  );

  const openSet = new Set(openIds);

  const toggleItem = (itemId) => {
    setOpenIds((current) => {
      const isOpen = current.includes(itemId);
      if (multiple) {
        return isOpen ? current.filter((entry) => entry !== itemId) : [...current, itemId];
      }
      return isOpen ? [] : [itemId];
    });
  };

  return (
    <div className={["accordion", className].filter(Boolean).join(" ")}>
      {normalizedItems.map((item) => {
        const isOpen = openSet.has(item.id);
        return (
          <section
            key={item.id}
            className={`accordion__item ${isOpen ? "is-open is-active active selected" : "is-closed"}`}
          >
            <button
              type="button"
              className="accordion__trigger"
              onClick={() => toggleItem(item.id)}
              aria-expanded={isOpen}
              disabled={item.disabled}
            >
              <span className="accordion__title-group">
                <span className="accordion__title">{item.title}</span>
                {item.subtitle ? (
                  <span className="accordion__subtitle">{item.subtitle}</span>
                ) : null}
              </span>
              <span className="accordion__chevron" aria-hidden="true">
                {isOpen ? "▲" : "▼"}
              </span>
            </button>
            {isOpen ? <div className="accordion__content">{item.content}</div> : null}
          </section>
        );
      })}
    </div>
  );
}
