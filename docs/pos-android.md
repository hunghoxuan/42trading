# POS Android app

The Android project is in `src/pos/android`. It is a native WebView shell for the
existing POS on the Mac mini, with no Google Play dependency.

- Application ID: `com.mozasolution.pos`
- Minimum Android: 8.0 (API 26)
- Default POS: `https://hunghx.tail02c7f8.ts.net:8443/admin/pos`
- Download page: `https://hunghx.tail02c7f8.ts.net:8443/downloads/pos-android/`
- APK: `https://hunghx.tail02c7f8.ts.net:8443/downloads/pos-android/42trade-pos.apk`

## Install on a phone

1. Connect the phone to the same Tailscale network as the Mac mini.
2. Open the download page in the phone's browser and download the APK.
3. Open the file. If Android asks, allow that browser to install unknown apps.
4. Open **42Trade POS** and sign in with an existing account. Allow camera access
   when opening the barcode scanner or photo camera.

The Mac mini must remain on, connected to Tailscale, with the local POS services
running. The app uses the Android System WebView installed on the phone; keep it
updated. The Tailscale DNS hostname and port must match the configured URL.

## Build

Install JDK 17 or newer supported by Gradle 8.13 and the Android SDK (platform 36,
build tools 35.0.0). Set `ANDROID_HOME` to your SDK directory or add `sdk.dir` to
an untracked `src/pos/android/local.properties`.

```bash
cd src/pos/android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

Output: `app/build/outputs/apk/debug/app-debug.apk`.
Override the HTTPS server at build time, including its actual port:

```bash
./gradlew assembleDebug -PposUrl=https://your-device.your-tailnet.ts.net:8443/admin/pos
```

The GitHub **Build POS Android** workflow also builds and checks a debug APK.
Artifacts are build backups; phones normally download directly from the Mac mini.
No Play Console upload, third-party API key, or signing secret is committed.

## Publish a direct download

From the repository root after a signed release build:

```bash
node src/pos/android/publish-apk.mjs
```

This copies the APK, SHA-256 checksum, and version metadata into
`src/admin/public/downloads/pos-android/`, which the running Vite server serves
through the existing Tailscale HTTPS route. It does not change Tailscale access
or expose a public internet endpoint. Generated APKs and metadata are ignored by Git.
For an isolated worktree, pass its APK path and the running checkout's public directory:

```bash
node src/pos/android/publish-apk.mjs /absolute/path/app-release.apk /absolute/path/42trade/src/admin/public/downloads/pos-android
```

For a static production UI, copy the download directory into the served build output
as part of an explicitly authorized deployment. Publishing an APK does not deploy
web/backend code. The Android print/XLSX bridge also needs the accompanying changes
in `src/pos/src/androidBridge.ts`, `printInvoice.ts`, and `xlsxProducts.ts` on the host.

## Signing and upgrades

The APK distributed from the Mac mini is release signed. Keep and back up the
release key and its password to install subsequent builds as upgrades. On this
Mac mini they are outside Git at `~/.config/42trade/android/pos-release.p12` and
`~/.config/42trade/android/release-password` (owner-only access). Do not upload them.
The helper reuses this existing key and never prints the password:

```bash
node src/pos/android/build-release.mjs
node src/pos/android/publish-apk.mjs
```

CI artifacts are debug signed using a different key; they cannot replace a locally
release-signed install without uninstalling first. Uninstalling or clearing app data
deletes local POS data, including pending offline sales: sync first.

For durable distribution, create and back up a release keystore outside Git, then set:

- `POS_ANDROID_KEYSTORE`: absolute keystore path
- `POS_ANDROID_STORE_PASSWORD`
- `POS_ANDROID_KEY_ALIAS`
- `POS_ANDROID_KEY_PASSWORD`

Run `./gradlew assembleRelease`, increment `versionCode`/`versionName` for each upgrade,
and publish `app/build/outputs/apk/release/app-release.apk` with the same helper.
An unsigned release build must be signed before distribution.

## Behavior and limits

- Login and cookies stay on the configured HTTPS origin in WebView.
- Camera prompts request only Android camera permission; microphone permission is
  neither requested nor granted. Denied permissions leave manual entry available.
- File inputs use Android's document picker; CSV exports retain the current login
  cookie and use the save-file picker. XLSX exports use an origin-scoped native bridge.
- Invoices use Android's print dialog, including PDF and installed print services.
  A specific Bluetooth receipt printer requires a compatible Android print service;
  raw Bluetooth/USB printer drivers are not included.
- IndexedDB, cookies, caches, and the existing service worker are retained. This
  wrapper does not bundle a second offline web app. First load needs a connection;
  offline reload depends on a previously installed/cached production service worker.
  The Vite development server disables service workers, so its app shell cannot be
  reopened from a cold start offline. POS's already-loaded offline-sale flow remains
  governed by the existing approved offline catalog and allocation checks.
- Navigation outside the configured HTTPS origin opens in the phone's browser only
  after a user gesture. Certificates are validated normally; HTTP is disabled.
- The native bridge is limited to the configured origin and main frame; it exposes
  only invoice printing and bounded file saves. No generic native-code interface.

## Validation

Run Gradle unit tests, Android lint, and APK assembly; also build `@trading/pos` to
check the shared web bridge. Before shop use, test on the actual Android device:
sign-in/reopen, allow/deny camera, scan a real barcode, select/upload an image, import
XLSX, export CSV/XLSX, print to the installed print service, and sync an approved
offline sale after reconnecting. A successful build is not a hardware camera test.
