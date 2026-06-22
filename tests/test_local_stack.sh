#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BASE_URL="${BASE_URL:-http://127.0.0.1:80}"
UI_URL="${UI_URL:-http://127.0.0.1:5174}"
API_KEY="${API_KEY:-}"
ACCOUNT="${ACCOUNT:-local-test}"
EXPECT_STORAGE="${EXPECT_STORAGE:-}"

if [[ -z "$API_KEY" ]]; then
  echo "[test] warning: API_KEY is empty. If your server requires auth this test will fail."
fi

BASE_URL="$BASE_URL" \
UI_URL="$UI_URL" \
API_KEY="$API_KEY" \
ACCOUNT="$ACCOUNT" \
EXPECT_STORAGE="$EXPECT_STORAGE" \
node "$ROOT_DIR/tests/test_local_stack.mjs"
