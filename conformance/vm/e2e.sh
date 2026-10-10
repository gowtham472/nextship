#!/usr/bin/env bash
#
# End to end against a real server over SSH: sets the server up, deploys the streaming
# fixture behind Caddy, and checks what the VM target promises. Streaming passes through
# the proxy, a new deployment drops no request, a deployment that cannot start leaves the
# previous one serving, rollback returns to the previous deployment, env push takes effect
# without downtime, a replaced deployment's logs are still readable, pruning keeps the
# live image, a regenerated ISR page and an optimized image survive a container restart,
# the app's container is read-only and cannot run what it writes, a tab from before a
# deployment reaches its own build, a rollback within the hour is instant, a preview
# serves beside the app and leaves it alone when destroyed, a domain gets its own site,
# a declared writable folder outlives a deployment, the retire timer never stops the live
# container, a server with the older setup keeps nothing, destroying one app leaves
# another serving, and destroying an app takes its previews with it.
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

# A route that answers with a stamp written into its source, so a response says
# which build served it. Each build below rewrites the stamp.
stamp() {
  mkdir -p app/api/build
  printf 'export const dynamic = "force-dynamic"\nexport function GET() { return Response.json({ build: "%s" }) }\n' "$1" > app/api/build/route.js
}
# The deployment id a build names on every request an open tab makes, read from
# the ?dpl= Next.js puts on the page's scripts.
page_dpl() { curl -s "${URL}/" | grep -o 'dpl=dpl-[A-Za-z0-9_.-]*' | head -1 | cut -d= -f2; }
build_of() { curl -s "$@" | sed -n 's/.*"build":"\([a-z]*\)".*/\1/p'; }

stamp first
# A folder the app may write to, declared before the first deployment, and a route
# that writes a note there and reads it back.
node -e "const fs = require('fs'); const c = JSON.parse(fs.readFileSync('nextship.json', 'utf8')); c.writable = ['data']; fs.writeFileSync('nextship.json', JSON.stringify(c, null, 2) + '\n')"
mkdir -p app/api/data
cat > app/api/data/route.js <<'JS'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
export const dynamic = 'force-dynamic'
const file = process.cwd() + '/data/note.txt'
export async function POST(request) {
  await mkdir(process.cwd() + '/data', { recursive: true })
  await writeFile(file, await request.text())
  return Response.json({ written: true })
}
export async function GET() {
  try {
    return new Response(await readFile(file, 'utf8'))
  } catch (error) {
    return new Response(String(error.code), { status: 404 })
  }
}
JS
commit "record the server"
nextship deploy --yes
curl -sf -o /dev/null "${URL}/" || fail "deploy" "${URL}/ does not answer after deploying"
check "deploy" "the fixture serves at ${URL}"

# The container's root is read-only, so this write works only because `data` was
# declared writable. It is read back after the next deployment, further down.
[ "$(curl -s -X POST --data 'written by the first build' "${URL}/api/data")" = '{"written":true}' ] ||
  fail "writable" "the app could not write to the folder it declared: $(curl -s -X POST --data x "${URL}/api/data")"

node "${HERE}/../streaming/measure.mjs" "${URL}/stream"
EDGE="$(curl -s "${URL}/edge")"
[ "${EDGE}" = '{"runtime":"edge-runtime"}' ] || fail "edge" "/edge answered: ${EDGE:-nothing}"
check "edge" "/edge ran in the Edge runtime, through Caddy"

# ------------------------------------------------------------- zero downtime

FIRST_DPL="$(page_dpl)"
FIRST_SCRIPT="$(curl -s "${URL}/" | grep -o '/_next/static/[^"]*?dpl=dpl-[A-Za-z0-9_.-]*' | head -1)"
[ -n "${FIRST_DPL}" ] && [ -n "${FIRST_SCRIPT}" ] || fail "skew" "the first build's page named no deployment id on its scripts"
echo "// second build $(date +%s)" >> app/layout.jsx
stamp second
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

# ------------------------------------------------------------ skew protection

# A tab that loaded the first build keeps naming it: x-deployment-id on navigations
# and Server Actions, ?dpl= on scripts. Those requests must reach the first build's
# container, kept running, while a request naming nothing gets the new build.
SECOND_DPL="$(page_dpl)"
[ -n "${SECOND_DPL}" ] && [ "${SECOND_DPL}" != "${FIRST_DPL}" ] || fail "skew" "the second build names the same deployment id as the first"
[ "$(build_of "${URL}/api/build")" = second ] || fail "skew" "a request naming no build did not get the new one"
[ "$(build_of -H "X-Deployment-Id: ${FIRST_DPL}" "${URL}/api/build")" = first ] ||
  fail "skew" "a request with the first build's x-deployment-id did not reach it"
