#!/usr/bin/env node
'use strict'
/**
 * nextship runtime asset: assemble the minimal runtime tree.
 *
 * Runs inside the image build, after `next build`, on the platform the image
 * will run on. It reads the trace files Next.js writes for every route and for
 * the server itself, and copies exactly those files, plus the compiled output
 * and public assets, into a clean tree. The result is what `output: 'standalone'`
 * would have produced, built from the same trace data, without the standalone
 * mode that the Adapter API cannot be combined with.
 *
 * Usage: node prune.cjs <root> <appDir> <out>
 *   root    the build context root (workspace root for a monorepo)
 *   appDir  the app directory, relative to root ('.' when they are the same)
 *   out     destination directory, created if missing
 *
 * Author: Gowtham
 * Design: docs/design.md §7
 */

const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const [rootArg, appDirArg, outArg] = process.argv.slice(2)
if (!rootArg || !appDirArg || !outArg) {
  fail('usage: prune.cjs <root> <appDir> <out>')
}

const root = path.resolve(rootArg)
const appDir = path.resolve(root, appDirArg)
const out = path.resolve(outArg)
const distDir = path.join(appDir, '.next')
const appRequire = createRequire(path.join(appDir, 'package.json'))

/** Parts of .next that only matter to the build or to development. */
const DIST_SKIP_DIRS = new Set(['cache', 'diagnostics', 'trace', 'trace-build', 'types', 'standalone'])

/**
 * Files Next.js adds to standalone output that no trace can discover.
 *
 * From `next/dist/build/collect-build-traces.js`, these two are appended only
 * when `isStandalone` is set. They are spawned as child processes by path rather
 * than imported, so node-file-trace cannot follow them and neither the route
 * traces nor the launcher trace contain them. Shipping them mirrors what Next.js
 * itself considers a complete server, and they are a few kilobytes.
 */
const STANDALONE_EXTRAS = [
  'next/dist/compiled/jest-worker/processChild',
  'next/dist/compiled/jest-worker/threadChild',
]

/**
 * Never copied into the runtime image, whatever asks for them.
 *
 * The trace ignores below apply only while tracing. Anything arriving another
 * way, and in particular a trace entry that resolves to a directory, is copied
 * wholesale, so the same files came back in through a different door. Measured
 * on a real build: `next/dist/compiled/next-server` alone was 58 MB of the
 * 87 MB of `next/dist`, almost all of it source maps and development runtimes.
 *
 * Source maps are excluded only under `node_modules`. A dependency's maps are
 * never read at runtime, but the application's own maps under `.next` are worth
 * keeping for anyone who turns on source map support to read a stack trace.
 *
 * Development runtime variants cannot be reached: the image sets
 * `NODE_ENV=production`, which is what selects the production ones.
 */
function neverCopy(relative) {
  const posix = relative.split(path.sep).join('/')
  if (!posix.includes('node_modules/')) return false
  return posix.endsWith('.map') || posix.endsWith('.dev.js')
}

/**
 * Applied when tracing the launcher's entry points. Mirrors the ignores Next.js
 * applies to its own server trace, so the two produce comparable trees.
 */
const LAUNCHER_TRACE_IGNORES = [
  '**/*.d.ts',
  '**/*.map',
  '**/next/dist/pages/**/*',
  '**/next/dist/compiled/next-server/**/*.dev.js',
  '**/next/dist/compiled/webpack/*',
  '**/node_modules/webpack5/**/*',
  '**/next/dist/server/lib/route-resolver*',
  '**/node_modules/react{,-dom,-dom-server-turbopack}/**/*.development.js',
]

