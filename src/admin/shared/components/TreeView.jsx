import { useCallback, useMemo, useState } from "react";
import "./TreeView.css";

function defaultGetItemId(item) {
  return String(item?.id ?? item?.path ?? item?.key ?? item?.name ?? "");
}

function defaultGetItemChildren(item) {
  return Array.isArray(item?.children) ? item.children : [];
}

function branchContainsSelectedItem(item, selectedId, getItemId, getItemChildren) {
  const currentId = String(getItemId(item) || "");
  const normalizedSelectedId = String(selectedId || "");
  if (!normalizedSelectedId) return false;
  if (currentId === normalizedSelectedId) return true;
  const children = getItemChildren(item);
  return children.some((child) =>
    branchContainsSelectedItem(child, normalizedSelectedId, getItemId, getItemChildren),
  );
}

function TreeBranch({
  item,
  depth = 0,
  selectedId = "",
  expandedIdSet,
  getItemId,
  getItemChildren,
  getItemLabel,
  getItemMeta,
  getItemHeaderMeta,
  getItemDisabled,
  getItemIcon,
  onItemClick,
  onSelectionChange,
  onToggleItem,
}) {
  const itemId = String(getItemId(item) || "");
  const children = getItemChildren(item);
  const hasChildren = children.length > 0;
  const isExpanded = hasChildren && expandedIdSet.has(itemId);
  const isActive = itemId === String(selectedId || "");
  const hasActiveDescendant =
    hasChildren &&
    !isActive &&
    children.some((child) =>
      branchContainsSelectedItem(child, selectedId, getItemId, getItemChildren),
    );
  const isDisabled = Boolean(getItemDisabled(item));
  const label = getItemLabel(item);
  const meta = getItemMeta(item);
  const headerMeta = getItemHeaderMeta(item);
  const icon = getItemIcon
    ? getItemIcon(item, { depth, hasChildren })
    : "";

  const handleItemClick = useCallback(() => {
    if (isDisabled) return;
    if (hasChildren) onToggleItem(itemId);
    if (typeof onSelectionChange === "function") onSelectionChange(item, itemId);
    if (typeof onItemClick === "function") onItemClick(item, itemId);
  }, [hasChildren, isDisabled, itemId, item, onItemClick, onSelectionChange, onToggleItem]);

  return (
    <div
      className={`tree-view__branch${hasChildren ? " is-folder" : " is-leaf"}`}
      data-depth={depth}
      style={{ "--tree-depth": depth }}
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={isActive}
      aria-disabled={isDisabled || undefined}
    >
      <div className="tree-view__row">
        <button
          type="button"
          className="tree-view__toggle"
          onClick={() => onToggleItem(itemId)}
          disabled={!hasChildren || isDisabled}
          aria-label={hasChildren ? (isExpanded ? "Collapse" : "Expand") : "Leaf"}
          aria-expanded={hasChildren ? isExpanded : undefined}
          tabIndex={-1}
        >
          {hasChildren ? (
            <span className={`tree-view__chevron ${isExpanded ? "is-expanded" : ""}`}>
              ▸
            </span>
          ) : (
            <span className="tree-view__dot">•</span>
          )}
        </button>
        <button
          type="button"
          className={`tree-view__item${isActive ? " is-active" : ""}${hasActiveDescendant ? " is-active-parent" : ""}${isDisabled ? " is-disabled" : ""}${hasChildren ? " is-folder" : " is-leaf"}`}
          onClick={handleItemClick}
          disabled={isDisabled}
        >
          <div className="tree-view__header">
            {icon ? (
              <span
                className={`tree-view__icon${hasChildren ? " is-folder" : " is-file"}`}
                aria-hidden="true"
              >
                {icon}
              </span>
            ) : !hasChildren ? (
              <span className="tree-view__marker is-leaf" aria-hidden="true" />
            ) : null}
            <div className="tree-view__label">{label}</div>
            {headerMeta ? (
              <div className="tree-view__header-meta">{headerMeta}</div>
            ) : null}
          </div>
          {meta ? <div className="tree-view__meta">{meta}</div> : null}
        </button>
      </div>
      {hasChildren && isExpanded ? (
        <div className="tree-view__children" role="group">
          {children.map((child, index) => (
            <TreeBranch
              key={`${String(getItemId(child) || `child-${index}`)}`}
              item={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIdSet={expandedIdSet}
              getItemId={getItemId}
              getItemChildren={getItemChildren}
              getItemLabel={getItemLabel}
              getItemMeta={getItemMeta}
              getItemHeaderMeta={getItemHeaderMeta}
              getItemDisabled={getItemDisabled}
              getItemIcon={getItemIcon}
              onItemClick={onItemClick}
              onSelectionChange={onSelectionChange}
              onToggleItem={onToggleItem}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function TreeView({
  items = [],
  selectedId = "",
  expandedIds = null,
  defaultExpandedIds = [],
  getItemId = defaultGetItemId,
  getItemChildren = defaultGetItemChildren,
  getItemLabel = (item) => item?.label || item?.name || "/",
  getItemMeta = () => null,
  getItemHeaderMeta = () => "",
  getItemDisabled = () => false,
  getItemIcon = null,
  onItemClick = null,
  onSelectionChange = null,
  onExpandedIdsChange = null,
  className = "",
  ariaLabel = "Tree view",
}) {
  const controlled = Array.isArray(expandedIds);
  const [internalExpandedIds, setInternalExpandedIds] = useState(() =>
    Array.isArray(defaultExpandedIds) ? defaultExpandedIds : [],
  );
  const currentExpandedIds = controlled ? expandedIds : internalExpandedIds;
  const expandedIdSet = useMemo(
    () => new Set((Array.isArray(currentExpandedIds) ? currentExpandedIds : []).map((value) => String(value || ""))),
    [currentExpandedIds],
  );

  const updateExpandedIds = useCallback(
    (nextIds) => {
      if (!controlled) {
        setInternalExpandedIds(nextIds);
      }
      if (typeof onExpandedIdsChange === "function") {
        onExpandedIdsChange(nextIds);
      }
    },
    [controlled, onExpandedIdsChange],
  );

  const handleToggleItem = useCallback(
    (itemId) => {
      const normalizedId = itemId == null ? "" : String(itemId);
      const nextSet = new Set(expandedIdSet);
      if (nextSet.has(normalizedId)) nextSet.delete(normalizedId);
      else nextSet.add(normalizedId);
      updateExpandedIds(Array.from(nextSet));
    },
    [expandedIdSet, updateExpandedIds],
  );

  return (
    <div
      className={["tree-view", className].filter(Boolean).join(" ")}
      role="tree"
      aria-label={ariaLabel}
    >
      {(Array.isArray(items) ? items : []).map((item, index) => (
        <TreeBranch
          key={`${String(getItemId(item) || `root-${index}`)}`}
          item={item}
          depth={0}
          selectedId={selectedId}
          expandedIdSet={expandedIdSet}
          getItemId={getItemId}
          getItemChildren={getItemChildren}
          getItemLabel={getItemLabel}
          getItemMeta={getItemMeta}
          getItemHeaderMeta={getItemHeaderMeta}
          getItemDisabled={getItemDisabled}
          getItemIcon={getItemIcon}
          onItemClick={onItemClick}
          onSelectionChange={onSelectionChange}
          onToggleItem={handleToggleItem}
        />
      ))}
    </div>
  );
}
