#!/usr/bin/env node
/**
 * Carries what a harness test configures into the Docker build and container.
 *
 * Next.js's harness gives a deploy script the variables a test sets and expects
 * the platform to apply them. Vercel's path passes them to the build and to the
 * deployment (`test/lib/next-modes/next-deploy.ts`), and an adapter that builds in
 * place, as Bun's does, inherits them. nextship builds in Docker, which inherits
 * nothing, so every test that set a variable ran without it.
 *
 * Writes `.nextship-e2e/build-env.sh`, which the app's build script sources inside
 * the image before `next build`, and prints the container's variables to stdout,
 * NUL-separated, for `docker run -e`.
 *
 * Linux only when run: the test's variables are found by comparing two processes'
 * environments in /proc. The decisions are exported as functions, which
 * prepare-app.test.mjs checks on any platform.
 *
 * Usage: node prepare-app.mjs <deploy script pid> <harness pid>
 * Author: Gowtham
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const HARNESS_DIR = '.nextship-e2e'
const VENDORED = `${HARNESS_DIR}/vendored.tar`
const POST_BUILD = ' && pnpm post-build'

/**
 * Names in the difference that are not the test's.
 *
 * The harness process sets some in itself after it starts: Jest sets NODE_ENV to
 * `test`, and the harness adds JEST_WORKER_ID, TEST_FILE_PATH and NEXT_TEST_DIR.
 * Resolving a fixture's config there, which `// @gate` conditions do, sets
 * `__NEXT_PROCESSED_ENV`, and a build that inherits it skips the app's env files.
 * Names that begin with an underscore go as a class: the harness treats them as
 * invalid for a deployment, which is why it renames `__NEXT_TEST_MODE`. The rest
 * belong to nextship, the image or this script, and must not be overridden.
 * RUST_MIN_STACK is Next.js's own: loading SWC in the harness process sets it, and
 * the build sets the same value for itself.
 */
export const NOT_TEST_ENV =
  /^(_.*|NODE_ENV|JEST_.*|TEST_FILE_PATH|NEXT_TEST_.*|RUST_MIN_STACK|PORT|HOSTNAME|NEXT_DEPLOYMENT_ID|NEXT_ADAPTER_PATH|NEXT_SERVER_ACTIONS_ENCRYPTION_KEY|NEXTSHIP_.*)$/
const EXPORTABLE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A process environment as /proc/<pid>/environ holds it: NUL-separated NAME=value entries. */
export function parseEnviron(text) {
  const variables = new Map()
  for (const entry of text.split('\0')) {
    const separator = entry.indexOf('=')
    if (separator > 0) variables.set(entry.slice(0, separator), entry.slice(separator + 1))
  }
  return variables
}

/**
 * Variables the deploy script started with that the harness process did not.
 *
 * The harness starts the script with its own environment plus what the test set,
 * and /proc keeps each process's environment as it was at exec, so the difference
 * is what the test set, with no list of names to keep in step with the harness.
 * Names a shell cannot export are reported through `skipped` rather than dropped
 * silently.
 */
export function testVariables(script, harness, skipped = () => {}) {
  const found = new Map()
  for (const [name, value] of script) {
    if (harness.get(name) === value || NOT_TEST_ENV.test(name)) continue
    if (!EXPORTABLE.test(name)) {
      skipped(name)
      continue
    }
    found.set(name, value)
  }
  return found
}

/**
 * What Vercel's path adds to every deployment, for the build and at runtime.
 *
 * IS_TURBOPACK_TEST in particular must be a real variable rather than a line in an
 * env file, because `next build` reads it before loading env files. Without it a
 * fixture with a webpack config stopped with "webpack configurations may need to be
 * migrated to Turbopack".
 */
export function harnessFlags(env) {
  const flags = new Map()
  if (env.IS_TURBOPACK_TEST) flags.set('IS_TURBOPACK_TEST', '1')
  if (env.IS_WEBPACK_TEST) flags.set('IS_WEBPACK_TEST', '1')
  if (env.__NEXT_CACHE_COMPONENTS) flags.set('NEXT_PRIVATE_EXPERIMENTAL_CACHE_COMPONENTS', env.__NEXT_CACHE_COMPONENTS)
  if (env.__NEXT_EXPERIMENTAL_CACHED_NAVIGATIONS) {
    flags.set('NEXT_PRIVATE_EXPERIMENTAL_CACHED_NAVIGATIONS', env.__NEXT_EXPERIMENTAL_CACHED_NAVIGATIONS)
  }
  return flags
}

/** The variables `next build` runs with inside the image. */
export function buildVariables(testEnv, flags, testFile = '') {
  // NEXT_PRIVATE_TEST_MODE is for the build only, as on Vercel. It compiles in the
  // hydration marker the harness waits for; without it every browser page load
  // waited out a 10 second fallback, and tests that load several pages ran out of time.
  const build = new Map([...testEnv, ...flags, ['NEXT_PRIVATE_TEST_MODE', 'e2e']])

  // Next.js runs these suites only with its native TypeScript config loader on, in a
  // job of their own, and its deploy workflow runs on Node 20, where they skip. On
  // Node 22 they run, and without the loader each one failed loading next.config.ts.
  // This is the variable `next build --experimental-next-config-strip-types` sets.
  if (/\/test\/e2e\/app-dir\/next-config-ts-native-m?ts\//.test(testFile)) {
    build.set('__NEXT_NODE_NATIVE_TS_LOADER_ENABLED', 'true')
  }
  return build
}

