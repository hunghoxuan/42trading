import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

/**
 * Accessible dropdown menu. Replaces the CSS-hover .nav-dropdown pattern.
 *
 * Props:
 *   trigger   – ReactNode (the button/link that opens the menu)
 *   children  – ReactNode (menu items — links, buttons, etc.)
 *   align     – "start" | "center" | "end" (default "end")
 */
export default function NavDropdown({ trigger, children, align = "end" }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        className="nav-dropdown-menu"
        align={align}
        sideOffset={4}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