async function main() {
  assertDirectory(distDir, '.next is missing. Run `next build` before pruning.')

  const requiredServerFiles = readJson(path.join(distDir, 'required-server-files.json'))
  if (!requiredServerFiles || !Array.isArray(requiredServerFiles.files) || !requiredServerFiles.config) {
    fail('.next/required-server-files.json is missing or malformed. This build did not complete.')
  }

  const copier = new Copier(root, out)

  // 1. Compiled output. Everything except build-only and development artefacts.
  copier.copyTree(distDir, (relative, entry) => {
    const top = relative.split(path.sep)[0]
    if (DIST_SKIP_DIRS.has(top)) return false
    if (entry.isFile() && relative.endsWith('.nft.json')) return false
    return true
  })

  // 2. Files Next.js declares the server needs, relative to the app directory.
  for (const file of requiredServerFiles.files) {
    copier.copyEntry(path.join(appDir, file))
  }

  // 3. Per-route dependency traces.
  let routeTraces = 0
  for (const traceFile of walk(path.join(distDir, 'server'), (name) => name.endsWith('.nft.json'))) {
    copier.copyTraceList(traceFile)
    routeTraces += 1
  }
  if (routeTraces === 0) {
    fail('No route trace files were found under .next/server. This build did not complete.')
  }

  // 4. The server's own dependencies.
  //
  // Next.js writes next-server.js.nft.json for a build like this one with a
  // narrower scope than standalone mode gets: the `next` entry module and
  // `bin/next` are deliberately left out (its TRACE_IGNORES), and the extras
  // start-server needs are only added when standalone is on. Verified on
  // 16.2.9: relying on that file alone boots to "Cannot find module
  // next/dist/server/next.js". So the launcher's own entry points are always
  // traced here, with the same ignores Next.js applies, and unioned with the
  // Next.js file when it exists. On 16.3.4 that file is not written at all
  // while an adapter is configured.
  const serverTrace = path.join(distDir, 'next-server.js.nft.json')
  const hasServerTrace = fs.existsSync(serverTrace)
  if (hasServerTrace) copier.copyTraceList(serverTrace)
  const launcherFiles = await copier.traceLauncher()
  const serverStrategy = hasServerTrace
    ? `launcher trace ${launcherFiles} files + next-server.js.nft.json`
    : `launcher trace ${launcherFiles} files (Next.js wrote no server trace)`

  // 5. What standalone adds beyond any trace.
  const extras = copier.copyResolved(STANDALONE_EXTRAS)

  // 6. Public assets and the app manifest.
  const publicDir = path.join(appDir, 'public')
  if (fs.existsSync(publicDir)) copier.copyTree(publicDir, () => true)
  copier.copyEntry(path.join(appDir, 'package.json'))

  // 7. The launcher, mirroring the server.js that standalone mode generates.
  const launcher = path.join(out, path.relative(root, appDir), 'server.cjs')
  fs.mkdirSync(path.dirname(launcher), { recursive: true })
  fs.writeFileSync(launcher, renderLauncher(requiredServerFiles.config), 'utf8')

  process.stdout.write(
    `nextship prune: ${copier.count} files, ${routeTraces} route traces, ` +
      `${extras} standalone extras, server: ${serverStrategy}\n`
  )
}

/** Copies files from `root` into `out` at the same relative path, keeping symlinks as symlinks. */
class Copier {
  constructor(root, out) {
    this.root = root
    this.out = out
    this.done = new Set()
    this.count = 0
  }

  /**
   * Copies one path.
   *
   * Symlinks are reproduced as symlinks and nothing more. A pnpm layout lists
   * `node_modules/next` (a link into `.pnpm`) and, separately, every file under
   * the real location that is actually needed. Copying the link's whole target
   * would pull the entire package back in, which is exactly the bloat the trace
   * exists to avoid. A path that passes through a link is copied at its real
   * location instead, so nothing is ever written through a link.
   */
  copyEntry(absolute) {
    const relative = path.relative(this.root, absolute)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      fail(`Trace references ${absolute}, which is outside the build root ${this.root}.`)
    }
    if (this.done.has(relative)) return
    if (neverCopy(relative)) return
    this.done.add(relative)

    if (this.mirrorAncestorLinks(relative)) {
      this.copyEntry(fs.realpathSync(absolute))
      return
    }

    let stat
    try {
      stat = fs.lstatSync(absolute)
    } catch {
      fail(`Trace references ${absolute}, which does not exist.`)
    }

