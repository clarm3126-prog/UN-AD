#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ID="${FIREBASE_PROJECT_ID:-}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "FIREBASE_PROJECT_ID is required. Example: FIREBASE_PROJECT_ID=my-project-id npm run deploy:web" >&2
  exit 1
fi

cd "${ROOT_DIR}"

if ! command -v firebase >/dev/null 2>&1; then
  echo "firebase CLI not found. Install it first: npm i -g firebase-tools" >&2
  exit 1
fi

firebase deploy --only hosting --project "${PROJECT_ID}"
