#!/usr/bin/env bash
# Smoke-test POST /api/update { action: restart } against the production Docker image.
# Requires Docker (Linux CI, Docker Desktop, or WSL). Does not run git pull / rebuild.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

IMAGE="${CH_DOCKER_TEST_IMAGE:-control-hub:api-smoke}"
NAME="${CH_DOCKER_TEST_NAME:-ch-api-smoke-$$}"
HOST_PORT="${CH_DOCKER_TEST_PORT:-42090}"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build -f Dockerfile -t "$IMAGE" "$ROOT"
fi

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "$NAME" \
  -p "${HOST_PORT}:42069" \
  -e PORT=42069 \
  -e NODE_ENV=production \
  -e CH_ENABLE_DEPLOY_API=true \
  "$IMAGE"

ready=0
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://127.0.0.1:${HOST_PORT}/"; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "ERROR: app did not become ready in time" >&2
  docker logs "$NAME" 2>&1 | tail -80 >&2 || true
  exit 1
fi

curl -sf "http://127.0.0.1:${HOST_PORT}/api/update?branch=dev" | grep -q '"data"' || {
  echo "ERROR: GET /api/update?branch=dev unexpected body" >&2
  exit 1
}

resp="$(curl -sf -X POST "http://127.0.0.1:${HOST_PORT}/api/update" \
  -H "Content-Type: application/json" \
  -d '{"action":"restart"}')"
echo "$resp" | grep -q '"started"' || {
  echo "ERROR: POST restart unexpected response: $resp" >&2
  exit 1
}

sleep 12
curl -sf -o /dev/null "http://127.0.0.1:${HOST_PORT}/" || {
  echo "ERROR: server not responding after restart" >&2
  docker logs "$NAME" 2>&1 | tail -80 >&2 || true
  exit 1
}

echo "OK: docker deploy-api restart smoke passed"
