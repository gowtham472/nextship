/**
 * Tests for the in-image prune script. It is exercised as a process, the way
 * the image build runs it, against a fixture shaped like a real `.next`.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PRUNE = fileURLToPath(new URL('../runtime/prune.cjs', import.meta.url))

async function fixture(layout: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'nextship-prune-'))
  for (const [relative, content] of Object.entries(layout)) {
    const file = path.join(root, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  return root
}

function prune(root: string, appDir: string, out: string) {
  return spawnSync(process.execPath, [PRUNE, root, appDir, out], { encoding: 'utf8' })
}

const exists = (file: string): Promise<boolean> => access(file).then(() => true, () => false)

const requiredServerFiles = JSON.stringify({
  version: 1,
  config: { deploymentId: 'dpl-test', images: {} },
  appDir: '/src',
  relativeAppDir: '',
  files: ['.next/routes-manifest.json', '.next/build-manifest.json'],
  ignore: [],
})

/**
 * A real `.next` minus the parts that only the framework understands, plus a
 * stand-in `next` package: the launcher's entry points are always traced, and
 * the tracer is loaded from inside `next`, so both must resolve.
 */
const compiledOutput = {
  'node_modules/next/package.json': JSON.stringify({ name: 'next', version: '16.3.4', main: 'index.js' }),
  'node_modules/next/index.js': 'module.exports = {}',
  'node_modules/next/dist/server/lib/start-server.js': 'module.exports = {}',
  'node_modules/next/dist/compiled/@vercel/nft/index.js':
    'exports.nodeFileTrace = async (entries, { base }) => ({ fileList: new Set(entries.map((e) => require("path").relative(base, e))), warnings: new Set() })',
  // Spawned as child processes by path, so no trace lists them. Next.js adds
  // them to standalone output explicitly and prune must do the same.
  'node_modules/next/dist/compiled/jest-worker/processChild.js': 'module.exports = {}',
  'node_modules/next/dist/compiled/jest-worker/threadChild.js': 'module.exports = {}',
  '.next/BUILD_ID': 'abc123',
  '.next/required-server-files.json': requiredServerFiles,
  '.next/routes-manifest.json': '{}',
  '.next/build-manifest.json': '{}',
  '.next/server/app/page.js': 'module.exports = {}',
  '.next/server/app/page.js.nft.json': JSON.stringify({ version: 1, files: ['../../../node_modules/dep/index.js', '../../../public/logo.svg'] }),
  '.next/next-server.js.nft.json': JSON.stringify({ version: 1, files: ['../node_modules/dep/package.json'] }),
  '.next/cache/images/stale.webp': 'x',
  '.next/types/app.d.ts': 'export {}',
  '.next/trace': '[]',
  'public/logo.svg': '<svg/>',
  'package.json': JSON.stringify({ name: 'demo' }),
}

/** Symlinks need a privilege on Windows that a developer machine may not have. */
async function canSymlink(): Promise<boolean> {
  const probe = await mkdtemp(path.join(tmpdir(), 'nextship-symlink-'))
  try {
    await mkdir(path.join(probe, 'target'))
    await symlink('target', path.join(probe, 'link'), 'dir')
    return true
  } catch {
    return false
  } finally {
    await rm(probe, { recursive: true, force: true })
  }
}

