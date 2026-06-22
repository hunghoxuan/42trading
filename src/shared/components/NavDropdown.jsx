import { Children, cloneElement, isValidElement, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

/**
 * Accessible dropdown menu. Uses Portal with a local container div
 * to keep react-router NavLinks within Router context.
 */
export default function NavDropdown({ trigger, children, align = "end" }) {
  const [container, setContainer] = useState(null);
  const wrappedChildren = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const existingOnClick = child.props.onClick;
    return cloneElement(child, {
      onClick: (event, ...rest) => {
        if (typeof existingOnClick === "function") {
          existingOnClick(event, ...rest);
        }
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("mobile-nav-close"));
        }
      },
    });
  });

  return (
    <div
      ref={setContainer}
      className="nav-dropdown"
      onClick={(e) => e.stopPropagation()}
    >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          {trigger}
        </DropdownMenu.Trigger>
        {container && (
          <DropdownMenu.Portal container={container}>
            <DropdownMenu.Content
              className="nav-dropdown-menu combo-button-menu"
              align={align}
              sideOffset={4}
            >
              {wrappedChildren}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </DropdownMenu.Root>
    </div>
  );
}
