#!/usr/bin/env bash
#
# End to end against a real server over SSH: sets the server up, deploys the streaming
# fixture behind Caddy, and checks what the VM target promises. Streaming passes through
# the proxy, a new deployment drops no request, a deployment that cannot start leaves the
# previous one serving, and rollback returns to the previous deployment.
#
#   conformance/vm/e2e.sh user@host[:port] [server add flags...]
#
# NEXTSHIP_E2E_URL is where the server's port 80 is reached from here, http://<host> by
# default. Set it when port 80 is forwarded, for example to a local test container.
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

HOST="${SERVER#*@}"
HOST="${HOST%:*}"
URL="${NEXTSHIP_E2E_URL:-http://${HOST}}"

# A copy in its own git repository, so nextship.json is written beside the copy and never
# into this one, and deployment ids come from clean commits.
WORK="$(mktemp -d)"
LOOP_PIDS=()
cleanup() {
  # The ${a[@]+...} form, because bash 3.2 on macOS treats an empty array as unset under set -u.
  for pid in ${LOOP_PIDS[@]+"${LOOP_PIDS[@]}"}; do kill "${pid}" 2> /dev/null || true; done
  rm -rf "${WORK}"
}
trap cleanup EXIT
cp -R "${FIXTURE}/app" "${FIXTURE}/package.json" "${FIXTURE}/package-lock.json" "${WORK}/"
ln -s "$(cd "${FIXTURE}" && pwd)/node_modules" "${WORK}/node_modules"
cd "${WORK}"
printf 'node_modules\n.nextship\n' > .gitignore
git init -q
commit() { git add -A && git -c user.email=e2e@nextship.invalid -c user.name=e2e commit -qm "$1"; }
commit fixture

nextship() { NO_COLOR=1 node "${NEXTSHIP}" "$@"; }
check() { echo "$1: ok, $2"; }
fail() { echo "$1: FAIL, $2" >&2; exit 1; }

# Requests a path every 100 ms into a file until the file named "<file>.stop" exists.
poll() {
  local path="$1" out="$2"
  rm -f "${out}.stop"
  : > "${out}"
  while [ ! -f "${out}.stop" ]; do
    curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 "${URL}${path}" >> "${out}" || echo 000 >> "${out}"
    sleep 0.1
  done
}

# Fails unless every status in the file is 2xx, and there was at least one.
all_ok() {
  local out="$1" name="$2"
  local total bad
  total="$(wc -l < "${out}" | tr -d ' ')"
  bad="$(grep -vc '^2' "${out}" || true)"
  [ "${total}" -gt 0 ] || fail "${name}" "no requests were made"
  [ "${bad}" -eq 0 ] || fail "${name}" "${bad} of ${total} requests were not 2xx: $(sort "${out}" | uniq -c | tr '\n' ' ')"
  check "${name}" "${total} requests, all 2xx"
}

# ------------------------------------------------------------------ server add

nextship server add "${SERVER}" "$@" --yes
grep -q '"target": "vm"' nextship.json || fail "server add" "nextship.json does not record the vm target"
check "server add" "the server is set up and recorded"

SECOND="$(nextship server add "${SERVER}" "$@")"
echo "${SECOND}"
grep -q 'CHANGE' <<< "${SECOND}" && fail "idempotence" "a second server add planned changes"
grep -q 'already set up' <<< "${SECOND}" || fail "idempotence" "a second server add did not report the server as set up"
check "idempotence" "a second server add changes nothing"

# ---------------------------------------------------------------------- deploy

commit "record the server"
nextship deploy --yes
curl -sf -o /dev/null "${URL}/" || fail "deploy" "${URL}/ does not answer after deploying"
check "deploy" "the fixture serves at ${URL}"

node "${HERE}/../streaming/measure.mjs" "${URL}/stream"
EDGE="$(curl -s "${URL}/edge")"
[ "${EDGE}" = '{"runtime":"edge-runtime"}' ] || fail "edge" "/edge answered: ${EDGE:-nothing}"
check "edge" "/edge ran in the Edge runtime, through Caddy"

# ------------------------------------------------------------- zero downtime

echo "// second build $(date +%s)" >> app/layout.jsx
commit "second build"
poll / "${WORK}/codes"   & LOOP_PIDS+=($!)
poll /stream "${WORK}/streams" & LOOP_PIDS+=($!)
sleep 1
nextship deploy --yes
sleep 3
touch "${WORK}/codes.stop" "${WORK}/streams.stop"
wait "${LOOP_PIDS[@]}"
LOOP_PIDS=()
all_ok "${WORK}/codes" "zero downtime"
all_ok "${WORK}/streams" "streams across the switch"
SECOND="$(nextship rollback | sed -n 's/^  current *\([^ ]*\).*/\1/p')"

# ------------------------------------------------------------ failed startup

cat > instrumentation.js <<'JS'
export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') process.exit(1)
}
JS
commit "a build whose server exits on start"
poll / "${WORK}/codes" & LOOP_PIDS+=($!)
if nextship deploy --yes; then fail "failed startup" "a deployment whose server exits was reported as a success"; fi
touch "${WORK}/codes.stop"
wait "${LOOP_PIDS[@]}"
LOOP_PIDS=()
all_ok "${WORK}/codes" "failed startup"
[ "$(nextship rollback | sed -n 's/^  current *\([^ ]*\).*/\1/p')" = "${SECOND}" ] || fail "failed startup" "the failed deployment was recorded as live"
check "failed startup" "the previous deployment kept serving and stayed live"
git rm -q instrumentation.js
commit "remove the failing startup"

# ------------------------------------------------------------------ rollback

TARGET="$(nextship rollback | sed -n 's/^  roll back *\([^ ]*\).*/\1/p')"
[ -n "${TARGET}" ] || fail "rollback" "the plan named nothing to roll back to"
nextship rollback --yes
[ "$(nextship rollback | sed -n 's/^  current *\([^ ]*\).*/\1/p')" = "${TARGET}" ] || fail "rollback" "the live deployment is not ${TARGET}"
curl -sf -o /dev/null "${URL}/" || fail "rollback" "${URL}/ does not answer after rolling back"
check "rollback" "${TARGET} serves again"