test('copies traced files, compiled output and public assets, and nothing else', async () => {
  const root = await fixture({
    ...compiledOutput,
    'node_modules/dep/index.js': 'module.exports = 1',
    'node_modules/dep/package.json': '{"name":"dep"}',
    'node_modules/dep/README.md': 'not traced',
    'node_modules/unused/index.js': 'not traced',
  })
  const out = path.join(root, 'out')
  try {
    const result = prune(root, '.', out)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /2 standalone extras/)
    assert.match(result.stdout, /server: launcher trace 2 files \+ next-server\.js\.nft\.json/)

    for (const kept of [
      '.next/BUILD_ID',
      '.next/routes-manifest.json',
      '.next/server/app/page.js',
      'node_modules/dep/index.js',
      'node_modules/dep/package.json',
      'node_modules/next/index.js',
      'node_modules/next/dist/server/lib/start-server.js',
      // Untraceable, and added because Next.js adds them to standalone output.
      'node_modules/next/dist/compiled/jest-worker/processChild.js',
      'node_modules/next/dist/compiled/jest-worker/threadChild.js',
      'public/logo.svg',
      'package.json',
      'server.cjs',
    ]) {
      assert.ok(await exists(path.join(out, kept)), `${kept} should be in the output`)
    }

    for (const dropped of [
      '.next/server/app/page.js.nft.json',
      '.next/cache',
      '.next/types',
      '.next/trace',
      'node_modules/dep/README.md',
      'node_modules/unused',
    ]) {
      assert.equal(await exists(path.join(out, dropped)), false, `${dropped} should not be in the output`)
    }

    const launcher = await readFile(path.join(out, 'server.cjs'), 'utf8')
    assert.match(launcher, /__NEXT_PRIVATE_STANDALONE_CONFIG/)
    assert.match(launcher, /"deploymentId":"dpl-test"/, 'the resolved config is inlined')
    assert.match(launcher, /startServer\(\{/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reproduces symlinks instead of copying through them', { skip: !(await canSymlink()) && 'symlinks are not permitted here' }, async () => {
  const root = await fixture({
    ...compiledOutput,
    'node_modules/.pnpm/dep@1.0.0/node_modules/dep/index.js': 'module.exports = 1',
    'node_modules/.pnpm/dep@1.0.0/node_modules/dep/package.json': '{"name":"dep"}',
    'node_modules/.pnpm/dep@1.0.0/node_modules/dep/README.md': 'not traced',
  })
  await symlink(path.join('.pnpm', 'dep@1.0.0', 'node_modules', 'dep'), path.join(root, 'node_modules', 'dep'), 'dir')
  const out = path.join(root, 'out')
  try {
    const result = prune(root, '.', out)
    assert.equal(result.status, 0, result.stderr)

    assert.ok((await lstat(path.join(out, 'node_modules', 'dep'))).isSymbolicLink(), 'the link is a link')
    assert.ok(await exists(path.join(out, 'node_modules/.pnpm/dep@1.0.0/node_modules/dep/index.js')), 'the real file is at its real path')
    assert.equal(await exists(path.join(out, 'node_modules/.pnpm/dep@1.0.0/node_modules/dep/README.md')), false, 'the rest of the package is not dragged in')
    assert.equal(await readFile(path.join(out, 'node_modules', 'dep', 'index.js'), 'utf8'), 'module.exports = 1', 'resolution through the link works')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('still assembles a server when Next.js wrote no server trace', async () => {
  const root = await fixture({
    ...compiledOutput,
    'node_modules/dep/index.js': '',
    'node_modules/dep/package.json': '{}',
  })
  await rm(path.join(root, '.next', 'next-server.js.nft.json'))
  const out = path.join(root, 'out')
  try {
    const result = prune(root, '.', out)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /server: launcher trace 2 files \(Next\.js wrote no server trace\)/)
    assert.ok(await exists(path.join(out, 'node_modules/next/dist/server/lib/start-server.js')))
    assert.ok(await exists(path.join(out, 'node_modules/next/index.js')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Loaded through a path Next.js computes at runtime, so no trace reaches them, and
// Next.js writes no server trace to list them while an adapter is configured.
test('traces the route module contexts Next.js loads by a computed path', async () => {
  const pages = 'node_modules/next/dist/server/route-modules/pages'
  const appPage = 'node_modules/next/dist/server/route-modules/app-page'
  const root = await fixture({
    ...compiledOutput,
    'node_modules/dep/index.js': '',
    'node_modules/dep/package.json': '{}',
    [`${pages}/module.compiled.js`]: 'module.exports = {}',
    [`${pages}/vendored/contexts/html-context.js`]: 'module.exports = {}',
    [`${pages}/vendored/contexts/html-context.d.ts`]: 'export {}',
    [`${appPage}/module.compiled.js`]: 'module.exports = {}',
    [`${appPage}/vendored/contexts/app-router-context.js`]: 'module.exports = {}',
  })
  const out = path.join(root, 'out')
  try {
    const result = prune(root, '.', out)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /server: launcher trace 6 files/)

    for (const kept of [
      `${pages}/module.compiled.js`,
      `${pages}/vendored/contexts/html-context.js`,
      `${appPage}/module.compiled.js`,
      `${appPage}/vendored/contexts/app-router-context.js`,
    ]) {
      assert.ok(await exists(path.join(out, kept)), `${kept} should be in the output`)
    }
    assert.equal(await exists(path.join(out, `${pages}/vendored/contexts/html-context.d.ts`)), false, 'declarations are not modules')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// A route handler's request.url carries the listen address, so behind a proxy a
// redirect built from it sent visitors to https://0.0.0.0:3000.
test('the launcher makes redirects to its own listen address relative, and nothing else', async () => {
  const root = await fixture({
    ...compiledOutput,
    'node_modules/dep/index.js': '',
    'node_modules/dep/package.json': '{}',
    // Sets each Location on a real ServerResponse and reports what it holds.
    'node_modules/next/dist/server/lib/start-server.js': `
      const { IncomingMessage, ServerResponse } = require('node:http')
      const { Socket } = require('node:net')
      exports.startServer = async () => {
        const seen = {}
        for (const location of JSON.parse(process.env.LOCATIONS)) {
          const res = new ServerResponse(new IncomingMessage(new Socket()))
          res.setHeader('Location', location)
          seen[location] = res.getHeader('location')
        }
        const appended = new ServerResponse(new IncomingMessage(new Socket()))
        appended.setHeader('location', ['https://0.0.0.0:3000/a'])
        appended.appendHeader('content-location', 'https://0.0.0.0:3000/b')
        seen.array = appended.getHeader('location')
        seen.other = appended.getHeader('content-location')
        process.stdout.write(JSON.stringify(seen))
      }`,
  })
  const out = path.join(root, 'out')
  try {
    assert.equal(prune(root, '.', out).status, 0)
    const locations = [
      'https://0.0.0.0:3000/login?next=%2Fcart#top',
      'http://0.0.0.0:3000',
      'https://0.0.0.0:3000?page=2',
      'https://0.0.0.0:30001/elsewhere',
      'https://shop.example.com/login',
      '/already-relative',
    ]
    const start = (env: Record<string, string>) => {
      const result = spawnSync(process.execPath, [path.join(out, 'server.cjs')], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', PORT: '3000', LOCATIONS: JSON.stringify(locations), ...env },
      })
      assert.equal(result.status, 0, result.stderr)
      return JSON.parse(result.stdout)
    }

    assert.deepEqual(start({}), {
      'https://0.0.0.0:3000/login?next=%2Fcart#top': '/login?next=%2Fcart#top',
      'http://0.0.0.0:3000': '/',
      'https://0.0.0.0:3000?page=2': '/?page=2',
      'https://0.0.0.0:30001/elsewhere': 'https://0.0.0.0:30001/elsewhere',
      'https://shop.example.com/login': 'https://shop.example.com/login',
      '/already-relative': '/already-relative',
      array: ['/a'],
      other: 'https://0.0.0.0:3000/b',
    })

    // Bound to a reachable name, the server's redirects are left as Next.js made them.
    const named = start({ HOSTNAME: 'localhost' })
    assert.equal(named['https://0.0.0.0:3000/login?next=%2Fcart#top'], 'https://0.0.0.0:3000/login?next=%2Fcart#top')
    assert.deepEqual(named.array, ['https://0.0.0.0:3000/a'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fails clearly when the tracer inside next cannot be loaded', async () => {
  const { 'node_modules/next/dist/compiled/@vercel/nft/index.js': _tracer, ...withoutTracer } = compiledOutput
  const root = await fixture({
    ...withoutTracer,
    'node_modules/dep/index.js': '',
    'node_modules/dep/package.json': '{}',
  })
  try {
    const result = prune(root, '.', path.join(root, 'out'))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node-file-trace could not be loaded/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fails clearly when the build did not complete', async () => {
  const noDist = await fixture({ 'package.json': '{}' })
  const noRoutes = await fixture({
    '.next/required-server-files.json': requiredServerFiles,
    '.next/routes-manifest.json': '{}',
    '.next/build-manifest.json': '{}',
    'package.json': '{}',
  })
  try {
    const a = prune(noDist, '.', path.join(noDist, 'out'))
    assert.equal(a.status, 1)
    assert.match(a.stderr, /\.next is missing/)

    const b = prune(noRoutes, '.', path.join(noRoutes, 'out'))
    assert.equal(b.status, 1)
    assert.match(b.stderr, /No route trace files/)
  } finally {
    await rm(noDist, { recursive: true, force: true })
    await rm(noRoutes, { recursive: true, force: true })
  }
})

test('refuses a trace that reaches outside the build root', async () => {
  const root = await fixture({
    ...compiledOutput,
    'node_modules/dep/index.js': '',
    'node_modules/dep/package.json': '{}',
  })
  await writeFile(
    path.join(root, '.next/server/app/page.js.nft.json'),
    JSON.stringify({ version: 1, files: ['../../../../outside.js'] })
  )
  try {
    const result = prune(root, '.', path.join(root, 'out'))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /outside the build root/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
