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

# The build output itself, which is what `next.cliOutput` is in deploy mode.
#
# Without it the harness sees an empty build log, so every test that asserts on
# something Next.js printed while building, a deprecation warning for instance,
# fails no matter how correct the deployment is. It goes after the markers
# because those must come first, and the marker-shaped lines the app's own
# post-build script printed are dropped so they cannot shadow ours: that copy
# reports DEPLOYMENT_ID as undefined, since the id reaches the build through
# NEXTSHIP_DEPLOYMENT_ID rather than the variable the harness echoes.
if [ -f "${LOGDIR}/package.log" ]; then
  echo "=== build log ==="
  grep -vE '^#[0-9]+ [0-9.]+ (BUILD_ID|DEPLOYMENT_ID|NEXT_SUPPORTS_IMMUTABLE_ASSETS): ' \
    "${LOGDIR}/package.log" || true
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
