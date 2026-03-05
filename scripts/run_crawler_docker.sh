#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="unad-crawler:latest"

cd "$ROOT_DIR"

echo "[1/2] Build crawler image..."
docker build -f docker/crawler.Dockerfile -t "$IMAGE_NAME" .

echo "[2/2] Run crawler..."
docker run --rm \
  -v "$ROOT_DIR:/work" \
  -w /work \
  "$IMAGE_NAME" "$@"
