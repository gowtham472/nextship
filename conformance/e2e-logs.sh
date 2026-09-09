#!/usr/bin/env bash
#
# Logs script for the Next.js adapter compatibility harness.
#
# Replays what the deploy script persisted. The harness parses the BUILD_ID,
# DEPLOYMENT_ID and NEXT_SUPPORTS_IMMUTABLE_ASSETS markers from this output, so
# they must appear before anything else.
#
# Contract: nextjs.org/docs/app/api-reference/adapters/testing-adapters
# Author: Gowtham
set -euo pipefail

# Derived the same way the deploy script derives it, because the harness runs
# each script as a separate process and shares nothing but the app directory.
# The logs sit beside the app rather than inside it so they cannot alter the
# Docker build context between the two builds packaging runs.
LOGDIR="${PWD}.logs"

# An if block rather than a && chain: under set -e a false test makes the whole
# chain non-zero and kills the script, which would turn a missing log into a
# failing logs step on top of whatever already went wrong.
if [ -f "${LOGDIR}/build.log" ]; then
  cat "${LOGDIR}/build.log"
fi

if [ -f "${LOGDIR}/server.log" ]; then
  echo "=== server log ==="
  cat "${LOGDIR}/server.log"
fi

# Anything since the deploy script captured its snapshot.
CONTAINER="$(grep '^CONTAINER: ' "${LOGDIR}/build.log" 2>/dev/null | cut -d' ' -f2- || true)"
if [ -n "${CONTAINER}" ]; then
  echo "=== live container log ==="
  docker logs "${CONTAINER}" 2>&1 || true
fi