[ "$(build_of "${URL}/api/build?dpl=${FIRST_DPL}")" = first ] || fail "skew" "a request with ?dpl= for the first build did not reach it"
[ "$(curl -s -o /dev/null -w '%{http_code}' "${URL}${FIRST_SCRIPT}")" = 200 ] || fail "skew" "the first build's script ${FIRST_SCRIPT} is gone"
check "skew" "requests naming the first build reach it after the second went live, and the rest get the second"

# The second build is a new image and a new container, and the note is still there.
[ "$(build_of "${URL}/api/build")" = second ] || fail "writable" "the second build is not serving"
[ "$(curl -s "${URL}/api/data")" = 'written by the first build' ] ||
  fail "writable" "what the first build wrote did not survive the deployment: $(curl -s "${URL}/api/data")"
check "writable" "the app wrote to the folder it declared, and a later deployment read it back"
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
# The first build was kept running when the second replaced it, so going back to it
# is a switch of the proxy, not a new container.
ROLLED="$(nextship rollback --yes)"
echo "${ROLLED}"
[ "$(nextship rollback | sed -n 's/^  current *\([^ ]*\).*/\1/p')" = "${TARGET}" ] || fail "rollback" "the live deployment is not ${TARGET}"
curl -sf -o /dev/null "${URL}/" || fail "rollback" "${URL}/ does not answer after rolling back"
check "rollback" "${TARGET} serves again"
SWITCH_MS="$(sed -n 's/.*which was still running, in \([0-9]*\) ms.*/\1/p' <<< "${ROLLED}")"
[ -n "${SWITCH_MS}" ] || fail "instant rollback" "the rollback started a new container instead of switching to the one still running"
[ "$(build_of "${URL}/api/build")" = first ] || fail "instant rollback" "the first build does not serve after rolling back to it"
[ "$(build_of -H "X-Deployment-Id: ${SECOND_DPL}" "${URL}/api/build")" = second ] ||
  fail "instant rollback" "the build rolled back from was not kept for the tabs that loaded it"
check "instant rollback" "switched back to the first build's running container in ${SWITCH_MS} ms, keeping the second for its tabs"

# ------------------------------------------------------------------- retire

# Not waited out: the kept container's stop time is moved to the past and the timer's
# service run, as the timer would an hour after the rollback.
SUDO=""
on_server "sudo -n true" 2> /dev/null && SUDO="sudo -n"
KEPT="$(on_server "${SUDO} cut -d' ' -f1 /etc/nextship/apps/nextship-streaming-fixture/previous")"
[ -n "${KEPT}" ] || fail "retire" "no kept container is recorded"
on_server "printf '%s 1\n' ${KEPT} | ${SUDO} tee /etc/nextship/apps/nextship-streaming-fixture/previous > /dev/null && ${SUDO} systemctl start nextship-retire.service"
[ "$(on_server "${SUDO} docker inspect -f '{{.State.Running}}' ${KEPT}")" = false ] || fail "retire" "${KEPT} still runs after its time ran out"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Deployment-Id: ${SECOND_DPL}" "${URL}/api/build")" = 200 ] ||
  fail "retire" "a request naming the stopped build was not served by the live one"
[ "$(build_of -H "X-Deployment-Id: ${SECOND_DPL}" "${URL}/api/build")" = first ] || fail "retire" "a request naming the stopped build got something other than the live build"
check "retire" "the kept container stopped when its time ran out, and requests naming it fell back to the live build"

# The worst `previous` can say: the live container, with its time already up. The
# timer must refuse, because the Caddy site names that container as the one serving.
LIVE_NOW="$(on_server "${SUDO} sed -n 's/^# live //p' /etc/nextship/caddy/sites/nextship-streaming-fixture.caddy")"
[ -n "${LIVE_NOW}" ] || fail "retire" "the Caddy site names no live container"
on_server "printf '%s 1\n' ${LIVE_NOW} | ${SUDO} tee /etc/nextship/apps/nextship-streaming-fixture/previous > /dev/null && ${SUDO} systemctl start nextship-retire.service"
[ "$(on_server "${SUDO} docker inspect -f '{{.State.Running}}' ${LIVE_NOW}")" = true ] || fail "retire" "the timer stopped the live container ${LIVE_NOW}"
[ "$(build_of "${URL}/api/build")" = first ] || fail "retire" "the app stopped serving after the timer ran"
on_server "${SUDO} journalctl -t nextship-retire --no-pager -n 5" | grep -q "not stopping ${LIVE_NOW}" || fail "retire" "the refusal was not logged"
check "retire" "told to stop the live container, the timer refused and said so"

