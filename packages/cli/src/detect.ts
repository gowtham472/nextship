/**
 * @nextship/cli: project detection
 *
 * Stage one of the pipeline. Resolves everything about the project that the
 * later stages need, so the user is never asked for something that can be read
 * from the repository.
 *
 * Author: Gowtham
 * Design: ../../../docs/design.md §8
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextshipError } from './errors.js'

/** The Next.js release that made the Deployment Adapter API stable and public. */
const MINIMUM_NEXT = { major: 16, minor: 2 }

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export interface ProjectInfo {
  /** Directory containing the project's package.json. The build runs from here. */
  root: string
  /**
   * Directory the image is built from. Equal to `root` for a standalone project,
   * and the workspace root for a package inside a monorepo, because that is where
   * the lockfile and the other workspace manifests live.
   */
  contextRoot: string
  /** POSIX path from `contextRoot` to `root`, or '.' when they are the same. */
  appDir: string
  /** Used to name the container image. */
  name: string
  /** The installed version, read from node_modules, not the declared range. */
  nextVersion: string
  packageManager: PackageManager
  /** Lockfile name, copied into the image so dependencies resolve identically. */
  lockfile: string | null
  /** Argv for the build, already resolved against the detected package manager. */
  buildCommand: string[]
  /** Node major version for the runtime image base. */
  nodeMajor: string
  /** Installed sharp version, reported by `detect` so a missing binary is visible early. */
  sharpVersion: string | null
  /**
   * Env files present in the project, in the order Next.js loads them for a
   * production build. Mounted as build secrets so they never enter an image layer.
   */
  envFiles: string[]
  /**
   * Package manager configuration at the context root, copied before the install
   * so it is present when the install runs. pnpm 10 keeps settings such as which
   * dependencies may run build scripts in pnpm-workspace.yaml, even for a single
   * package, and a frozen install fails without them.
   */
  installerConfigs: string[]
  /** The project's own .dockerignore, merged into the generated one so its rules still apply. */
  userDockerignore: string | null
  /**
   * Paths of dependencies resolved from a local `file:` specifier, relative to
   * the build context.
   *
   * These have to be copied before the install runs. The Dockerfile copies
   * manifests first and sources afterwards, so that an edit to a component does
   * not re-run the install, but a `file:` dependency lives in the sources and so
   * is absent at the moment the install needs it.
   */
  localDependencies: string[]
}

/** Files that configure the install itself, as opposed to the application. */
const INSTALLER_CONFIGS = ['pnpm-workspace.yaml', '.npmrc', '.yarnrc.yml']

/** Next.js precedence for NODE_ENV=production, highest first. */
const ENV_FILES = ['.env.production.local', '.env.local', '.env.production', '.env']

export async function detectProject(cwd: string): Promise<ProjectInfo> {
  const root = await findProjectRoot(cwd)
  const pkg = await readJson(path.join(root, 'package.json'))

  const contextRoot = await findWorkspaceRoot(root)

  // Package managers hoist shared dependencies to the workspace root, so a
  // package inside a monorepo often has no node_modules/next of its own.
  const searchRoots = root === contextRoot ? [root] : [root, contextRoot]

  const nextVersion = await readInstalledVersion(searchRoots, 'next')
  if (!nextVersion) {
    throw new NextshipError(
      'Next.js is not installed in this project.',
      'Run your package manager install command, or check that you are in the right directory.'
    )
  }
  assertAdapterApiSupported(nextVersion)

  const { packageManager, lockfile } = await detectPackageManager(contextRoot)

  return {
    root,
    contextRoot,
    appDir: toPosix(path.relative(contextRoot, root)) || '.',
    name: typeof pkg.name === 'string' ? sanitiseImageName(pkg.name) : 'app',
    nextVersion,
    packageManager,
    lockfile,
    buildCommand: resolveBuildCommand(packageManager, Boolean(pkg.scripts?.build)),
    nodeMajor: await detectNodeMajor(root, pkg),
    sharpVersion: await readInstalledVersion(searchRoots, 'sharp'),
    envFiles: await presentFiles(root, ENV_FILES),
    installerConfigs: await presentFiles(contextRoot, INSTALLER_CONFIGS),
    userDockerignore: await readTextIfPresent(path.join(contextRoot, '.dockerignore')),
    localDependencies: localDependencyPaths(pkg, root, contextRoot),
  }
}

/**
 * Dependency paths declared with a `file:` specifier.
 *
 * A path that climbs out of the build context is refused rather than copied,
 * because Docker cannot see outside the context and the install would fail
 * inside the image with a message about a missing tarball rather than about the
 * dependency that caused it.
 */
export function localDependencyPaths(
  pkg: Record<string, unknown>,
  root: string,
  contextRoot: string
): string[] {
  const groups = ['dependencies', 'devDependencies', 'optionalDependencies']
  const found = new Set<string>()

  for (const group of groups) {
    const entries = pkg[group]
    if (typeof entries !== 'object' || entries === null) continue

    for (const [name, range] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof range !== 'string' || !range.startsWith('file:')) continue

      const target = path.resolve(root, range.slice('file:'.length))
      const relative = toPosix(path.relative(contextRoot, target))

      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new NextshipError(
          `Dependency "${name}" is a file: path outside the build context: ${range}.`,
          'Docker cannot read outside the project, so the install would fail. Move it inside the project, or publish it.'
        )
      }
      found.add(relative)
    }
  }

  return [...found].sort()
}

