/**
 * Tests for project detection. Each case builds a throwaway project layout on
 * disk, because detection is defined entirely by what is on disk.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectProject, localDependencyPaths } from './detect.js'
import { NextshipError } from './errors.js'

type Layout = Record<string, string>

const nextPackage = (version: string): string => JSON.stringify({ name: 'next', version })

const app = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: 'demo', scripts: { build: 'next build' }, dependencies: { next: '16.3.0' }, ...extra })

async function fixture(layout: Layout): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'nextship-detect-'))
  for (const [relative, content] of Object.entries(layout)) {
    const file = path.join(root, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  return root
}

async function rejectsWith(promise: Promise<unknown>, fragment: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof NextshipError, 'expected a NextshipError')
    assert.match(error.message, new RegExp(fragment))
    assert.ok(error.action.length > 0, 'every error carries a next action')
    return true
  })
}

test('standalone npm project', async () => {
  const root = await fixture({
    'package.json': app(),
    'package-lock.json': '{}',
    'node_modules/next/package.json': nextPackage('16.3.4'),
    'node_modules/sharp/package.json': JSON.stringify({ name: 'sharp', version: '0.34.5' }),
  })
  try {
    const project = await detectProject(root)
    assert.equal(project.root, root)
    assert.equal(project.contextRoot, root)
    assert.equal(project.appDir, '.')
    assert.equal(project.name, 'demo')
    assert.equal(project.nextVersion, '16.3.4')
    assert.equal(project.packageManager, 'npm')
    assert.equal(project.lockfile, 'package-lock.json')
    assert.deepEqual(project.buildCommand, ['npm', 'run', 'build'])
    assert.equal(project.sharpVersion, '0.34.5')
    assert.deepEqual(project.envFiles, [])
    assert.equal(project.userDockerignore, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('detection walks up from a subdirectory of the app', async () => {
  const root = await fixture({
    'package.json': app(),
    'node_modules/next/package.json': nextPackage('16.2.0'),
    'app/components/.keep': '',
  })
  try {
    const project = await detectProject(path.join(root, 'app', 'components'))
    assert.equal(project.root, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects Next.js older than the Adapter API', async () => {
  const root = await fixture({
    'package.json': app(),
    'node_modules/next/package.json': nextPackage('16.1.9'),
  })
  try {
    await rejectsWith(detectProject(root), '16\\.2 or newer')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a project with no Next.js dependency', async () => {
  const root = await fixture({ 'package.json': JSON.stringify({ name: 'not-next' }) })
  try {
    await rejectsWith(detectProject(root), 'No Next.js project found')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a project whose dependencies are not installed', async () => {
  const root = await fixture({ 'package.json': app() })
  try {
    await rejectsWith(detectProject(root), 'not installed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pnpm workspace package with hoisted next', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'mono', private: true }),
    'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
    'pnpm-lock.yaml': '',
    '.dockerignore': 'coverage\n',
    'node_modules/next/package.json': nextPackage('16.3.1'),
    'apps/web/package.json': app({ name: '@acme/Web App' }),
    'apps/web/.env.production': 'A=1',
  })
  try {
    const project = await detectProject(path.join(root, 'apps', 'web'))
    assert.equal(project.contextRoot, root)
    assert.equal(project.appDir, 'apps/web')
    assert.equal(project.packageManager, 'pnpm')
    assert.equal(project.lockfile, 'pnpm-lock.yaml')
    assert.equal(project.nextVersion, '16.3.1', 'found at the workspace root')
    assert.equal(project.name, 'acme-web-app', 'image names are lowercase with safe separators')
    assert.deepEqual(project.buildCommand, ['pnpm', 'run', 'build'])
    assert.deepEqual(project.envFiles, ['.env.production'])
    assert.equal(project.userDockerignore, 'coverage\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('node major honours engines, then .nvmrc, then the running node', async () => {
  const withEngines = await fixture({
    'package.json': app({ engines: { node: '>=20.9' } }),
    '.nvmrc': '22',
    'node_modules/next/package.json': nextPackage('16.2.0'),
  })
  const withNvmrc = await fixture({
    'package.json': app(),
    '.nvmrc': 'v22.1.0\n',
    'node_modules/next/package.json': nextPackage('16.2.0'),
  })
  const bare = await fixture({
    'package.json': app(),
    'node_modules/next/package.json': nextPackage('16.2.0'),
  })
  try {
    assert.equal((await detectProject(withEngines)).nodeMajor, '20')
    assert.equal((await detectProject(withNvmrc)).nodeMajor, '22')
    assert.equal((await detectProject(bare)).nodeMajor, process.versions.node.split('.')[0])
  } finally {
    for (const root of [withEngines, withNvmrc, bare]) await rm(root, { recursive: true, force: true })
  }
})

test('falls back to invoking next directly when there is no build script', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'demo', dependencies: { next: '16.3.0' } }),
    'bun.lockb': '',
    'node_modules/next/package.json': nextPackage('16.3.0'),
  })
  try {
    const project = await detectProject(root)
    assert.equal(project.packageManager, 'bun')
    assert.deepEqual(project.buildCommand, ['bun', 'x', 'next', 'build'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/**
 * pnpm store lookup.
 *
 * Found by verification, not by a failing build: `detect` reported sharp as
 * "not resolvable from the app root" for a project whose image was proven to
 * contain sharp 0.34.5 with its Linux binary. pnpm links only direct
 * dependencies at the top of node_modules, so a transitive package is visible
 * only inside the store.
 */