# ------------------------------------------- a server set up by an older nextship

# A server set up before the retire timer existed has nothing to stop a kept
# container. Marked as one, a deployment must keep nothing and say what to run.
on_server "printf '{\"setupVersion\":2}\n' | ${SUDO} tee /etc/nextship/server.json > /dev/null"
stamp oldsetup
commit "a build for a server with the older setup"
OLD_SETUP="$(nextship deploy --yes)"
echo "${OLD_SETUP}"
on_server "printf '{\"setupVersion\":3}\n' | ${SUDO} tee /etc/nextship/server.json > /dev/null"
grep -q 'nextship server add' <<< "${OLD_SETUP}" || fail "older setup" "the deployment did not say to run server add again"
grep -q 'kept .* running until' <<< "${OLD_SETUP}" && fail "older setup" "a container was kept on a server with no timer to stop it"
[ "$(build_of "${URL}/api/build")" = oldsetup ] || fail "older setup" "the deployment is not serving"
RUNNING="$(on_server "${SUDO} docker ps --filter label=sh.nextship.app=nextship-streaming-fixture --filter status=running --format '{{.Names}}'" | wc -l | tr -d ' ')"
[ "${RUNNING}" = 1 ] || fail "older setup" "${RUNNING} containers of the app are running, where only the live one should be"
on_server "${SUDO} grep -q '@previous' /etc/nextship/caddy/sites/nextship-streaming-fixture.caddy" && fail "older setup" "the site routes to a container that was stopped"
check "older setup" "a server with no retire timer kept nothing, stopped the replaced container, and said to run server add"

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
REMAINING="$(grep -c '^  dpl-' <<< "${IMAGES}" || true)"
# The build the env route deployment replaced is still kept running for its tabs,
# and Docker cannot remove an image a running container uses, so it stays too.
[ "${REMAINING}" -eq 2 ] || fail "images prune" "${REMAINING} images remain after keeping 1, where the live and the kept one were expected"
grep -q 'deployed now' <<< "${IMAGES}" || fail "images prune" "the live image was removed"
grep -q 'kept running for tabs' <<< "${IMAGES}" || fail "images prune" "the kept deployment's image was removed"
curl -sf -o /dev/null "${URL}/" || fail "images prune" "the app stopped serving"
check "images prune" "the live image and the one still running for older tabs kept, nothing else, and the app still serves"

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
# The live one by its build: the deployment it replaced, a different build, is kept
# running beside it, and an older container of the live build is stopped.
LIVE_TAG="$(nextship rollback | sed -n 's/^  current *\([^ ]*\).*/\1/p')"
CONTAINER="$(on_server "${DOCKER} ps --filter label=sh.nextship.app=nextship-streaming-fixture --filter label=sh.nextship.image=${LIVE_TAG} --filter status=running --format '{{.Names}}'")"
[ "$(wc -l <<< "${CONTAINER}" | tr -d ' ')" = 1 ] && [ -n "${CONTAINER}" ] ||
  fail "durability" "expected one running container of the live build ${LIVE_TAG}, found: ${CONTAINER:-none}"

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

# ---------------------------------------------------------------- hardening

# The same container has just regenerated a page and optimized an image, so what
# follows proves the protections are enforced, not only that the app tolerates them.
# Each is tried from inside, as code running through a flaw in the app would try it.
HARDENING="$(on_server "${DOCKER} inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}} {{.HostConfig.PidsLimit}}' ${CONTAINER}")"
[ "${HARDENING}" = "true [ALL] [no-new-privileges] 512" ] ||
  fail "hardening" "the container is not run read-only with no capabilities: ${HARDENING}"
on_server "${DOCKER} exec ${CONTAINER} sh -c 'touch next.config.js' 2> /dev/null" &&
  fail "hardening" "code inside the container could rewrite the app"
on_server "${DOCKER} exec ${CONTAINER} sh -c 'cp /bin/true /tmp/dropped && /tmp/dropped' 2> /dev/null" &&
  fail "hardening" "code inside the container could run a program it wrote to /tmp"
# The image has no `data` folder, so Docker makes the mount point for the declared
# writable folder in the container's own layer when it creates the container. That
# is the one change expected there, and its parent directory with it; anything
# else is a write that got past the read-only root.
WRITTEN="$(on_server "${DOCKER} diff ${CONTAINER}" | grep -v -x -e 'C /src' -e 'A /src/data' || true)"
[ -z "${WRITTEN}" ] || fail "hardening" "the container wrote outside its volumes: ${WRITTEN}"
check "hardening" "the app can rewrite none of its files, cannot run a program from /tmp, and wrote nothing outside its volumes"