async function presentFiles(root: string, names: string[]): Promise<string[]> {
  const present: string[] = []
  for (const name of names) {
    if ((await readTextIfPresent(path.join(root, name))) !== null) present.push(name)
  }
  return present
}

/**
 * Walks up from `cwd` to the first directory holding a package.json that
 * declares a dependency on Next.js. Running the CLI from a subdirectory of the
 * app is common enough to be worth handling.
 */
async function findProjectRoot(cwd: string): Promise<string> {
  let dir = path.resolve(cwd)

  for (;;) {
    const pkg = await readJsonIfPresent(path.join(dir, 'package.json'))
    if (pkg && dependsOnNext(pkg)) return dir

    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  throw new NextshipError(
    'No Next.js project found in this directory or any parent directory.',
    'Change into your Next.js app directory and run the command again.'
  )
}

const dependsOnNext = (pkg: Record<string, any>): boolean =>
  Boolean(pkg.dependencies?.next ?? pkg.devDependencies?.next)

/**
 * Finds the workspace root above the project, or the project itself when it is
 * standalone. A package inside a monorepo cannot be built on its own: the
 * lockfile and every sibling manifest the installer needs live at the root.
 *
 * A workspace declaration is only a root for the projects its patterns include,
 * and the nearest one is authoritative: when it does not include this project,
 * the project is standalone even though it sits inside the directory. Taking the
 * first ancestor with any declaration built an npm project kept outside a pnpm
 * monorepo from the monorepo root, with pnpm and a lockfile that does not know
 * the project exists.
 */
async function findWorkspaceRoot(projectRoot: string): Promise<string> {
  let dir = path.dirname(projectRoot)

  for (;;) {
    const patterns = await workspacePatterns(dir)
    if (patterns !== null) {
      return includesProject(patterns, toPosix(path.relative(dir, projectRoot))) ? dir : projectRoot
    }

    const parent = path.dirname(dir)
    if (parent === dir) return projectRoot
    dir = parent
  }
}

/**
 * The member patterns a directory declares, or null when it declares no
 * workspace. pnpm reads pnpm-workspace.yaml and ignores the workspaces field, so
 * the file takes precedence. A pnpm-workspace.yaml with no packages list is valid,
 * holding only settings, and makes the root its sole member.
 */
async function workspacePatterns(dir: string): Promise<string[] | null> {
  const pnpmWorkspace = await readTextIfPresent(path.join(dir, 'pnpm-workspace.yaml'))
  if (pnpmWorkspace !== null) return parsePnpmWorkspacePackages(pnpmWorkspace)

  const workspaces = (await readJsonIfPresent(path.join(dir, 'package.json')))?.workspaces
  const isString = (entry: unknown): entry is string => typeof entry === 'string'

  if (Array.isArray(workspaces)) return workspaces.filter(isString)
  // Yarn classic also accepts { packages: [...], nohoist: [...] }.
  if (Array.isArray(workspaces?.packages)) return workspaces.packages.filter(isString)
  return null
}

/**
 * The `packages` list from pnpm-workspace.yaml, in block or flow style.
 *
 * Deliberately narrow rather than a YAML parser: the CLI carries one runtime
 * dependency, and this key has two shapes in practice. Anything it cannot read
 * yields no patterns, which makes a nested project standalone, so the failure
 * mode is a build from the project directory rather than from a guessed root.
 */
function parsePnpmWorkspacePackages(yaml: string): string[] {
  const unquote = (value: string): string => value.trim().replace(/^(['"])(.*)\1$/, '$2')
  const lines = yaml.split(/\r?\n/).map((line) => line.replace(/(^|\s)#.*$/, ''))

  const patterns: string[] = []
  let inPackages = false

  for (const line of lines) {
    const flow = /^packages\s*:\s*\[(.*)\]\s*$/.exec(line)
    if (flow) return (flow[1] ?? '').split(',').map(unquote).filter(Boolean)

    if (/^packages\s*:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (!inPackages || line.trim() === '') continue

    const item = /^\s+-\s+(.+)$/.exec(line)
    if (item?.[1]) patterns.push(unquote(item[1]))
    else if (/^\S/.test(line)) break
  }

  return patterns
}

/** Whether a member pattern list includes the project at `relative`. A leading `!` excludes. */
function includesProject(patterns: string[], relative: string): boolean {
  const matches = (pattern: string): boolean =>
    globToRegExp(pattern.replace(/^\.\//, '').replace(/\/+$/, '')).test(relative)

  const included = patterns.filter((pattern) => !pattern.startsWith('!'))
  const excluded = patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1))

  return included.some(matches) && !excluded.some(matches)
}

/** `*` matches within one path segment and `**` across any number of them. */
function globToRegExp(glob: string): RegExp {
  let source = ''

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? ''
    if (char === '*' && glob[index + 1] === '*') {
      const slash = glob[index + 2] === '/'
      source += slash ? '(?:.*/)?' : '.*'
      index += slash ? 2 : 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }

  return new RegExp(`^${source}$`)
}

const toPosix = (value: string): string => value.split(path.sep).join('/')

/**
 * Reads the version actually on disk. The declared range in package.json is not
 * enough: the adapter API gate below must reflect what will really run.
 */
async function readInstalledVersion(roots: string[], name: string): Promise<string | null> {
  for (const root of roots) {
    const pkg = await readJsonIfPresent(path.join(root, 'node_modules', name, 'package.json'))
    if (typeof pkg?.version === 'string') return pkg.version

    const stored = await readFromPnpmStore(path.join(root, 'node_modules', '.pnpm'), name)
    if (stored) return stored
  }
  return null
}

/**
 * Finds a package that pnpm installed but did not link at the top level.
 *
 * pnpm links only direct dependencies into `node_modules`. A transitive one,
 * which is what `sharp` is for most Next.js projects, exists solely inside the
 * store, so probing `node_modules/<name>` reports it missing on exactly the
 * projects where it is installed and working. That false negative matters
 * because `detect` exists to report what is really there: it told a project
 * whose image demonstrably ships sharp 0.34.5 with its Linux binary that sharp
 * was "not resolvable", which invites someone to install a package they already
 * have.
 */
async function readFromPnpmStore(storeDir: string, name: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await readdir(storeDir)
  } catch {
    return null
  }

  // Store directories are named "<name>@<version>", with any "/" in a scoped
  // name replaced by "+". Sorting keeps the choice stable when a project has
  // resolved more than one version of the same package.
  const prefix = `${name.replace('/', '+')}@`
  for (const entry of entries.filter((candidate) => candidate.startsWith(prefix)).sort()) {
    const pkg = await readJsonIfPresent(path.join(storeDir, entry, 'node_modules', name, 'package.json'))
    if (typeof pkg?.version === 'string') return pkg.version
  }
  return null
}

function assertAdapterApiSupported(version: string): void {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10))

  const supported =
    major > MINIMUM_NEXT.major || (major === MINIMUM_NEXT.major && minor >= MINIMUM_NEXT.minor)

  if (!supported) {
    throw new NextshipError(
      `Next.js ${version} is installed, but nextship needs ${MINIMUM_NEXT.major}.${MINIMUM_NEXT.minor} or newer.`,
      `The Deployment Adapter API became stable in Next.js ${MINIMUM_NEXT.major}.${MINIMUM_NEXT.minor}. Upgrade Next.js, then run the command again.`
    )
  }
}

async function detectPackageManager(
  root: string
): Promise<{ packageManager: PackageManager; lockfile: string | null }> {
  const lockfiles: Array<[string, PackageManager]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lockb', 'bun'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ]

  for (const [lockfile, packageManager] of lockfiles) {
    if ((await readTextIfPresent(path.join(root, lockfile))) !== null) {
      return { packageManager, lockfile }
    }
  }
  // Without a lockfile the image installs from package.json ranges, which is
  // less reproducible but still correct.
  return { packageManager: 'npm', lockfile: null }
}

/**
 * Prefers the project's own build script so any custom flags are preserved, and
 * falls back to invoking Next directly when no script is defined.
 */
function resolveBuildCommand(manager: PackageManager, hasBuildScript: boolean): string[] {
  if (hasBuildScript) {
    return manager === 'yarn' ? ['yarn', 'build'] : [manager, 'run', 'build']
  }

  const direct: Record<PackageManager, string[]> = {
    pnpm: ['pnpm', 'exec', 'next', 'build'],
    npm: ['npm', 'exec', '--', 'next', 'build'],
    yarn: ['yarn', 'next', 'build'],
    bun: ['bun', 'x', 'next', 'build'],
  }
  return direct[manager]
}

/**
 * Honours an explicit choice where the project makes one, because the runtime
 * image base must match what the project was developed against.
 */
async function detectNodeMajor(root: string, pkg: Record<string, any>): Promise<string> {
  const fromEngines = typeof pkg.engines?.node === 'string' ? pkg.engines.node.match(/\d+/) : null
  if (fromEngines) return fromEngines[0]

  const nvmrc = await readTextIfPresent(path.join(root, '.nvmrc'))
  const fromNvmrc = nvmrc?.match(/\d+/)
  if (fromNvmrc) return fromNvmrc[0]

  return process.versions.node.split('.')[0]
}

/** Container image names allow lowercase alphanumerics and separators only. */
const sanitiseImageName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app'

async function readJson(file: string): Promise<Record<string, any>> {
  const parsed = await readJsonIfPresent(file)
  if (!parsed) {
    throw new NextshipError(`Could not read ${file}.`, 'Check that the file exists and is valid JSON.')
  }
  return parsed
}

async function readJsonIfPresent(file: string): Promise<Record<string, any> | null> {
  const text = await readTextIfPresent(file)
  if (text === null) return null

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function readTextIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}
