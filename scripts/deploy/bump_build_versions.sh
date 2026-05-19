#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

GIT_ID="${BUILD_GIT_ID:-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)}"
VERSION="$(date -u '+v%Y.%m.%d %H:%M') - ${GIT_ID}"

perl -0777 -i -pe "s/const SERVER_VERSION = envStr\([\s\S]*?\);/const SERVER_VERSION = envStr(process.env.WEBHOOK_SERVER_VERSION, \"${VERSION}\");/g" webhook/server.js
perl -0777 -i -pe "s/string EA_BUILD_VERSION = \"[^\"]+\";/string EA_BUILD_VERSION = \"${VERSION}\";/g" bridge-clients/TVBridgeEA.mq5
perl -0777 -i -pe "s/private (?:const )?string BuildVersion = \"[^\"]+\";/private const string BuildVersion = \"${VERSION}\";/g" bridge-clients/TVBridge_CTrader.cs

echo "[build-version] server=${VERSION}"
echo "[build-version] clients=${VERSION}"
