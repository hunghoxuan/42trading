#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

BASE_REF="${1:-origin/main}"

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "[build-version-check] base ref not found: $BASE_REF (skipping)"
  exit 0
fi

CHANGED="$(git diff --name-only "$BASE_REF...HEAD" --)"
if [[ -z "$CHANGED" ]]; then
  echo "[build-version-check] no changes between $BASE_REF and HEAD"
  exit 0
fi

CODE_CHANGED="$(echo "$CHANGED" | grep -vE '^(docs/|\.agents/|AI\.md$|.*\.md$|tests/results/|tests/results/ui/playwright-report/|src/admin/tests/results/)' || true)"
if [[ -z "$CODE_CHANGED" ]]; then
  echo "[build-version-check] only docs/artifacts changed; version bump not required"
  exit 0
fi

SERVER_BUMP="$(git diff -U0 "$BASE_REF...HEAD" -- src/api/server.js | grep -E '^\+const SERVER_VERSION = envStr\(process\.env\.WEBHOOK_SERVER_VERSION, \"' || true)"
EA_BUMP="$(git diff -U0 "$BASE_REF...HEAD" -- src/mt5-bridge/clients/TVBridgeEA.mq5 | grep -E '^\+string EA_BUILD_VERSION = \"' || true)"

if [ -n "$SERVER_BUMP" ] || [ -n "$EA_BUMP" ]; then
  echo "Build version bump detected."
  exit 0
fi

echo "ERROR: No build version bump detected in server.js or src/mt5-bridge/clients/TVBridgeEA.mq5."
echo "Please run: ./scripts/deploy/bump_build_versions.sh"
echo "Current versions (local):"
SERVER_VER="$(grep -E 'const SERVER_VERSION = envStr\(process\.env\.WEBHOOK_SERVER_VERSION, "' src/api/server.js | sed -E 's/.*"([^"]+)".*/\1/' | head -1)"
echo "  - src/api/server.js :: SERVER_VERSION = $SERVER_VER"
echo "  - src/mt5-bridge/clients/TVBridgeEA.mq5 :: EA_BUILD_VERSION"
EA_VER="$(grep -E 'string EA_BUILD_VERSION = "' src/mt5-bridge/clients/TVBridgeEA.mq5 | sed -E 's/.*"([^"]+)".*/\1/' | head -1)"
if [[ "$SERVER_VER" != "$EA_VER" ]]; then
  echo "[build-version-check] FAILED"
  echo "[build-version-check] SERVER_VERSION and EA_BUILD_VERSION must match exactly."
  echo "  server=$SERVER_VER"
  echo "  ea=$EA_VER"
  exit 1
fi
if [[ ! "$SERVER_VER" =~ ^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}\ [0-9]{2}:[0-9]{2}\ -\ .+ ]]; then
  echo "[build-version-check] FAILED"
  echo "[build-version-check] version must match: vY.M.d H:m - git"
  echo "  got=$SERVER_VER"
  exit 1
fi

echo "[build-version-check] OK (both version bumps detected vs $BASE_REF)"
