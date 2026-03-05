#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-4000}"
RUN_DOCKER_CRAWLER="${RUN_DOCKER_CRAWLER:-0}"
API_PID=""

cleanup() {
  if [[ -n "${API_PID}" ]] && kill -0 "${API_PID}" >/dev/null 2>&1; then
    kill "${API_PID}" >/dev/null 2>&1 || true
    wait "${API_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "${ROOT_DIR}"

echo "[1/5] Seed sample data"
npm run seed:sample >/dev/null

echo "[2/5] Run ingest + worker pipeline"
npm run pipeline:run >/dev/null

echo "[3/5] Start API server on port ${API_PORT}"
API_PORT="${API_PORT}" node backend/api-server.js >/tmp/unad_api_smoke.log 2>&1 &
API_PID="$!"

echo "[4/5] Wait for /health"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
  echo "API health check failed. See /tmp/unad_api_smoke.log" >&2
  exit 1
fi

PRODUCT_COUNT="$(curl -fsS "http://127.0.0.1:${API_PORT}/products" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.data||[]).length);});')"
echo "[5/5] API smoke passed (products=${PRODUCT_COUNT})"

if [[ "${RUN_DOCKER_CRAWLER}" == "1" ]]; then
  if command -v docker >/dev/null 2>&1; then
    echo "[optional] Docker crawler smoke"
    scripts/run_crawler_docker.sh --max-reviews 10 --headless --out data/source/reviews/crawler_smoke.csv
  else
    echo "[optional] Skipped docker crawler smoke (docker not found)"
  fi
fi

echo "Smoke check completed."