test('a transitive dependency installed by pnpm is reported, not called missing', async () => {
  const root = await fixture({
    'package.json': app(),
    'pnpm-lock.yaml': '',
    'node_modules/next/package.json': nextPackage('16.3.0'),
    'node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/package.json': JSON.stringify({
      name: 'sharp',
      version: '0.34.5',
    }),
  })

  const project = await detectProject(root)
  assert.equal(project.sharpVersion, '0.34.5')
})

test('a directly linked dependency still wins over the store', async () => {
  const root = await fixture({
    'package.json': app(),
    'pnpm-lock.yaml': '',
    'node_modules/next/package.json': nextPackage('16.3.0'),
    'node_modules/sharp/package.json': JSON.stringify({ name: 'sharp', version: '0.34.9' }),
    'node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/package.json': JSON.stringify({
      name: 'sharp',
      version: '0.34.5',
    }),
  })

  const project = await detectProject(root)
  assert.equal(project.sharpVersion, '0.34.9', 'the linked copy is the one Node would load')
})

test('a package that really is absent is still reported as absent', async () => {
  const root = await fixture({
    'package.json': app(),
    'pnpm-lock.yaml': '',
    'node_modules/next/package.json': nextPackage('16.3.0'),
    'node_modules/.pnpm/other@1.0.0/node_modules/other/package.json': JSON.stringify({
      name: 'other',
      version: '1.0.0',
    }),
  })

  const project = await detectProject(root)
  assert.equal(project.sharpVersion, null, 'an unrelated store entry is not mistaken for a match')
})

/**
 * Local file: dependencies.
 *
 * Found by the Next.js compatibility suite, which rewrites every dependency to
 * `file:./next-test-packages/...` and hands the deploy script a project that has
 * not been installed. The generated Dockerfile copies manifests, installs, then
 * copies sources, so a dependency living in the sources is absent exactly when
 * the install needs it.
 */
test('a file: dependency inside the project is reported so it can be copied early', () => {
  const pkg = {
    dependencies: { next: 'file:./next-test-packages/next/packed.tgz' },
    devDependencies: { helper: 'file:vendor/helper' },
  }

  assert.deepEqual(localDependencyPaths(pkg, '/app', '/app'), [
    'next-test-packages/next/packed.tgz',
    'vendor/helper',
  ])
})

test('registry ranges are not mistaken for local paths', () => {
  const pkg = { dependencies: { next: '^16.2.0', react: 'workspace:*', other: 'npm:thing@1' } }
  assert.deepEqual(localDependencyPaths(pkg, '/app', '/app'), [])
})

test('a path that climbs but stays inside the context is allowed', () => {
  const pkg = { dependencies: { helper: 'file:../../vendor/helper' } }
  assert.deepEqual(localDependencyPaths(pkg, '/repo/apps/web', '/repo'), ['vendor/helper'])
})

