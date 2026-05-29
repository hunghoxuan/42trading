import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

/**
 * Accessible dropdown menu. Uses Portal with a local container div
 * to keep react-router NavLinks within Router context.
 */
export default function NavDropdown({ trigger, children, align = "end" }) {
  const [container, setContainer] = useState(null);

  return (
    <div ref={setContainer} className="nav-dropdown">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          {trigger}
        </DropdownMenu.Trigger>
        {container && (
          <DropdownMenu.Portal container={container}>
            <DropdownMenu.Content
              className="nav-dropdown-menu"
              align={align}
              sideOffset={4}
            >
              {children}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </DropdownMenu.Root>
    </div>
  );
}
