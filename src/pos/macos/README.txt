42Trade POS for macOS 0.1.0

Requires macOS 12 or later. Supports Apple Silicon and Intel.
Connect this Mac to the same Tailscale network as the POS Mac mini.
Extract the ZIP, drag 42Trade POS.app into Applications, open it, and sign in.
The POS server must be running at https://hunghx.tail02c7f8.ts.net:8443/admin/pos.

This direct-download app is ad-hoc signed and is not notarized by Apple. On a
Mac that downloaded it, macOS may require the owner to approve opening it in
System Settings > Privacy & Security. Only the owner should make that decision.
Do not disable Gatekeeper, certificate checks, or other system protections.

Camera access is requested only when scanning. Microphone access is denied.
The app keeps its own login and offline data in macOS WebKit storage.
Deleting app data can remove pending offline sales: synchronize first.
The hosted development server does not provide a cold-start offline app shell.

Source and build instructions: docs/pos-macos.md in hunghoxuan/42trading on GitHub.
