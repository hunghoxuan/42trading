import * as TooltipPrimitive from "@radix-ui/react-tooltip";

/**
 * Accessible tooltip. Wraps children and shows content on hover/focus.
 *
 * Props:
 *   content  – ReactNode (tooltip text)
 *   children – ReactNode (trigger element)
 *   side     – "top" | "right" | "bottom" | "left" (default "top")
 */
export default function Tooltip({ content, children, side = "top" }) {
  if (!content) return children;
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className="tooltip-content"
            side={side}
            sideOffset={4}
          >
            {content}
            <TooltipPrimitive.Arrow className="tooltip-arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