# ------------------------------------------------------------- cache guard

# Run now rather than waited for, as the timer runs it. Under its limit it must
# delete nothing, so the regenerated page is still the one that survived the restart.
on_server "systemctl is-active --quiet nextship-cache-guard.timer" || fail "cache guard" "its timer is not active"
on_server "sudo -n systemctl start nextship-cache-guard.service 2> /dev/null || systemctl start nextship-cache-guard.service" ||
  fail "cache guard" "a run failed: $(on_server 'journalctl -u nextship-cache-guard.service -n 5 --no-pager' 2>&1)"
[ "$(curl -s "${URL}/isr")" = "${REGENERATED}" ] || fail "cache guard" "a run under the limit changed what the app serves"
check "cache guard" "its timer is active, and a run under the limit left the app's cache as it was"

# ------------------------------------------------------------------ domains

nextship domain add e2e.nextship.test --yes
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: e2e.nextship.test' "${URL}/")" = 308 ] ||
  fail "domain add" "the domain did not get its own HTTPS site"
check "domain add" "the domain redirects to HTTPS through its own site"

# ------------------------------------------------------------------ preview

# A preview of this app on the same server, from a build the app never ran. It must
# serve that build, leave the app's own address and build alone, keep out of
# nextship.json, ask crawlers not to index it, and go away without touching the app.
MAIN_BUILD="$(build_of "${URL}/api/build")"
RECORDED="$(cat nextship.json)"
stamp preview
commit "a preview build"
nextship deploy --preview e2e --yes
[ "$(cat nextship.json)" = "${RECORDED}" ] || fail "preview" "deploying a preview changed nextship.json"
[ "$(build_of "${URL}/api/build")" = "${MAIN_BUILD}" ] || fail "preview" "the app's own address stopped serving its build"
PREVIEW_CONTAINER="$(on_server "${DOCKER} ps --filter label=sh.nextship.app=nextship-streaming-fixture-e2e --filter status=running --format '{{.Names}}'")"
[ -n "${PREVIEW_CONTAINER}" ] || fail "preview" "no running container for the preview"
PREVIEW_BUILD="$(on_server "${DOCKER} exec ${PREVIEW_CONTAINER} node -e \"fetch('http://127.0.0.1:3000/api/build').then(r => r.json()).then(b => console.log(b.build))\"")"
[ "${PREVIEW_BUILD}" = preview ] || fail "preview" "the preview serves ${PREVIEW_BUILD:-nothing}, not its own build"
nextship domain add e2e-preview.nextship.test --preview e2e --yes
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: e2e-preview.nextship.test' "${URL}/")" = 308 ] ||
  fail "preview" "the preview's domain did not get its own HTTPS site"
on_server "${SUDO} grep -q 'X-Robots-Tag \"noindex, nofollow\"' /etc/nextship/caddy/sites/nextship-streaming-fixture-e2e.caddy" ||
  fail "preview" "the preview's site does not ask crawlers not to index it"
if nextship logs --preview not-a-preview > /dev/null 2>&1; then fail "preview" "a preview that does not exist was not refused"; fi
nextship destroy nextship-streaming-fixture-e2e --preview e2e --images --yes
[ "$(cat nextship.json)" = "${RECORDED}" ] || fail "preview" "destroying the preview changed nextship.json"
[ "$(build_of "${URL}/api/build")" = "${MAIN_BUILD}" ] || fail "preview" "the app stopped serving when its preview was destroyed"
check "preview" "served its own build beside the app, kept out of nextship.json, asked crawlers not to index it, and was destroyed leaving the app serving"

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

# A preview left when its app is destroyed could never be reached again: the app's id
# is what finds it, and destroying the app removes the id from nextship.json.
nextship deploy --preview orphan --yes
DESTROYED="$(nextship destroy nextship-streaming-fixture --images --yes)"
echo "${DESTROYED}"
grep -q 'preview    DESTROY "nextship-streaming-fixture-orphan"' <<< "${DESTROYED}" || fail "destroy" "the plan did not name the preview it removes"
LEFT="$(on_server "${SUDO} docker ps -a --filter label=sh.nextship.managed=true --format '{{.Names}}' | grep -v '^nextship-caddy$' || true; ${SUDO} ls /etc/nextship/apps; ${SUDO} docker volume ls -q --filter label=sh.nextship.managed=true")"
[ -z "${LEFT}" ] || fail "destroy" "containers, app records or volumes are left on the server: ${LEFT}"
check "cleanup" "both apps are destroyed, the preview with its app, and nothing of them is left on the server"
