#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="unad-crawler:latest"

cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found. Install Docker and retry." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not running or not accessible. Start Docker and retry." >&2
  exit 1
fi

echo "[1/2] Build crawler image..."
docker build -f docker/crawler.Dockerfile -t "$IMAGE_NAME" .

echo "[2/2] Run crawler..."
docker run --rm \
  -v "$ROOT_DIR:/work" \
  -w /work \
  "$IMAGE_NAME" "$@"
