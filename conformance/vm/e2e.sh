#!/usr/bin/env bash
#
# End to end against a real server over SSH: sets the server up, deploys the streaming
# fixture behind Caddy, and checks what the VM target promises. Streaming passes through
# the proxy, a new deployment drops no request, a deployment that cannot start leaves the
# previous one serving, rollback returns to the previous deployment, env push takes effect
# without downtime, a replaced deployment's logs are still readable, pruning keeps the
# live image, a regenerated ISR page and an optimized image survive a container restart,
# a domain gets its own site, and destroying one app leaves another serving.
#
# It ends by destroying both apps it created, so a server it ran against is left with only
# what `server add` set up.
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
cp -R "${FIXTURE}/app" "${FIXTURE}/public" "${FIXTURE}/package.json" "${FIXTURE}/package-lock.json" "${WORK}/"
ln -s "$(cd "${FIXTURE}" && pwd)/node_modules" "${WORK}/node_modules"
cd "${WORK}"
printf 'node_modules\n.nextship\n' > .gitignore
git init -q
commit() { git add -A && git -c user.email=e2e@nextship.invalid -c user.name=e2e commit -qm "$1"; }
commit fixture

nextship() { NO_COLOR=1 node "${NEXTSHIP}" "$@"; }
check() { echo "$1: ok, $2"; }
fail() { echo "$1: FAIL, $2" >&2; exit 1; }

# Runs a command on the server. Only used for the things nextship deliberately
# does not do, such as restarting one container to see what survives it.
SSH_PORT="22"
case "${SERVER}" in *:*) SSH_PORT="${SERVER##*:}";; esac
SSH_TARGET="${SERVER%:*}"
on_server() { ssh -o BatchMode=yes -o StrictHostKeyChecking=no -p "${SSH_PORT}" "${SSH_TARGET}" "$@"; }

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

# ---------------------------------------------------------------------- env

mkdir -p app/api/env
cat > app/api/env/route.js <<'JS'
export const dynamic = 'force-dynamic'
export async function GET() {
  return Response.json({ message: process.env.E2E_MESSAGE ?? null })
}
JS
commit "a route that reads the environment at request time"
nextship deploy --yes
printf 'E2E_MESSAGE=from the server env file\n' > .env.production
poll / "${WORK}/codes" & LOOP_PIDS+=($!)
nextship env push --yes
touch "${WORK}/codes.stop"
wait "${LOOP_PIDS[@]}"
LOOP_PIDS=()
rm .env.production
all_ok "${WORK}/codes" "env push"
[ "$(curl -s "${URL}/api/env")" = '{"message":"from the server env file"}' ] || fail "env push" "the pushed value is not visible at request time"
check "env push" "the value is visible at request time"

# --------------------------------------------------------------------- logs

# TARGET served until the env route deployment replaced it, so its output is only in the journal now.
LOGS="$(nextship logs --deployment "${TARGET}")"
grep -q 'Ready' <<< "${LOGS}" || fail "logs" "the logs of replaced deployment ${TARGET} are gone"
if nextship logs --deployment dpl-not-a-deployment > /dev/null 2>&1; then fail "logs" "an unknown deployment was not refused"; fi
check "logs" "a replaced deployment's logs are still readable, and an unknown one is refused"

# ------------------------------------------------------------------- images

nextship images prune --keep 1 --yes
# Output is captured before it is searched: grep -q exits at its first match, and the
# closed pipe would fail the command under pipefail.
IMAGES="$(nextship images)"
KEPT="$(grep -c '^  dpl-' <<< "${IMAGES}" || true)"
[ "${KEPT}" -eq 1 ] || fail "images prune" "${KEPT} images remain after keeping 1"
grep -q 'deployed now' <<< "${IMAGES}" || fail "images prune" "the live image was removed"
curl -sf -o /dev/null "${URL}/" || fail "images prune" "the app stopped serving"
check "images prune" "one image kept, the live one, and the app still serves"

# --------------------------------------------------------------- durability

# The headline claim of the VM target: what Next.js writes at runtime is kept,
# so a restart does not throw away regenerated pages and optimized images the
# way a platform that gives each container a fresh filesystem does. Two volumes
# carry it, one per image over .next and one per app over .next/cache, and
# nothing else in this suite or in the unit tests checks that they work.

# `server add` needs a login that is root or has passwordless sudo; it does not
# need that login to be in the docker group, and on a fresh provider image it
# usually is not. So docker is reached through whichever of the two works, asked
# here rather than at the top of the script because `server add` is what installs it.
DOCKER="docker"
on_server "docker ps > /dev/null 2>&1" || DOCKER="sudo -n docker"
on_server "${DOCKER} ps > /dev/null" || fail "durability" "cannot reach docker on the server as ${SSH_TARGET}"

# The value x-nextjs-cache reports for a URL, empty when there is no header.
cache_state() { curl -s -D - -o /dev/null "$1" | tr -d '\r' | grep -i '^x-nextjs-cache:' | awk '{print $2}'; }