    const destination = path.join(this.out, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })

    if (stat.isSymbolicLink()) {
      this.link(absolute, destination)
      // A link to a file is only useful with the file; a link to a directory is
      // completed by the directory's own traced entries.
      const target = fs.realpathSync(absolute)
      if (!fs.statSync(target).isDirectory()) this.copyEntry(target)
      return
    }

    if (stat.isDirectory()) {
      this.copyTree(absolute, () => true)
      return
    }

    fs.copyFileSync(absolute, destination)
    fs.chmodSync(destination, stat.mode)
    this.count += 1
  }

  /** Copies a directory recursively, consulting `keep(relative, entry)` for each entry. */
  copyTree(directory, keep) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isFile() && neverCopy(path.relative(this.root, absolute))) continue
      if (!keep(path.relative(directory, absolute), entry)) continue
      if (entry.isDirectory()) {
        this.copyTree(absolute, (relative, child) => keep(path.join(entry.name, relative), child))
      } else {
        this.copyEntry(absolute)
      }
    }
  }

  /**
   * Copies modules named by specifier rather than by path. Returns how many were
   * found. A specifier that does not resolve is skipped rather than fatal,
   * because these are additions Next.js makes for its own reasons and their
   * location has changed between versions.
   */
  copyResolved(specifiers) {
    let copied = 0
    for (const specifier of specifiers) {
      let resolved
      try {
        resolved = appRequire.resolve(specifier)
      } catch {
        continue
      }
      this.copyEntry(resolved)
      copied += 1
    }
    return copied
  }

  /** Copies every file listed in a Next.js `.nft.json`, whose entries are relative to the file. */
  copyTraceList(traceFile) {
    const trace = readJson(traceFile)
    if (!trace || !Array.isArray(trace.files)) fail(`${traceFile} is not a valid trace file.`)
    const base = path.dirname(traceFile)
    for (const file of trace.files) {
      this.copyEntry(path.resolve(base, file))
    }
  }

  /**
   * Traces what the launcher requires, using the node-file-trace that Next.js
   * bundles and uses for its own traces, so no extra dependency is needed.
   * Returns how many files the trace listed.
   */
  async traceLauncher() {
    let nodeFileTrace
    try {
      ;({ nodeFileTrace } = appRequire('next/dist/compiled/@vercel/nft'))
    } catch {
      fail("Next.js's bundled node-file-trace could not be loaded from next/dist/compiled/@vercel/nft.")
    }

    const entries = [appRequire.resolve('next'), appRequire.resolve('next/dist/server/lib/start-server')]
    const result = await nodeFileTrace(entries, { base: this.root, ignore: LAUNCHER_TRACE_IGNORES })
    for (const file of result.fileList) {
      this.copyEntry(path.join(this.root, file))
    }
    return result.fileList.size
  }

  /** Recreates any symlinked ancestor of `relative`. Returns whether one was met. */
  mirrorAncestorLinks(relative) {
    const parts = relative.split(path.sep)
    let crossedLink = false
    for (let depth = 1; depth < parts.length; depth += 1) {
      const ancestor = parts.slice(0, depth).join(path.sep)
      const absolute = path.join(this.root, ancestor)
      let stat
      try {
        stat = fs.lstatSync(absolute)
      } catch {
        return crossedLink
      }
      if (!stat.isSymbolicLink()) continue
      crossedLink = true
      if (this.done.has(ancestor)) continue
      this.done.add(ancestor)
      const destination = path.join(this.out, ancestor)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      this.link(absolute, destination)
    }
    return crossedLink
  }

  link(absolute, destination) {
    const target = fs.readlinkSync(absolute)
    try {
      fs.symlinkSync(target, destination)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
}

/**
 * The same launcher Next.js writes for standalone output, with the resolved
 * config inlined so the server never has to load next.config at boot. That is
 * what keeps the SWC compiler out of the runtime image: without it, a TypeScript
 * config would be compiled on every start.
 */
function renderLauncher(nextConfig) {
  return `'use strict'
// Generated by nextship. Mirrors the server.js that Next.js standalone output produces.
const path = require('node:path')

const dir = path.join(__dirname)

process.env.NODE_ENV = 'production'
process.chdir(__dirname)

const currentPort = parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOSTNAME || '0.0.0.0'

let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
const nextConfig = ${JSON.stringify(nextConfig)}

process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)

require('next')
const { startServer } = require('next/dist/server/lib/start-server')

if (
  Number.isNaN(keepAliveTimeout) ||
  !Number.isFinite(keepAliveTimeout) ||
  keepAliveTimeout < 0
) {
  keepAliveTimeout = undefined
}

startServer({
  dir,
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
  keepAliveTimeout,
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
`
}

function* walk(directory, match) {
  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(absolute, match)
    else if (entry.isFile() && match(entry.name)) yield absolute
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function assertDirectory(directory, message) {
  let stat
  try {
    stat = fs.statSync(directory)
  } catch {
    fail(message)
  }
  if (!stat.isDirectory()) fail(message)
}

function fail(message) {
  process.stderr.write(`nextship prune: ${message}\n`)
  process.exit(1)
}

// Invoked last: class declarations are not hoisted, so `Copier` must be
// defined before main() can construct it.
main().catch((error) => fail(error && error.stack ? error.stack : String(error)))