/**
 * The variables the container runs with.
 *
 * The deploy script starts the server as localhost, which a runner can resolve to
 * ::1 as well as 127.0.0.1, and Node binds only the first. IPv4 first makes that
 * 127.0.0.1 on every runner, where the readiness check and any client that names
 * the address can reach it. A test's own options are kept after it.
 */
export function containerVariables(testEnv, flags) {
  return new Map([
    ...testEnv,
    ...flags,
    ['NODE_OPTIONS', ['--dns-result-order=ipv4first', testEnv.get('NODE_OPTIONS')].filter(Boolean).join(' ')],
  ])
}

/** The script the build sources: the build's variables, then the fixture's committed packages. */
export function buildEnvScript(buildEnv, hasVendored) {
  const lines = [
    '# Written by the nextship compatibility harness. Sourced by the build script',
    '# inside the image, before next build.',
    ...[...buildEnv].map(([name, value]) => `export ${name}=${shellQuote(value)}`),
  ]
  // Packages the fixture committed under node_modules, which no lockfile lists.
  // Vercel's path copies them over the tree its install produced, and this does the
  // same after the image's install. A tar carries them through the build context
  // intact, where its ignore rules would drop any node_modules nested inside them.
  if (hasVendored) lines.push(`tar -xf ${VENDORED} -C node_modules`)
  return `${lines.join('\n')}\n`
}

/**
 * The app's build script, rewritten to source the variables first.
 *
 * The harness runs its marker script with pnpm, which corepack refuses in an app
 * that declares another package manager, as handle-non-hoisted-swc-helpers does.
 * npm is in every builder image and runs the same script. The prefix is the same
 * for every app, so apps with the same dependencies still produce the same
 * package.json for the image's install layer.
 */
export function rewriteBuildScript(build) {
  const command = build.endsWith(POST_BUILD) ? `${build.slice(0, -POST_BUILD.length)} && npm run post-build` : build
  return `. ./${HARNESS_DIR}/build-env.sh && ${command}`
}

/**
 * The lockfile to write, or null when it needs no change.
 *
 * npm names the lockfile after the directory when package.json has no name, and
 * every harness app has a directory of its own. That one field made each app's
 * install layer unique, so apps with identical dependencies all installed afresh.
 */
export function normalizeLockfile(lockfile, manifest) {
  if (manifest.name !== undefined || lockfile.name === 'app') return null
  return { ...lockfile, name: 'app' }
}

/** Single quotes keep every character literal; a quote inside is closed, escaped and reopened. */
export function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function main() {
  const [scriptPid, harnessPid] = process.argv.slice(2)
  if (!scriptPid || !harnessPid) fail('usage: prepare-app.mjs <deploy script pid> <harness pid>')

  const environ = (pid) => parseEnviron(readFileSync(`/proc/${pid}/environ`, 'utf8'))
  const testEnv = testVariables(environ(scriptPid), environ(harnessPid), (name) =>
    process.stderr.write(`nextship: not forwarding ${JSON.stringify(name)}, which a shell cannot export\n`)
  )
  const flags = harnessFlags(process.env)
  const buildEnv = buildVariables(testEnv, flags, process.env.TEST_FILE_PATH)

  mkdirSync(HARNESS_DIR, { recursive: true })
  writeFileSync(`${HARNESS_DIR}/build-env.sh`, buildEnvScript(buildEnv, existsSync(VENDORED)))

  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  if (typeof manifest.scripts?.build !== 'string') fail('the harness wrote no build script into package.json')
  manifest.scripts.build = rewriteBuildScript(manifest.scripts.build)
  writeFileSync('package.json', `${JSON.stringify(manifest, null, 2)}\n`)

  if (existsSync('package-lock.json')) {
    const lockfile = normalizeLockfile(JSON.parse(readFileSync('package-lock.json', 'utf8')), manifest)
    if (lockfile) writeFileSync('package-lock.json', `${JSON.stringify(lockfile, null, 2)}\n`)
  }

  const containerEnv = containerVariables(testEnv, flags)
  process.stderr.write(
    `nextship: build variables: ${[...buildEnv.keys()].join(' ')}\n` +
      `nextship: container variables: ${[...containerEnv.keys()].join(' ') || 'none'}\n`
  )
  for (const [name, value] of containerEnv) process.stdout.write(`${name}=${value}\0`)
}

function fail(message) {
  process.stderr.write(`nextship: ${message}\n`)
  process.exit(1)
}

// Run as a command, not when imported by the tests. Compared as real paths, since a
// module's own URL has its symlinks resolved and the command line may not.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main()