BUILT="$(curl -s "${URL}/isr")"
grep -q 'isr-' <<< "${BUILT}" || fail "isr" "/isr did not render: ${BUILT:-nothing}"

# Regenerated on demand rather than by waiting out the revalidate window, so the
# entry on disk is known to differ from the one the build produced.
curl -sf -X POST -o /dev/null "${URL}/revalidate" || fail "isr" "the revalidate route did not answer"

# Polled rather than slept on: an invalidated entry can be served stale once
# while it regenerates behind the request, so the change is not guaranteed to be
# visible to the first read after the revalidation.
REGENERATED="${BUILT}"
for _ in $(seq 1 20); do
  REGENERATED="$(curl -s "${URL}/isr")"
  [ "${REGENERATED}" != "${BUILT}" ] && break
  sleep 1
done
[ "${REGENERATED}" != "${BUILT}" ] || fail "isr" "/isr did not change within 20s of revalidation, so nothing was regenerated"
grep -q 'isr-' <<< "${REGENERATED}" || fail "isr" "/isr stopped rendering after revalidation: ${REGENERATED}"

# The optimizer writes into .next/cache/images. The first request encodes it and
# the ones after it should be answered from that entry, which is what there is
# to survive a restart.
IMAGE_URL="${URL}/_next/image?url=%2Fnextship.png&w=128&q=75"
TYPE="$(curl -s -o /dev/null -w '%{content_type}' "${IMAGE_URL}")"
grep -q 'image/' <<< "${TYPE}" || fail "image" "the optimizer answered ${TYPE:-nothing}"
CACHED=""
for _ in $(seq 1 10); do
  CACHED="$(cache_state "${IMAGE_URL}")"
  [ "${CACHED}" = "HIT" ] && break
  sleep 1
done
[ "${CACHED}" = "HIT" ] || fail "image" "the optimized image was not cached before the restart: ${CACHED:-no header}"
check "durability" "an ISR page was regenerated and an image was optimized and cached"

# A restart, not a redeploy: a redeploy builds a new image and so a new build
# volume, which would prove nothing about what is kept.
CONTAINER="$(on_server "${DOCKER} ps --filter label=sh.nextship.app=nextship-streaming-fixture --filter status=running --format '{{.Names}}'" | head -1)"
[ -n "${CONTAINER}" ] || fail "durability" "no running container found for the app"

# The restart and the wait are one connection: sixty round trips to poll a
# health status is slower than the restart itself.
on_server "${DOCKER} restart ${CONTAINER} > /dev/null &&
  for _ in \$(seq 1 60); do
    [ \"\$(${DOCKER} inspect -f '{{.State.Health.Status}}' ${CONTAINER})\" = healthy ] && exit 0
    sleep 2
  done
  exit 1" || fail "durability" "${CONTAINER} did not become healthy again within 2 minutes"

AFTER="$(curl -s "${URL}/isr")"
[ "${AFTER}" = "${REGENERATED}" ] ||
  fail "durability" "the regenerated ISR page did not survive the restart: was ${REGENERATED}, now ${AFTER}"

AFTER_CACHED="$(cache_state "${IMAGE_URL}")"
[ "${AFTER_CACHED}" = "HIT" ] ||
  fail "durability" "the optimized image was re-encoded after the restart rather than read from the cache: ${AFTER_CACHED:-no header}"
check "durability" "the regenerated page and the optimized image both survived a container restart"

# ------------------------------------------------------------------ domains

nextship domain add e2e.nextship.test --yes
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: e2e.nextship.test' "${URL}/")" = 308 ] ||
  fail "domain add" "the domain did not get its own HTTPS site"
check "domain add" "the domain redirects to HTTPS through its own site"

# -------------------------------------------------- a second app, then destroy

SECOND_APP="${WORK}/second"
mkdir -p "${SECOND_APP}"
cp -R "${FIXTURE}/app" "${FIXTURE}/public" "${FIXTURE}/package-lock.json" "${SECOND_APP}/"
sed 's/"nextship-streaming-fixture"/"nextship-e2e-second"/' "${FIXTURE}/package.json" > "${SECOND_APP}/package.json"
ln -s "$(cd "${FIXTURE}" && pwd)/node_modules" "${SECOND_APP}/node_modules"
(
  cd "${SECOND_APP}"
  printf 'node_modules\n.nextship\n' > .gitignore
  git init -q
  commit fixture
  nextship server add "${SERVER}" "$@" --yes
  commit "record the server"
  nextship deploy --yes
  nextship domain add second.nextship.test --yes
  [ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: second.nextship.test' "${URL}/")" = 308 ] || fail "second app" "its domain has no site"
  nextship destroy nextship-e2e-second --images --yes
)
curl -sf -o /dev/null "${URL}/" || fail "destroy" "the first app stopped serving when the second was destroyed"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: e2e.nextship.test' "${URL}/")" = 308 ] || fail "destroy" "the first app lost its domain"
check "destroy" "destroying one app left the other and Caddy serving"

nextship destroy nextship-streaming-fixture --images --yes
check "cleanup" "both apps are destroyed"
