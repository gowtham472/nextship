/**
 * Tests for what the compatibility harness hands each build and container.
 *
 * Each case is a way the suite once ran against something other than what the test
 * asked for: a variable the test set that never arrived, a runner-only variable that
 * leaked in and changed the build, or a value a shell mangled on the way.
 *
 * Run with: node --test conformance/*.test.mjs
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

import {
  buildEnvScript,
  buildVariables,
  containerVariables,
  harnessFlags,
  normalizeLockfile,
  parseEnviron,
  rewriteBuildScript,
  testVariables,
} from './prepare-app.mjs'

test('reads an environment the way /proc stores it', () => {
  const env = parseEnviron('PATH=/usr/bin\0QUERY=a=b\0EMPTY=\0\0')
  assert.equal(env.get('PATH'), '/usr/bin')
  assert.equal(env.get('QUERY'), 'a=b', 'only the first = separates name from value')
  assert.equal(env.get('EMPTY'), '')
  assert.equal(env.size, 3)
})

test("forwards what the test set, and nothing that was already the harness's", () => {
  const harness = new Map([
    ['PATH', '/usr/bin'],
    ['CI', 'true'],
    ['SHARED', 'same'],
  ])
  const script = new Map([
    ...harness,
    ['MIDDLEWARE_TEST', 'asdf'],
    ['SHARED', 'same'],
    // Set with a different value than the harness had: the test's value wins.
    ['CI', ''],
  ])
  assert.deepEqual([...testVariables(script, harness)], [
    ['CI', ''],
    ['MIDDLEWARE_TEST', 'asdf'],
  ])
})

test('leaves out what Jest, the harness, Next.js and nextship set for themselves', () => {
  const script = new Map([
    ['NODE_ENV', 'test'],
    ['JEST_WORKER_ID', '1'],
    ['TEST_FILE_PATH', '/w/test/e2e/a.test.ts'],
    ['NEXT_TEST_DIR', '/tmp/next-test-1'],
    ['RUST_MIN_STACK', '8388608'],
    // A build that inherits this skips the app's env files.
    ['__NEXT_PROCESSED_ENV', 'true'],
    ['PORT', '3000'],
    ['HOSTNAME', 'runner'],
    ['NEXT_DEPLOYMENT_ID', 'dpl-other'],
    ['NEXT_ADAPTER_PATH', '/x/adapter.mjs'],
    ['NEXT_SERVER_ACTIONS_ENCRYPTION_KEY', 'secret'],
    ['NEXTSHIP_DEPLOYMENT_ID', 'dpl-x'],
    ['TEST_NODE_MIDDLEWARE', 'true'],
  ])
  assert.deepEqual([...testVariables(script, new Map()).keys()], ['TEST_NODE_MIDDLEWARE'])
})

test('reports a name no shell can export instead of dropping it silently', () => {
  const skipped = []
  const found = testVariables(new Map([['BAD-NAME', 'x'], ['GOOD_NAME', 'y']]), new Map(), (name) => skipped.push(name))
  assert.deepEqual([...found.keys()], ['GOOD_NAME'])
  assert.deepEqual(skipped, ['BAD-NAME'])
})

test("passes the harness's flags as Vercel's deploy path does", () => {
  const flags = harnessFlags({ IS_TURBOPACK_TEST: 'true', __NEXT_CACHE_COMPONENTS: 'true', UNRELATED: '1' })
  assert.deepEqual([...flags], [
    ['IS_TURBOPACK_TEST', '1'],
    ['NEXT_PRIVATE_EXPERIMENTAL_CACHE_COMPONENTS', 'true'],
  ])
  assert.equal(harnessFlags({}).size, 0)
})

test('the build runs in test mode, and the container does not', () => {
  const testEnv = new Map([['MIDDLEWARE_TEST', 'asdf']])
  const flags = new Map([['IS_TURBOPACK_TEST', '1']])
  const build = buildVariables(testEnv, flags)
  assert.equal(build.get('NEXT_PRIVATE_TEST_MODE'), 'e2e')
  assert.equal(build.get('MIDDLEWARE_TEST'), 'asdf')
  assert.equal(build.get('IS_TURBOPACK_TEST'), '1')
  assert.equal(containerVariables(testEnv, flags).has('NEXT_PRIVATE_TEST_MODE'), false)
})

test('only the native TypeScript config suites get the native loader', () => {
  const loader = (file) => buildVariables(new Map(), new Map(), file).get('__NEXT_NODE_NATIVE_TS_LOADER_ENABLED')
  assert.equal(loader('/w/nextjs/test/e2e/app-dir/next-config-ts-native-ts/a/a.test.ts'), 'true')
  assert.equal(loader('/w/nextjs/test/e2e/app-dir/next-config-ts-native-mts/a/a.test.ts'), 'true')
  // The transpiled config suites must keep Next.js's default loader.
  assert.equal(loader('/w/nextjs/test/e2e/app-dir/next-config-ts/a/a.test.ts'), undefined)
  assert.equal(loader(''), undefined)
})

test('the container prefers IPv4 and keeps any options the test set', () => {
  assert.equal(containerVariables(new Map(), new Map()).get('NODE_OPTIONS'), '--dns-result-order=ipv4first')
  const withOwn = containerVariables(new Map([['NODE_OPTIONS', '--max-old-space-size=512']]), new Map())
  assert.equal(withOwn.get('NODE_OPTIONS'), '--dns-result-order=ipv4first --max-old-space-size=512')
})

test('the marker script runs with npm, behind the same prefix for every app', () => {
  assert.equal(
    rewriteBuildScript('next build && pnpm post-build'),
    '. ./.nextship-e2e/build-env.sh && next build && npm run post-build'
  )
  // A build script that does not end in the harness's marker is kept as it is.
  assert.equal(rewriteBuildScript('next build --debug'), '. ./.nextship-e2e/build-env.sh && next build --debug')
})

test('a lockfile named after its temporary directory is renamed, and only then', () => {
  const lockfile = { name: 'next-test-1789286697804-645', lockfileVersion: 3 }
  assert.deepEqual(normalizeLockfile(lockfile, {}), { name: 'app', lockfileVersion: 3 })
  assert.equal(normalizeLockfile({ name: 'app' }, {}), null, 'already normalised')
  assert.equal(normalizeLockfile(lockfile, { name: 'fixture' }), null, 'npm used the package name, which is stable')
})

test('committed packages are restored only when the fixture had any', () => {
  assert.match(buildEnvScript(new Map(), true), /\ntar -xf \.nextship-e2e\/vendored\.tar -C node_modules\n$/)
  assert.doesNotMatch(buildEnvScript(new Map(), false), /tar /)
})

test('every value survives the shell exactly', { skip: process.platform === 'win32' && 'needs a POSIX shell' }, () => {
  const tricky = `it's $HOME "quoted" \`id\` \\ back\nsecond line`
  const script = buildEnvScript(new Map([['TRICKY', tricky]]), false)
  const result = spawnSync('sh', ['-c', `${script}printf '%s' "$TRICKY"`], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, tricky)
})
