#!/usr/bin/env bash
#
# Streaming conformance against a local container: builds the fixture with nextship
# exactly as it builds any app, runs the image, and fails unless /stream streams.
#
# The fixture's dependencies must be installed first (npm ci in app/), because
# nextship reads the installed Next.js version rather than the declared one.
#
# Author: Gowtham
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NEXTSHIP="${HERE}/../../packages/cli/dist/index.js"
CONTAINER="nextship-streaming-$$"
TAG=""

cleanup() {
  docker rm -f "${CONTAINER}" > /dev/null 2>&1 || true
  if [ -n "${TAG}" ]; then docker rmi "${TAG}" > /dev/null 2>&1 || true; fi
}
trap cleanup EXIT

cd "${HERE}/app"
[ -d node_modules/next ] || { echo "Install the fixture first: npm ci in ${HERE}/app" >&2; exit 1; }

PACKAGE_LOG="$(mktemp)"
node "${NEXTSHIP}" package > "${PACKAGE_LOG}" 2>&1 || { cat "${PACKAGE_LOG}" >&2; exit 1; }
TAG="$(sed -n 's/.*Image ready: \([^ ]*\).*/\1/p' "${PACKAGE_LOG}" | tail -1)"
[ -n "${TAG}" ] || { cat "${PACKAGE_LOG}" >&2; echo "packaging reported no image tag" >&2; exit 1; }

# A free port rather than 3000, which a developer running this may already be using.
PORT="$(node -e "const s = require('node:net').createServer(); s.listen(0, '127.0.0.1', () => { process.stdout.write(String(s.address().port)); s.close() })")"
docker run -d --name "${CONTAINER}" --platform linux/amd64 -p "${PORT}:3000" "${TAG}" > /dev/null

for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/"; then break; fi
  if [ "$(docker inspect -f '{{.State.Status}}' "${CONTAINER}")" != "running" ]; then
    docker logs "${CONTAINER}" >&2
    echo "the container exited before serving" >&2
    exit 1
  fi
  sleep 1
done

node "${HERE}/measure.mjs" "http://127.0.0.1:${PORT}/stream"
