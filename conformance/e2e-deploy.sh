#!/usr/bin/env bash
#
# Deploy script for the Next.js adapter compatibility harness.
#
# The harness creates an isolated temporary app, runs this with `cwd` set to it,
# and expects exactly one thing on stdout: the URL the app is reachable at.
# Everything else must go to stderr, or the harness cannot parse the result.
#
# Contract: nextjs.org/docs/app/api-reference/adapters/testing-adapters
# Author: Gowtham
set -euo pipefail

: "${ADAPTER_DIR:?ADAPTER_DIR must point at the nextship checkout}"

NEXTSHIP="${ADAPTER_DIR}/packages/cli/dist/index.js"
CONTAINER="nextship-e2e-$$"

# The harness reads only stdout, so every diagnostic goes to stderr.
log() { echo "nextship: $*" >&2; }

# On failure, stdout stops being sacred and becomes the only way to be heard.
#
# The harness reports a failed deploy as `Custom deploy script failed: <stdout>
# <stderr> (<code>)`, but it does not capture stderr: the field arrives as
# `undefined`. So a script that writes every diagnostic to stderr, as this one
# correctly does while succeeding, fails completely silently. That is exactly
# what happened on the first CI run, and it cost a full suite execution to learn
# nothing at all.
#
# Nothing parses stdout unless the script exits 0, so dumping context here is
# safe and is the difference between a legible failure and a blank one.
on_failure() {
  local code=$?
  [ "${code}" -eq 0 ] && return 0
  echo "=== nextship deploy script failed with exit ${code} ==="
  echo "--- environment ---"
  echo "cwd:        $(pwd)"
  echo "ADAPTER_DIR: ${ADAPTER_DIR:-unset}"
  echo "node:       $(node --version 2>&1)"
  echo "docker:     $(docker version --format '{{.Server.Version}}' 2>&1 | head -1)"
  echo "cli:        $([ -f "${NEXTSHIP}" ] && echo present || echo "MISSING at ${NEXTSHIP}")"
  echo "adapter:    $([ -f "${ADAPTER_DIR}/packages/cli/runtime/adapter.mjs" ] && echo present || echo MISSING)"
  for f in .adapter-package.log .adapter-server.log; do
    if [ -f "$f" ]; then
      echo "--- ${f} (last 40 lines) ---"
      tail -40 "$f"
    fi
  done
  echo "=== end ==="
  # Re-exit with the original code. A trap that falls through would hand the
  # harness a zero, which is worse than the silence this replaced: it would read
  # as a successful deploy and fail later somewhere unrelated.
  exit "${code}"
}
trap on_failure EXIT

# The harness runs tests concurrently, so a fixed port would collide. Ask the
# kernel for a free one rather than guessing.
PORT="$(node -e "
const net = require('node:net')
const server = net.createServer()
server.listen(0, '127.0.0.1', () => { process.stdout.write(String(server.address().port)); server.close() })
")"

# One key for the whole run. The harness builds many apps, and Server Actions
# must stay decryptable across them.
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:-$(head -c 32 /dev/urandom | base64)}"

log "packaging $(pwd)"
# The tag is read from what packaging reported, not from the newest image on the
# daemon, which under concurrency could belong to another test.
node "${NEXTSHIP}" package > .adapter-package.log 2>&1 || { cat .adapter-package.log >&2; exit 1; }
cat .adapter-package.log >&2

TAG="$(sed -n 's/.*Image ready: \([^ ]*\).*/\1/p' .adapter-package.log | tail -1)"
[ -n "${TAG}" ] || { log "packaging reported no image tag"; exit 1; }

log "starting ${TAG} as ${CONTAINER}"
docker run -d --name "${CONTAINER}" --platform linux/amd64 -p "${PORT}:3000" "${TAG}" >&2

# Persisted because the logs script runs as a separate process and cannot see
# these variables.
{
  echo "BUILD_ID: $(cat .next/BUILD_ID 2>/dev/null || echo unknown)"
  echo "DEPLOYMENT_ID: $(node -e "process.stdout.write(require('./.nextship/output/manifest.json').deploymentId)" 2>/dev/null || echo unknown)"
  # nextship serves assets from the container, not a content-addressed store.
  echo "NEXT_SUPPORTS_IMMUTABLE_ASSETS: 0"
  echo "CONTAINER: ${CONTAINER}"
  echo "TAG: ${TAG}"
} > .adapter-build.log

# The harness fails the test rather than waiting, so readiness is confirmed here.
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then break; fi
  if [ "$(docker inspect -f '{{.State.Status}}' "${CONTAINER}" 2>/dev/null)" != "running" ]; then
    log "container exited before serving"
    docker logs "${CONTAINER}" >&2 2>&1 || true
    exit 1
  fi
  sleep 1
done

docker logs "${CONTAINER}" > .adapter-server.log 2>&1 || true

# The only line on stdout.
echo "http://127.0.0.1:${PORT}"
