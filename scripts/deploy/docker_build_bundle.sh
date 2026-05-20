#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-trading-webhook}"
TAG="${TAG:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD)}"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp}"
OUTPUT_FILE="${OUTPUT_DIR}/${IMAGE_NAME}-${TAG}.tar.gz"

echo "[docker-build] root=${ROOT_DIR}"
echo "[docker-build] image=${IMAGE_NAME}:${TAG}"
echo "[docker-build] output=${OUTPUT_FILE}"

cd "${ROOT_DIR}"
docker build -f Dockerfile.webhook -t "${IMAGE_NAME}:${TAG}" .

mkdir -p "${OUTPUT_DIR}"
docker save "${IMAGE_NAME}:${TAG}" | gzip > "${OUTPUT_FILE}"

echo "[docker-build] done"
echo "[docker-build] image=${IMAGE_NAME}:${TAG}"
echo "[docker-build] bundle=${OUTPUT_FILE}"
