# 42Trade POS on iPhone and iPad

The first iOS release is a Home Screen web app, selected because no Apple Developer signing account is available. It uses the POS hosted on the Mac mini through Tailscale. No IPA is published.

- Installation guide: `https://hunghx.tail02c7f8.ts.net:8443/downloads/pos-ios/`
- Start URL: `/admin/pos` on the installation origin.
- Menu: **Tải app → iPhone / iPad · Web app**.

Open the guide in Safari on the iPhone/iPad, choose Share → Add to Home Screen, enable Open as Web App if shown, and add it. Launch the resulting icon and sign in. The guide supplies an independent POS manifest and Apple touch icon. A standalone launch of the guide redirects to the POS for iOS versions that save the installation page URL.

The device needs Tailscale connected to the same network as the running Mac mini. Web changes are delivered from the server; no app-store installation is required. Initial login and uncached server operations require connectivity. Camera access requires the user to grant Safari/web-app permission.

The download middleware serves the guide, manifest, and icon during Vite development and preview. Production serves these files from `dist/downloads/pos-ios/`. The main service worker excludes `/downloads/` from its navigation fallback so it does not replace installation pages with the app shell.

A native iOS package is future work. Signing and distribution require an appropriate Apple account, certificates and provisioning; do not present an unsigned IPA as installable on an iPhone. See [Apple's registered-device distribution guide](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices).
