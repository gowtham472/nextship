/**
 * @nextship/cli: packages present in node_modules that nothing declares
 *
 * nextship installs dependencies inside the image from the lockfile and never
 * ships the host's `node_modules`, because those binaries are built for the
 * machine you develop on rather than the one the app runs on.
 *
 * The consequence is that a package sitting in `node_modules` without being
 * declared anywhere reaches the build on your machine and not in the image.
 * Next.js then fails with `Module not found: Can't resolve 'x'`, which names
 * the symptom and nothing about the cause.
 *
 * Reachability is computed from the manifests themselves rather than by parsing
 * a lockfile, because the three package managers write three different formats
 * and all of them already agree about what a package depends on.
 *
 * Author: Gowtham
 * Design: ../../../docs/design.md §9
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

/** Groups that make a package part of the dependency graph. */
const DEPENDENCY_GROUPS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

/**
 * A ceiling on how many manifests are read.
 *
 * A large workspace has tens of thousands of packages, and `doctor` is a
 * diagnostic that must not take longer than the build it is advising about.
 * Reaching the cap means the answer is incomplete, which the caller is told
 * rather than left to infer.
 */
const MAX_MANIFESTS = 20_000

export interface VendoredResult {
  /** Directories in node_modules that no manifest in the graph refers to. */
  undeclared: string[]
  /** True when the walk stopped at the cap, so `undeclared` may overstate. */
  truncated: boolean
}

/**
 * Packages installed at the top level that nothing in the graph asks for.
 *
 * Returns an empty result when there is no `node_modules`, because a project
 * that has not been installed has nothing to be inconsistent about.
 */
export async function undeclaredPackages(root: string): Promise<VendoredResult> {
  const modulesDir = path.join(root, 'node_modules')

  const present = await listInstalled(modulesDir)
  if (present.length === 0) return { undeclared: [], truncated: false }

  const rootManifest = await readManifest(path.join(root, 'package.json'))
  if (!rootManifest) return { undeclared: [], truncated: false }

  const reachable = new Set<string>()
  const queue = dependencyNames(rootManifest)
  let read = 0

  while (queue.length > 0) {
    const name = queue.shift()
    if (name === undefined || reachable.has(name)) continue
    reachable.add(name)

    if (read >= MAX_MANIFESTS) return { undeclared: [], truncated: true }
    read += 1

    // A package that is declared but not installed contributes nothing further.
    // That is a separate problem, and one the package manager reports better.
    const manifest = await readManifest(path.join(modulesDir, name, 'package.json'))
    if (manifest) queue.push(...dependencyNames(manifest))
  }

  return {
    undeclared: present.filter((name) => !reachable.has(name)).sort(),
    truncated: false,
  }
}

/**
 * Top-level package directories, with scopes flattened to `@scope/name`.
 *
 * Entries beginning with a dot are package manager bookkeeping: `.bin`,
 * `.package-lock.json`, and pnpm's `.pnpm` store. None of them is importable.
 */
async function listInstalled(modulesDir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(modulesDir, { withFileTypes: true })
  } catch {
    return []
  }

  const names: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    // A symlink is how pnpm and workspaces express a dependency, so it counts
    // exactly as a directory does.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue

    if (!entry.name.startsWith('@')) {
      names.push(entry.name)
      continue
    }

    let scoped
    try {
      scoped = await readdir(path.join(modulesDir, entry.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const child of scoped) {
      if (child.isDirectory() || child.isSymbolicLink()) names.push(`${entry.name}/${child.name}`)
    }
  }

  return names
}

function dependencyNames(manifest: Record<string, unknown>): string[] {
  const names: string[] = []

  for (const group of DEPENDENCY_GROUPS) {
    const entries = manifest[group]
    if (typeof entries !== 'object' || entries === null) continue
    names.push(...Object.keys(entries as Record<string, unknown>))
  }

  return names
}

async function readManifest(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
