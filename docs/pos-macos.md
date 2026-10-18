# POS for macOS

Native AppKit/WKWebView application in `src/pos/macos`, using the same Mac mini
POS as the Android app. No Electron runtime, AI API, or App Store is required.

- Minimum OS: macOS 12 Monterey
- Architectures: universal binary (`arm64` Apple Silicon and `x86_64` Intel)
- Application ID: `com.mozasolution.pos.macos`
- Default server: `https://hunghx.tail02c7f8.ts.net:8443/admin/pos`
- Local download: `https://hunghx.tail02c7f8.ts.net:8443/downloads/pos-macos/`
- GitHub builds: `src/pos/macos/releases/` on branch `codex/pos-macos`

## Install

Download the universal ZIP, extract it, drag **42Trade POS.app** into Applications,
and open it. Connect the Mac to the same Tailscale network as the POS server.
Sign in using an existing account. The Mac mini and its POS services must be running.

The current downloadable build is ad-hoc signed, **not Apple notarized**. macOS
may block a downloaded build until its owner approves it in **System Settings →
Privacy & Security**. That approval is a user decision. No step in this project
disables Gatekeeper, removes quarantine, or bypasses certificate checks.

## Build and check

Requirements: macOS, Node.js, and Apple's command line developer tools with a
macOS SDK. The build uses the Command Line Tools compiler directly when present,
or the selected Xcode compiler on other machines. It does not accept an Xcode
license or change `xcode-select`.

```bash
node src/pos/macos/check.mjs
node src/pos/macos/build.mjs
```

Output: `src/pos/macos/build/42Trade POS.app` and a versioned universal ZIP, with
SHA-256 sums and release metadata. The existing PayHub logo is reused as the app icon.
Override the HTTPS server at build time with `POS_MACOS_URL`.

For Apple Developer ID distribution, set `POS_MACOS_SIGN_IDENTITY` to an existing
**Developer ID Application** signing identity before building. The helper then
uses a timestamped hardened-runtime signature. Notarize and staple using the
owner's Apple credentials as a separate authorized release step. No signing
credentials are required for the ad-hoc test build, and none are stored in Git.

## Publish

Publish to the running Mac mini download server:

```bash
node src/pos/macos/publish.mjs
```

An isolated worktree can pass the running checkout's public directory:

```bash
node src/pos/macos/publish.mjs /absolute/path/42trade/src/admin/public/downloads/pos-macos
```

The shared Vite download middleware serves both Android APK and macOS ZIP with
the correct MIME type and attachment headers, file allowlists, HEAD support, and
no-store caching. No extra port or Tailscale access change is required.

For the GitHub direct download requested here, the small native ZIP and its
checksum are checked into `src/pos/macos/releases/` on `codex/pos-macos`. The ZIP
contains the `.app` and embedded installation notes; source remains alongside it.
The raw GitHub file link is usable without Tailscale. Running POS still needs
Tailscale. Increase the version for subsequent published builds.

```bash
node src/pos/macos/prepare-github.mjs
```

This verifies the build checksum before copying the small versioned ZIP and
metadata into the Git-tracked `releases` directory.

## Native behavior

- Persistent WebKit cookies and IndexedDB use a dedicated app profile, separate
  from Safari/Chrome and the Android app.
- The existing POS native message contract handles XLSX saves via NSSavePanel and
  receipt HTML via the macOS print dialog. Browser behavior remains available.
- Camera access is requested only for the configured HTTPS origin and camera
  capture type. Microphone requests are denied. The OS camera permission is
  requested when the user opens scanning, rather than at startup.
- Uploads use NSOpenPanel. Other downloads use WKDownload, keep the login session,
  prompt for a destination, stage downloads in a temporary file, and replace an
  existing destination only after the user's save-panel approval.
- The native message handler rejects untrusted origins, subframes, oversized
  messages, and files larger than 20 MB. External user-selected HTTPS links open
  in the default browser. HTTP, file navigation, and invalid TLS are not allowed.
- Closing or quitting asks the user to finish/save the current transaction first.
- The app is a wrapper for the existing hosted POS. It does not bundle a second
  offline app shell. Cold-start offline use depends on the hosted production
  service worker being previously cached; the current Vite dev server disables
  service workers. Offline sales still follow existing allocation/catalog rules.
- Printing uses installed macOS printers or PDF export. Raw Bluetooth/USB printer
  drivers are not included.

## Verification

Build both CPU targets, verify the universal binary with `lipo`, verify the code
signature with `codesign`, and run `check.mjs`. Check the downloaded ZIP checksum
against release metadata. Launch the actual `.app` on the Mac and verify the sign-in
screen. Camera, real printer output, and account-specific sale/sync flows need a
user-authorized test with the relevant device/account; compilation alone does not
verify those hardware flows.
