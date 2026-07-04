# Mobile Access

This workflow exposes the local trading UI on your Mac so you can open it from a phone.

## What It Starts

- Local app stack:
  - UI on `http://localhost:3000`
  - API on `http://localhost:3001`
- Optional access routes:
  - Tailscale private tunnel
  - Cloudflare quick tunnel

## One Command

Run one of these from the repo root:

```bash
bash scripts/start/start_mobile_access.sh tailscale
bash scripts/start/start_mobile_access.sh cloudflare
bash scripts/start/start_mobile_access.sh both
```

## Tailscale

Best when only you need access.

What it does:
- Restarts the local stack
- Sets up `tailscale serve`
- Prints a private tailnet URL like:
  - `https://hunghx.tail02c7f8.ts.net:8443/`

Phone usage:
- Install Tailscale on the phone
- Sign in with the same account
- Open the printed URL in the mobile browser

Notes:
- This is private to your tailnet.
- The script uses a non-default HTTPS port (`8443`) because `443` may already be occupied on the Mac.
- Use the printed `https://...tail...ts.net:8443/` hostname for HTTPS. Do not use the raw `100.x.x.x` Tailscale IP with HTTPS here; the certificate is issued for the `ts.net` name, not the IP.

## Cloudflare Tunnel

Best when you want a public URL that works without the phone joining your tailnet.

What it does:
- Restarts the local stack
- Starts a quick tunnel with `cloudflared`
- Prints a temporary URL like:
  - `https://example.trycloudflare.com`

Phone usage:
- Open the printed URL in the mobile browser

Notes:
- Quick tunnels are temporary and intended for development.
- The URL changes each time you start a new tunnel.
- If you want a stable, long-lived Cloudflare URL, set up a named tunnel in the Cloudflare dashboard and replace the quick tunnel workflow.

## Why The Stack Restarts

The Vite dev server validates the request host. Each tunnel uses a different host header, so the script restarts the UI with the needed host allowlist for the selected mode.

## Stop / Cleanup

- Tailscale:
  - Turn off the serve route with:
    ```bash
    tailscale serve --https=8443 off
    ```
- Cloudflare:
  - Remove the launched process label:
    ```bash
    launchctl remove trading-cloudflared-quick
    ```

## Safety

- Tailscale is the safer default for personal use.
- Cloudflare quick tunnels are public internet endpoints and should be treated as temporary dev links.
- Do not switch Vite to `allowedHosts = true`; this script keeps the allowlist explicit and only broadens it for the Cloudflare quick tunnel mode.
