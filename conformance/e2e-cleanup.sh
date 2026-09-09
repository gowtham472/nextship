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

# Matches the deploy script. See the comment there for why logs live beside the
# app directory rather than in it.
LOGDIR="${PWD}.logs"

CONTAINER="$(grep '^CONTAINER: ' "${LOGDIR}/build.log" 2>/dev/null | cut -d' ' -f2- || true)"
TAG="$(grep '^TAG: ' "${LOGDIR}/build.log" 2>/dev/null | cut -d' ' -f2- || true)"

[ -n "${CONTAINER}" ] && docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
[ -n "${TAG}" ] && docker rmi -f "${TAG}" >/dev/null 2>&1 || true

# The logs outlive the app directory now that they sit outside it, so they are
# this script's to remove. Left behind, they accumulate for every test in the
# group on a runner that is already tight on disk.
rm -rf "${LOGDIR}"

exit 0
