/**
 * @nextship/cli: preflight diagnosis
 *
 * Reports what will behave differently once the app runs in a container instead
 * of on Vercel, and what nextship cannot do with this project.
 *
 * This exists because the migration path was the gap nothing else covered: an
 * app can build and serve perfectly while its analytics silently stop, its
 * cron jobs never run, and `VERCEL_URL` is undefined in a branch nobody tested.
 * None of that is a build error, so only a deliberate check finds it.
 *
 * Author: Gowtham
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectInfo } from './detect.js'
import { undeclaredPackages } from './vendored.js'

export type FindingLevel = 'blocker' | 'warning' | 'note'

export interface Finding {
  level: FindingLevel
  /** What was found, in the user's terms. */
  title: string
  /** What actually happens as a result. Never speculation. */
  consequence: string
  /** What to do about it. */
  action: string
}

/** Vercel packages that degrade silently rather than failing when they are off Vercel. */
const VERCEL_PACKAGES: Record<string, string> = {
  '@vercel/analytics': 'Page view and event tracking stops. Nothing errors and no data arrives.',
  '@vercel/speed-insights': 'Core Web Vitals reporting stops, with no error.',
  '@vercel/og': 'Open Graph image generation depends on Vercel infrastructure and may not work.',
  '@vercel/blob': 'Object storage calls fail at runtime unless the token still points at Vercel.',
  '@vercel/kv': 'Key value store calls fail at runtime unless the connection still points at Vercel.',
  '@vercel/postgres': 'Database calls fail at runtime unless the connection still points at Vercel.',
  '@vercel/edge-config': 'Configuration reads fail at runtime unless they still point at Vercel.',
  '@vercel/functions': 'Vercel runtime helpers such as geolocation return nothing useful.',
}

/**
 * Environment variables Vercel injects. Off Vercel they are undefined, so any
 * branch that reads them takes its other path without warning.
 */
const VERCEL_ENV_VARS = [
  'VERCEL',
  'VERCEL_URL',
  'VERCEL_ENV',
  'VERCEL_REGION',
  'VERCEL_BRANCH_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_DEPLOYMENT_ID',
  'VERCEL_GIT_COMMIT_SHA',
]

/** Directories that never contain application source worth scanning. */
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.nextship', 'dist', 'build', 'coverage'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
/** Enough to catch a real project without walking a monorepo forever. */
const MAX_SCANNED_FILES = 3000

export async function diagnose(project: ProjectInfo): Promise<Finding[]> {
  const findings: Finding[] = []
  // Detection already proved this file exists and parses, so an empty object
  // here would mean it changed underneath us; treating it as no dependencies is
  // the safe reading.
  const manifest = (await readJson(path.join(project.root, 'package.json'))) ?? {}

  findings.push(...dependencyFindings(manifest))
  findings.push(...(await vercelConfigFindings(project.root)))
  findings.push(...(await sourceFindings(project.root)))
  findings.push(...(await undeclaredPackageFindings(project.root)))
  findings.push(...runtimeFindings(project))

  const order: Record<FindingLevel, number> = { blocker: 0, warning: 1, note: 2 }
  return findings.sort((a, b) => order[a.level] - order[b.level])
}

/**
 * Packages that exist in node_modules but that nothing declares.
 *
 * These build on the developer's machine and are absent from the image, because
 * the image installs from the lockfile and never receives the host's
 * node_modules. Next.js reports that as `Module not found`, which names the
 * import and nothing about why it resolved locally.
 *
 * A blocker rather than a warning: unlike everything else here, this one fails
 * the build outright.
 */
async function undeclaredPackageFindings(root: string): Promise<Finding[]> {
  const { undeclared, truncated } = await undeclaredPackages(root)
  if (truncated || undeclared.length === 0) return []

  const named = undeclared.slice(0, 5).join(', ')
  const rest = undeclared.length > 5 ? `, and ${undeclared.length - 5} more` : ''

  return [
    {
      level: 'blocker',
      title: `${undeclared.length} package(s) in node_modules are not declared anywhere: ${named}${rest}`,
      consequence:
        'The image installs from your lockfile and never receives the host node_modules, so these are absent at build time. ' +
        'Anything importing them fails with "Module not found", naming the import rather than the cause.',
      action:
        'Add each one to package.json and reinstall, so the lockfile carries it. ' +
        'A package that cannot be published needs to be vendored inside the project and referenced with a file: path.',
    },
  ]
}

