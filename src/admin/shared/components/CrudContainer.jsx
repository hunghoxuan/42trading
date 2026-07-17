import { useEffect } from "react";
import DataTable from "./DataTable";
import ResponsivePanel from "./ResponsivePanel";
import "./CrudContainer.css";

function CrudCloseButton({
  onClick,
  label = "Close detail panel",
  className = "",
}) {
  return (
    <button
      type="button"
      className={["crud-container__close", className].filter(Boolean).join(" ")}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      ×
    </button>
  );
}

function CrudToolbarActionButton({
  label,
  onClick,
  className = "primary-button",
  disabled = false,
  type = "button",
  children = null,
  ariaLabel = "",
  title = "",
}) {
  return (
    <button
      type={type}
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel || label}
      title={title || ariaLabel || label}
    >
      {children || label}
    </button>
  );
}

export function CrudToolbar({
  filters = null,
  actions = null,
  actionItems = [],
  displayMode = "top",
  className = "",
}) {
  const resolvedDisplayMode = String(displayMode || "top").toLowerCase();
  const isInsideList = resolvedDisplayMode === "inside_list";

  return (
    <div
      className={[
        "crud-toolbar",
        isInsideList ? "crud-toolbar--inside-list" : "crud-toolbar--top",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="crud-toolbar__filters">{filters}</div>
      <div className="crud-toolbar__actions">
        {actions}
        {Array.isArray(actionItems)
          ? actionItems.map((item, index) => (
              <CrudToolbarActionButton
                key={item.key || item.label || index}
                label={item.label}
                onClick={item.onClick}
                className={item.className || "primary-button"}
                disabled={Boolean(item.disabled)}
                type={item.type || "button"}
                ariaLabel={item.ariaLabel}
                title={item.title}
              >
                {item.children}
              </CrudToolbarActionButton>
            ))
          : null}
      </div>
    </div>
  );
}

export function CrudListContainer({
  title = "",
  subtitle = "",
  headerActions = null,
  toolbar = null,
  children = null,
  tableProps = null,
  className = "",
  panelClassName = "",
  panelProps = {},
}) {
  return (
    <ResponsivePanel
      title={title}
      subtitle={subtitle}
      headerActions={headerActions}
      showToggle={false}
      className={["crud-container__panel", "crud-container__panel--list", panelClassName]
        .filter(Boolean)
        .join(" ")}
      bodyClassName={["crud-container__panel-body", className].filter(Boolean).join(" ")}
      {...panelProps}
    >
      {toolbar}
      {children || (tableProps ? <DataTable {...tableProps} /> : null)}
    </ResponsivePanel>
  );
}

export function CrudDetailContainer({
  title = "",
  subtitle = "",
  headerActions = null,
  children,
  open = true,
  onClose,
  closeButton = true,
  closeButtonLabel = "Close detail panel",
  className = "",
  panelClassName = "",
  panelProps = {},
}) {
  if (!open) return null;

  return (
    <ResponsivePanel
      title={title}
      subtitle={subtitle}
      headerActions={
        <>
          {headerActions}
          {closeButton ? (
            <CrudCloseButton onClick={onClose} label={closeButtonLabel} />
          ) : null}
        </>
      }
      showToggle={false}
      className={["crud-container__panel", "crud-container__panel--detail", panelClassName]
        .filter(Boolean)
        .join(" ")}
      bodyClassName={["crud-container__panel-body", className].filter(Boolean).join(" ")}
      {...panelProps}
    >
      {children}
    </ResponsivePanel>
  );
}

function CrudModal({
  open,
  title,
  subtitle = "",
  children,
  onClose,
  closeButton = true,
  closeButtonLabel = "Close detail panel",
}) {
  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && closeButton) onClose?.();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeButton, onClose, open]);

  if (!open) return null;

  return (
    <div className="crud-container__modal" role="dialog" aria-modal="true">
      <button
        type="button"
        className="crud-container__modal-backdrop"
        aria-label={closeButtonLabel}
        onClick={closeButton ? onClose : undefined}
      />
      <section className="crud-container__modal-panel">
        <ResponsivePanel
          title={title}
          subtitle={subtitle}
          headerActions={
            closeButton ? (
              <CrudCloseButton onClick={onClose} label={closeButtonLabel} />
            ) : null
          }
          showToggle={false}
          className="crud-container__panel crud-container__panel--detail crud-container__panel--modal"
          bodyClassName="crud-container__panel-body"
        >
          {children}
        </ResponsivePanel>
      </section>
    </div>
  );
}

export default function CrudContainer({
  className = "",
  toolbar = null,
  list = {},
  detail = {},
  detailOpen = true,
  onDetailOpenChange,
  detailMode = "section",
  detailCloseButton = true,
  detailCloseButtonLabel = "Close detail panel",
  detailVisible = true,
  sameHeight = true,
}) {
  const effectiveDetailMode = String(detailMode || "section").toLowerCase();
  const isModal = effectiveDetailMode === "modal";
  const canClose = detailCloseButton !== false;
  const detailIsOpen = canClose ? Boolean(detailOpen) : true;
  const detailIsVisible = Boolean(detailVisible) && detailIsOpen;
  const toolbarDisplayMode = String(toolbar?.displayMode || "top").toLowerCase();
  const topToolbar =
    toolbar && toolbarDisplayMode === "top" ? (
      <CrudToolbar {...toolbar} displayMode="top" />
    ) : null;
  const insideListToolbar =
    toolbar && toolbarDisplayMode === "inside_list" ? (
      <CrudToolbar {...toolbar} displayMode="inside_list" />
    ) : null;

  const handleClose = () => {
    if (!canClose) return;
    onDetailOpenChange?.(false);
  };

  return (
    <>
      {topToolbar}
      <div
        className={[
          "crud-container",
          sameHeight ? "crud-container--same-height" : "",
          detailIsVisible && !isModal ? "crud-container--with-detail" : "crud-container--list-only",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="crud-container__list">
          <CrudListContainer {...list} toolbar={insideListToolbar} />
        </div>

        {!isModal && detailIsVisible ? (
          <div className="crud-container__detail">
            <CrudDetailContainer
              {...detail}
              open={detailIsVisible}
              onClose={handleClose}
              closeButton={canClose}
              closeButtonLabel={detailCloseButtonLabel}
            />
          </div>
        ) : null}
      </div>

      {isModal ? (
        <CrudModal
          open={detailIsVisible}
          title={detail.title}
          subtitle={detail.subtitle}
          onClose={handleClose}
          closeButton={canClose}
          closeButtonLabel={detailCloseButtonLabel}
        >
          {detail.children}
        </CrudModal>
      ) : null}
    </>
  );
}
