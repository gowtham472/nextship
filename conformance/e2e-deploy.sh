#!/usr/bin/env bash
#
# Deploy script for the Next.js adapter compatibility harness.
#
# The harness creates an isolated temporary app, runs this with `cwd` set to it,
# and expects exactly one thing on stdout: the URL the app is reachable at.
# Everything else must go to stderr, or the harness cannot parse the result.
#
# Runs on Linux: prepare-app.mjs reads /proc, and the container shares the
# host's network.
#
# Contract: nextjs.org/docs/app/api-reference/adapters/testing-adapters
# Author: Gowtham
set -euo pipefail

: "${ADAPTER_DIR:?ADAPTER_DIR must point at the nextship checkout}"

NEXTSHIP="${ADAPTER_DIR}/packages/cli/dist/index.js"
CONTAINER="nextship-e2e-$$"

# Logs live beside the app, never inside it.
#
# They used to be written into the app directory, which is the Docker build
# context. The packaging step runs two builds, a manifest target and then the
# runtime image, and the log file grew between them. That changed the context, so
# `COPY . .` missed the cache on the second build and everything after it re-ran:
# the whole Next.js build again plus an 11 second trace prune, for about 16
# wasted seconds on every test in the suite. A sibling directory keeps the
# context byte identical across both builds.
LOGDIR="${PWD}.logs"
mkdir -p "${LOGDIR}"

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
  for f in "${LOGDIR}/install.log" "${LOGDIR}/package.log" "${LOGDIR}/server.log"; do
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

# One key for the whole run. The harness builds many apps, and Server Actions
# must stay decryptable across them.
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:-$(head -c 32 /dev/urandom | base64)}"

install_dependencies() {
  npm install --no-audit --no-fund --loglevel=error >> "${LOGDIR}/install.log" 2>&1
}

# The harness stages the app with `skipInstall: true` and rewrites every
# dependency to a `file:` path under next-test-packages, so the deploy target is
# expected to install, exactly as a hosted platform does when you push source.
#
# nextship reads the *installed* Next.js version rather than the declared range,
# deliberately, so it needs those dependencies present before it will plan
# anything. Installing here is the adapter holding up its side of that contract.
if [ ! -d node_modules/next ]; then
  # Some fixtures commit packages under node_modules that no package.json lists,
  # and npm deletes them as extraneous. They are saved first, restored here for
  # the host, and restored in the image after its own install (prepare-app.mjs).
  if [ -d node_modules ]; then
    mkdir -p .nextship-e2e
    tar -cf .nextship-e2e/vendored.tar -C node_modules .
  fi

  log "installing dependencies, which the harness leaves to the deploy target"
  if ! install_dependencies; then
    # A package published from the Next.js repo can declare a peer range on next
    # that the tested canary does not satisfy, because a prerelease only matches a
    # range that names one. The harness notes the same problem for its own
    # workspace packages. A project in that position sets legacy-peer-deps, and
    # nextship mounts .npmrc into the image's install too.
    grep -q ERESOLVE "${LOGDIR}/install.log" || { log "install failed"; exit 1; }
    log "retrying the install with legacy-peer-deps after a peer dependency conflict"
    printf '\nlegacy-peer-deps=true\n' >> .npmrc
    install_dependencies || { log "install failed"; exit 1; }
  fi

  if [ -f .nextship-e2e/vendored.tar ]; then
    tar -xf .nextship-e2e/vendored.tar -C node_modules
  fi
  log "installed next $(node -p "require('./node_modules/next/package.json').version" 2>/dev/null || echo unknown)"
fi

# What the harness actually staged.
#
# The suite's premise is that the app runs the Next.js built from the checkout
# under test, which the harness arranges by rewriting dependencies to
# `file:./next-test-packages/<name>/packed.tgz`. If that rewrite did not happen
# the install silently resolves a published build from the registry instead, and
# the whole run then measures a Next.js nobody is testing. That difference is
# invisible in a passing log and expensive to infer from a failing one, so it is
# recorded on every deploy rather than reconstructed afterwards.
{
  echo "--- staged dependencies ---"
  node -p "JSON.stringify(require('./package.json').dependencies ?? {}, null, 2)" 2>&1 || true
  echo "--- next-test-packages present? ---"
  ls -d next-test-packages 2>/dev/null || echo "absent: dependencies were not rewritten to local tarballs"
  echo "--- next resolved from ---"
  node -p "require.resolve('next/package.json', { paths: [process.cwd()] })" 2>&1 || true
} >&2