function dependencyFindings(manifest: Record<string, any>): Finding[] {
  const installed = { ...manifest.dependencies, ...manifest.devDependencies } as Record<string, string>

  return Object.keys(VERCEL_PACKAGES)
    .filter((name) => name in installed)
    .map((name) => ({
      level: 'warning' as const,
      title: `${name} is a dependency`,
      consequence: VERCEL_PACKAGES[name],
      action: `Remove it, or replace it with something that runs anywhere, before relying on what it reports.`,
    }))
}

async function vercelConfigFindings(root: string): Promise<Finding[]> {
  const config = await readJson(path.join(root, 'vercel.json'))
  if (!config) return []

  const findings: Finding[] = [
    {
      level: 'warning',
      title: 'vercel.json is present',
      consequence: 'Nothing reads it off Vercel. Every setting in it stops applying.',
      action: 'Move what you still need into next.config, and delete the rest.',
    },
  ]

  if (Array.isArray(config.crons) && config.crons.length > 0) {
    findings.push({
      level: 'blocker',
      title: `vercel.json defines ${config.crons.length} cron job(s)`,
      consequence: 'They will never run. Nothing schedules them off Vercel, and nothing reports that.',
      action: 'Schedule them with your platform, for example a DigitalOcean scheduled job that calls the route.',
    })
  }

  for (const key of ['rewrites', 'redirects', 'headers'] as const) {
    if (Array.isArray(config[key]) && config[key].length > 0) {
      findings.push({
        level: 'warning',
        title: `vercel.json defines ${key}`,
        consequence: `These ${key} stop applying. Only the equivalents in next.config are used.`,
        action: `Move them into next.config, which works on any host.`,
      })
    }
  }

  return findings
}

async function sourceFindings(root: string): Promise<Finding[]> {
  const findings: Finding[] = []
  const usedEnvVars = new Set<string>()
  let scanned = 0

  for await (const file of sourceFiles(root)) {
    if (scanned >= MAX_SCANNED_FILES) break
    scanned += 1

    const contents = await readFile(file, 'utf8').catch(() => '')
    for (const name of VERCEL_ENV_VARS) {
      // Matches both process.env.NAME and process.env['NAME'].
      if (contents.includes(`env.${name}`) || contents.includes(`env['${name}']`)) {
        usedEnvVars.add(name)
      }
    }
  }

  if (usedEnvVars.size > 0) {
    findings.push({
      level: 'warning',
      title: `Vercel environment variables are read in the source: ${[...usedEnvVars].sort().join(', ')}`,
      consequence:
        'They are undefined off Vercel, so any branch depending on them silently takes its other path.',
      action: 'Replace them with your own variables, and set those in the deployment environment.',
    })
  }

  return findings
}

function runtimeFindings(project: ProjectInfo): Finding[] {
  const findings: Finding[] = []

  if (!project.lockfile) {
    findings.push({
      level: 'warning',
      title: 'No lockfile',
      consequence:
        'The image installs from the ranges in package.json, so two builds of the same commit can resolve different versions.',
      action: 'Commit a lockfile so builds are reproducible.',
    })
  }

  findings.push({
    level: 'note',
    title: 'The ISR cache does not survive a restart',
    consequence:
      'Cached pages and optimized images live inside the container, so every restart or redeploy starts cold.',
    action: 'Expected for a single instance. See docs/design.md §12.',
  })

  return findings
}

/** Yields application source files, skipping directories that never hold any. */
async function* sourceFiles(directory: string): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      yield* sourceFiles(absolute)
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      yield absolute
    }
  }
}

async function readJson(file: string): Promise<Record<string, any> | null> {
  try {
    await stat(file)
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}
