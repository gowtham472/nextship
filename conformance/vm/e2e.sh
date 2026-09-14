#!/usr/bin/env bash
#
# End to end against a real server over SSH: sets the server up with nextship and
# checks that doing it again changes nothing.
#
#   conformance/vm/e2e.sh user@host[:port] [server add flags...]
#
# CI runs it against the runner itself over `ssh localhost`. The same script runs
# by hand against a real server, which is how the VM target is verified on a
# provider: point it at a fresh Ubuntu 24.04 or Debian 12 server you can SSH into
# as root or as a user with passwordless sudo. It changes that server as
# `nextship server add --yes` does, so use a server that exists for this.
#
# The fixture's dependencies must be installed first (npm ci in
# conformance/streaming/app), because nextship reads the installed Next.js version.
#
# Author: Ragul D
set -euo pipefail

[ $# -ge 1 ] || { echo "usage: $0 user@host[:port] [server add flags...]" >&2; exit 2; }
SERVER="$1"
shift

HERE="$(cd "$(dirname "$0")" && pwd)"
NEXTSHIP="${HERE}/../../packages/cli/dist/index.js"
FIXTURE="${HERE}/../streaming/app"
[ -d "${FIXTURE}/node_modules/next" ] || { echo "Install the fixture first: npm ci in ${FIXTURE}" >&2; exit 1; }

# A copy, so nextship.json is written beside the copy and never into the repository.
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
cp -R "${FIXTURE}/app" "${FIXTURE}/package.json" "${FIXTURE}/package-lock.json" "${WORK}/"
ln -s "$(cd "${FIXTURE}" && pwd)/node_modules" "${WORK}/node_modules"
cd "${WORK}"

nextship() { NO_COLOR=1 node "${NEXTSHIP}" "$@"; }
check() { echo "$1: ok, $2"; }
fail() { echo "$1: FAIL, $2" >&2; exit 1; }

# ------------------------------------------------------------------ server add

nextship server add "${SERVER}" "$@" --yes
grep -q '"target": "vm"' nextship.json || fail "server add" "nextship.json does not record the vm target"
check "server add" "the server is set up and recorded"

SECOND="$(nextship server add "${SERVER}" "$@")"
echo "${SECOND}"
grep -q 'CHANGE' <<< "${SECOND}" && fail "idempotence" "a second server add planned changes"
grep -q 'already set up' <<< "${SECOND}" || fail "idempotence" "a second server add did not report the server as set up"
check "idempotence" "a second server add changes nothing"
