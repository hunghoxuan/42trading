import * as Dialog from "@radix-ui/react-dialog";

export default function EdgeSlidePanel({
  trigger = null,
  open,
  onOpenChange,
  title = "",
  description = "",
  headerActions = null,
  showCloseButton = true,
  children,
  side = "right",
  panelSize = "420px",
  mobilePanelSize = "66.666vw",
  className = "",
  contentClassName = "",
}) {
  const resolvedDescription = String(description || "").trim() || "Slide panel";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay
          className="edge-slide-panel__overlay"
          data-component="EdgeSlidePanelOverlay"
        />
        <Dialog.Content
          className={`edge-slide-panel__content ${contentClassName}`.trim()}
          data-component="EdgeSlidePanel"
          data-side={side}
          style={{
            "--edge-slide-panel-size": panelSize,
            "--edge-slide-panel-mobile-size": mobilePanelSize,
          }}
        >
          <Dialog.Description className="sr-only">
            {resolvedDescription}
          </Dialog.Description>
          {(title || headerActions) && (
            <div className="edge-slide-panel__header">
              <Dialog.Title className="edge-slide-panel__title">
                {title}
              </Dialog.Title>
              {(headerActions || showCloseButton) && (
                <div className="edge-slide-panel__actions">
                  {headerActions}
                  {showCloseButton ? (
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="edge-slide-panel__close"
                        aria-label="Close panel"
                      >
                        x
                      </button>
                    </Dialog.Close>
                  ) : null}
                </div>
              )}
            </div>
          )}
          <div className={`edge-slide-panel__body ${className}`.trim()}>
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