# Keep the harness's own test files out of the app being deployed.
#
# Each test's fixture directory is staged wholesale, so the *.test.ts files that
# describe the test land at the root of the app alongside its app/ directory.
# Next.js finds no tsconfig, generates a default one that includes **/*.ts, and
# then type checks the test file against an app whose package.json never declared
# a test runner, so the build dies on "Cannot find name 'expect'".
#
# That is an artefact of staging, not a deployment concern: run in place inside
# the Next.js repo these files resolve jest's types from the monorepo root, and
# in an isolated container there is no monorepo to walk up into. A deploy target
# has no business compiling the suite that is testing it, so the files simply are
# not part of the build context. nextship merges this into its generated rules.
# A leading newline first: an existing .dockerignore with no trailing one would
# otherwise splice its last rule into the first of these and change both.
printf '\n' >> .dockerignore
cat >> .dockerignore <<'IGNORE'
**/*.test.ts
**/*.test.tsx
**/*.test.js
**/*.test.jsx
**/*.results.json
IGNORE

# The test's variables and the harness's flags, for the build and the container.
# $$ is this script and $PPID the harness process that started it.
node "${ADAPTER_DIR}/conformance/prepare-app.mjs" "$$" "${PPID}" > "${LOGDIR}/container.env"
CONTAINER_ENV=()
while IFS= read -r -d '' variable; do
  CONTAINER_ENV+=(-e "${variable}")
done < "${LOGDIR}/container.env"

log "packaging $(pwd)"
# The tag is read from what packaging reported, not from the newest image on the
# daemon, which under concurrency could belong to another test.
node "${NEXTSHIP}" package > "${LOGDIR}/package.log" 2>&1 || { cat "${LOGDIR}/package.log" >&2; exit 1; }
cat "${LOGDIR}/package.log" >&2

TAG="$(sed -n 's/.*Image ready: \([^ ]*\).*/\1/p' "${LOGDIR}/package.log" | tail -1)"
[ -n "${TAG}" ] || { log "packaging reported no image tag"; exit 1; }

# The build runs inside Docker, so .next never exists out here. The real
# BUILD_ID is printed by the post-build script the harness injects into the
# app, which executes in the image and lands in the packaging log behind a
# BuildKit step prefix. Reading .next/BUILD_ID from the host reported
# "unknown" for every test, and the harness builds /_next/data/<buildId>/
# URLs from this value, so every Pages Router data request asked for a path
# that could not exist.
BUILD_ID="$(sed -n 's/^#[0-9]\{1,\} [0-9.]\{1,\} BUILD_ID: \(.\{1,\}\)$/\1/p' "${LOGDIR}/package.log" | tail -1)"
[ -n "${BUILD_ID}" ] || { log "the build printed no BUILD_ID marker"; exit 1; }

# Persisted because the logs and cleanup scripts run as separate processes and
# cannot see these variables. Written before the container starts, so cleanup
# can find a container that never became ready.
{
  echo "BUILD_ID: ${BUILD_ID}"
  echo "DEPLOYMENT_ID: $(node -e "process.stdout.write(require('./.nextship/output/manifest.json').deploymentId)" 2>/dev/null || echo unknown)"
  # nextship serves assets from the container, not a content-addressed store.
  echo "NEXT_SUPPORTS_IMMUTABLE_ASSETS: 0"
  echo "CONTAINER: ${CONTAINER}"
  echo "TAG: ${TAG}"
} > "${LOGDIR}/build.log"

# The harness runs tests concurrently, so a fixed port would collide. The kernel
# picks one free on every local address, asked for as late as possible so nothing
# else takes it first.
PORT="$(node -e "
const server = require('node:net').createServer()
server.listen(0, () => { process.stdout.write(String(server.address().port)); server.close() })
")"

# The server listens on the harness's port, on the host's network, as localhost.
#
# Published on port 3000 behind a remapped host port, the server's idea of its
# own address was not the harness's. An app that fetches itself through the Host
# header reached a port nothing listened on inside the container, and a route
# handler that redirects to `request.nextUrl.origin` sent the browser to
# http://0.0.0.0:3000.
#
# The name matters as much as the port. Next.js builds that origin from the name
# it listens on, while middleware turns any loopback address into localhost. As
# 127.0.0.1, every middleware rewrite looked like one to another host and was
# proxied instead of served, so data requests came back as HTML. localhost is the
# name `next start` reports and the harness then requests, so every side agrees.
#
# No health check: its request to / every 30 seconds is traffic no test sent,
# which can revalidate a page mid-test and adds lines to the server log that
# tests read.
log "starting ${TAG} as ${CONTAINER} on port ${PORT}"
docker run -d --name "${CONTAINER}" --platform linux/amd64 --network host --no-healthcheck \
  -e PORT="${PORT}" -e HOSTNAME=localhost "${CONTAINER_ENV[@]}" "${TAG}" >&2

# Ready when the server accepts a connection. The request to / this used to send
# ran middleware and rendered a page before any test had, and it waited out the
# whole minute for any app whose / answered with an error status, 404 included.
# With the host's network nothing accepts on the port until the server does. The
# server binds 127.0.0.1 for localhost; prepare-app.mjs explains why.
ready=0
for _ in $(seq 1 300); do
  if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then
    ready=1
    break
  fi
  if [ "$(docker inspect -f '{{.State.Status}}' "${CONTAINER}" 2>/dev/null)" != "running" ]; then
    break
  fi
  sleep 0.2
done

docker logs "${CONTAINER}" > "${LOGDIR}/server.log" 2>&1 || true
[ "${ready}" -eq 1 ] || { log "the server never accepted a connection"; exit 1; }

# The only line on stdout.
echo "http://localhost:${PORT}"
