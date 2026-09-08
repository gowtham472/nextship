#!/usr/bin/env bash
#
# Cleanup script for the Next.js adapter compatibility harness.
#
# Runs after each test. The harness creates a fresh app per test, so containers
# and images accumulate quickly; leaving them behind fills the runner's disk
# part way through a run, which looks like an unrelated failure.
#
# Contract: nextjs.org/docs/app/api-reference/adapters/testing-adapters
# Author: Gowtham
set -euo pipefail

CONTAINER="$(grep '^CONTAINER: ' .adapter-build.log 2>/dev/null | cut -d' ' -f2- || true)"
TAG="$(grep '^TAG: ' .adapter-build.log 2>/dev/null | cut -d' ' -f2- || true)"

[ -n "${CONTAINER}" ] && docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
[ -n "${TAG}" ] && docker rmi -f "${TAG}" >/dev/null 2>&1 || true

exit 0
