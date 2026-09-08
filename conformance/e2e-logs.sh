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

[ -f .adapter-build.log ] && cat .adapter-build.log

if [ -f .adapter-server.log ]; then
  echo "=== server log ==="
  cat .adapter-server.log
fi

# Anything since the deploy script captured its snapshot.
CONTAINER="$(grep '^CONTAINER: ' .adapter-build.log 2>/dev/null | cut -d' ' -f2- || true)"
if [ -n "${CONTAINER}" ]; then
  echo "=== live container log ==="
  docker logs "${CONTAINER}" 2>&1 || true
fi
