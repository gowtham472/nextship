/**
 * Tests for undeclared package detection. Each case builds a throwaway
 * node_modules on disk, because reachability is defined entirely by what the
 * manifests on disk say.
 *
 * The false positive is the failure mode that matters. Telling someone a
 * dependency is undeclared when it is reachable would send them editing
 * package.json to fix nothing, so transitive reachability, scopes, symlinks and
 * every dependency group are pinned individually.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { undeclaredPackages } from './vendored.js'

type Layout = Record<string, Record<string, unknown>>

/** Builds a project whose root manifest is `root` and whose node_modules is `installed`. */
async function fixture(root: Record<string, unknown>, installed: Layout): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nextship-vendored-'))
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(root))

  for (const [name, manifest] of Object.entries(installed)) {
    const packageDir = path.join(dir, 'node_modules', name)
    await mkdir(packageDir, { recursive: true })
    await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name, ...manifest }))
  }

  return dir
}

test('a package nothing declares is reported', async () => {
  const root = await fixture({ dependencies: { next: '16.3.0' } }, { next: {}, lib: {} })

  const { undeclared, truncated } = await undeclaredPackages(root)

  assert.deepEqual(undeclared, ['lib'])
  assert.equal(truncated, false)
})

test('a transitive dependency is reachable and is not reported', async () => {
  // The failure this pins: walking only the root manifest would call every
  // transitive package undeclared, which is every package in a real project.
  const root = await fixture(
    { dependencies: { next: '16.3.0' } },
    { next: { dependencies: { 'styled-jsx': '5.0.0' } }, 'styled-jsx': {} }
  )

  const { undeclared } = await undeclaredPackages(root)

  assert.deepEqual(undeclared, [])
})

test('reachability follows a chain rather than one level', async () => {
  const root = await fixture(
    { dependencies: { a: '1.0.0' } },
    { a: { dependencies: { b: '1.0.0' } }, b: { dependencies: { c: '1.0.0' } }, c: {} }
  )

  assert.deepEqual((await undeclaredPackages(root)).undeclared, [])
})

test('a dependency cycle terminates instead of looping forever', async () => {
  const root = await fixture(
    { dependencies: { a: '1.0.0' } },
    { a: { dependencies: { b: '1.0.0' } }, b: { dependencies: { a: '1.0.0' } } }
  )

  assert.deepEqual((await undeclaredPackages(root)).undeclared, [])
})

test('every dependency group counts as declaring a package', async () => {
  const root = await fixture(
    {
      dependencies: { a: '1.0.0' },
      devDependencies: { b: '1.0.0' },
      optionalDependencies: { c: '1.0.0' },
      peerDependencies: { d: '1.0.0' },
    },
    { a: {}, b: {}, c: {}, d: {} }
  )

  assert.deepEqual((await undeclaredPackages(root)).undeclared, [])
})

test('scoped packages are reported by their full name', async () => {
  const root = await fixture({ dependencies: {} }, { '@scope/thing': {} })

  assert.deepEqual((await undeclaredPackages(root)).undeclared, ['@scope/thing'])
})

test('a scoped package that is declared is not reported', async () => {
  const root = await fixture({ dependencies: { '@scope/thing': '1.0.0' } }, { '@scope/thing': {} })

  assert.deepEqual((await undeclaredPackages(root)).undeclared, [])
})

test('package manager bookkeeping directories are not packages', async () => {
  // .bin, .pnpm and .package-lock.json all live here and none is importable.
  // Reporting them would make the finding noise that users learn to ignore.
  const root = await fixture({ dependencies: {} }, {})
  await mkdir(path.join(root, 'node_modules', '.bin'), { recursive: true })
  await mkdir(path.join(root, 'node_modules', '.pnpm'), { recursive: true })

  assert.deepEqual((await undeclaredPackages(root)).undeclared, [])
})

test('a project with no node_modules has nothing to report', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nextship-vendored-'))
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '16.3.0' } }))

  const { undeclared, truncated } = await undeclaredPackages(dir)

  assert.deepEqual(undeclared, [])
  assert.equal(truncated, false)
})

test('a declared package that is not installed is not reported as undeclared', async () => {
  // It is missing, not extraneous. The package manager reports that better, and
  // claiming it is undeclared would be false.
  const root = await fixture({ dependencies: { missing: '1.0.0' } }, {})

  assert.deepEqual((await undeclaredPackages(root)).undeclared, [])
})

test('an unreadable manifest does not turn its dependencies into false positives', async () => {
  const root = await fixture({ dependencies: { a: '1.0.0' } }, { a: {} })
  // A package directory with no manifest at all, which a partial install leaves
  // behind. It is still installed, so it is still reported; what must not
  // happen is a crash.
  await mkdir(path.join(root, 'node_modules', 'broken'), { recursive: true })

  const { undeclared } = await undeclaredPackages(root)

  assert.deepEqual(undeclared, ['broken'])
})

test('a symlinked package counts as installed', async (t) => {
  // pnpm and workspaces express every dependency as a symlink, so treating only
  // real directories as installed would report nothing on a pnpm project.
  const root = await fixture({ dependencies: {} }, {})
  const real = path.join(root, 'vendored-source')
  await mkdir(real, { recursive: true })
  await writeFile(path.join(real, 'package.json'), JSON.stringify({ name: 'linked' }))

  try {
    await symlink(real, path.join(root, 'node_modules', 'linked'), 'junction')
  } catch {
    // Windows refuses symlinks without developer mode or elevation.
    t.skip('this platform does not permit creating symlinks')
    return
  }

  assert.deepEqual((await undeclaredPackages(root)).undeclared, ['linked'])
})

test('the report is sorted, so it reads the same on every run', async () => {
  const root = await fixture({ dependencies: {} }, { zeta: {}, alpha: {}, mid: {} })

  assert.deepEqual((await undeclaredPackages(root)).undeclared, ['alpha', 'mid', 'zeta'])
})