test('a package inside a workspace reports paths relative to the build context', () => {
  // The context is the workspace root, because that is what Docker is given.
  const pkg = { dependencies: { helper: 'file:./vendor/helper' } }
  assert.deepEqual(localDependencyPaths(pkg, '/repo/apps/web', '/repo'), ['apps/web/vendor/helper'])
})

test('a file: path outside the build context is refused rather than silently broken', () => {
  // Three levels, not two: from apps/web, `../../` only reaches the context root.
  const pkg = { dependencies: { helper: 'file:../../../outside' } }

  assert.throws(
    () => localDependencyPaths(pkg, '/repo/apps/web', '/repo'),
    (error: unknown) => {
      assert.ok(error instanceof NextshipError)
      assert.match(error.message, /outside the build context/)
      assert.match(error.action, /Docker cannot read outside/)
      return true
    },
    'Docker cannot see outside the context, so this must fail by name rather than as a missing tarball'
  )
})

test('a manifest with no dependency section at all is handled', () => {
  assert.deepEqual(localDependencyPaths({}, '/app', '/app'), [])
  assert.deepEqual(localDependencyPaths({ dependencies: null }, '/app', '/app'), [])
})


// A workspace declaration is only a root for the projects its patterns include.
// An npm project kept outside a pnpm workspace was detected as a member and would
// have been built from the monorepo root with the monorepo's lockfile.
test('a project the ancestor workspace does not include is standalone', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'mono', private: true }),
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    'pnpm-lock.yaml': '',
    'site/package.json': app({ name: 'site' }),
    'site/package-lock.json': '{}',
    'site/node_modules/next/package.json': nextPackage('16.3.4'),
  })
  try {
    const project = await detectProject(path.join(root, 'site'))
    assert.equal(project.contextRoot, path.join(root, 'site'))
    assert.equal(project.appDir, '.')
    assert.equal(project.packageManager, 'npm')
    assert.equal(project.lockfile, 'package-lock.json')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a negated workspace pattern excludes the project, and comments are ignored', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'mono', private: true }),
    'pnpm-workspace.yaml': "packages:\n  - 'apps/*' # every app\n  - '!apps/legacy'\n",
    'pnpm-lock.yaml': '',
    'apps/legacy/package.json': app({ name: 'legacy' }),
    'apps/legacy/package-lock.json': '{}',
    'apps/legacy/node_modules/next/package.json': nextPackage('16.3.4'),
  })
  try {
    const project = await detectProject(path.join(root, 'apps', 'legacy'))
    assert.equal(project.contextRoot, path.join(root, 'apps', 'legacy'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a globstar pattern in flow style includes a nested project', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'mono', private: true }),
    'pnpm-workspace.yaml': "packages: ['apps/**']\n",
    'pnpm-lock.yaml': '',
    'node_modules/next/package.json': nextPackage('16.3.4'),
    'apps/group/web/package.json': app({ name: 'web' }),
  })
  try {
    const project = await detectProject(path.join(root, 'apps', 'group', 'web'))
    assert.equal(project.contextRoot, root)
    assert.equal(project.appDir, 'apps/group/web')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a pnpm-workspace.yaml holding only settings includes no nested project', async () => {
  // A list under another key must not be mistaken for the packages list.
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'mono', private: true }),
    'pnpm-workspace.yaml': 'onlyBuiltDependencies:\n  - sharp\n',
    'pnpm-lock.yaml': '',
    'web/package.json': app({ name: 'web' }),
    'web/package-lock.json': '{}',
    'web/node_modules/next/package.json': nextPackage('16.3.4'),
  })
  try {
    const project = await detectProject(path.join(root, 'web'))
    assert.equal(project.contextRoot, path.join(root, 'web'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the yarn classic workspaces object form is read', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'mono', private: true, workspaces: { packages: ['apps/*'], nohoist: [] } }),
    'yarn.lock': '',
    'node_modules/next/package.json': nextPackage('16.3.4'),
    'apps/web/package.json': app({ name: 'web' }),
  })
  try {
    const project = await detectProject(path.join(root, 'apps', 'web'))
    assert.equal(project.contextRoot, root)
    assert.equal(project.appDir, 'apps/web')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
