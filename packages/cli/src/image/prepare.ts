/**
 * @nextship/cli: build context preparation
 *
 * Writes everything the image build needs into `.nextship/` inside the app:
 * the adapter, the prune script, the Dockerfile and its ignore file. The
 * directory ignores itself in git, because it also holds the Server Actions key.
 *
 * Author: Gowtham
 * Design: ../../../../docs/design.md §7
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectInfo } from '../detect.js'
import { BUILD_DIR, renderDockerfile, renderDockerignore } from './dockerfile.js'

export interface PreparedContext {
  /** Absolute path to the generated Dockerfile. */
  dockerfilePath: string
  /** The Dockerfile text, hashed into the deployment id so a generator change produces a new image. */
  dockerfile: string
  /**
   * Contents of the helpers copied into the context, hashed into the deployment
   * id for the same reason. The nextship version alone is not enough: editing
   * the adapter or the prune script without releasing would otherwise produce a
   * different image under an unchanged tag, which is the defect fixed in
   * `identity.ts` reappearing in a narrower form.
   */
  helpers: string[]
}

export async function prepareContext(project: ProjectInfo): Promise<PreparedContext> {
  const nextshipDir = path.join(project.root, '.nextship')
  const buildDir = path.join(project.root, BUILD_DIR)
  await mkdir(buildDir, { recursive: true })

  // Written first, before anything sensitive exists. See docs/design.md §7.3.
  await writeFile(path.join(nextshipDir, '.gitignore'), '*\n', 'utf8')

  const helpers = await Promise.all([
    copyHelper(resolveAdapter(), path.join(buildDir, 'adapter.mjs')),
    copyHelper(resolveRuntimeAsset('prune.cjs'), path.join(buildDir, 'prune.cjs')),
  ])

  const dockerfile = renderDockerfile(project)
  const dockerfilePath = path.join(nextshipDir, 'Dockerfile')
  await writeFile(dockerfilePath, dockerfile, 'utf8')
  // BuildKit reads ignore rules from <Dockerfile>.dockerignore, which leaves the
  // project's own .dockerignore untouched.
  await writeFile(`${dockerfilePath}.dockerignore`, renderDockerignore(project), 'utf8')

  return { dockerfilePath, dockerfile, helpers }
}

/** Copies one helper into the build context and returns its contents for hashing. */
async function copyHelper(source: string, destination: string): Promise<string> {
  const contents = await readFile(source, 'utf8')
  await writeFile(destination, contents, 'utf8')
  return contents
}

/**
 * The adapter ships with the CLI and is copied into the build context, so it
 * never has to be a dependency of the user's project. It is a single ESM file
 * with no imports beyond node builtins, which is what makes the copy safe.
 */
/**
 * The adapter ships as a runtime asset, not as a dependency.
 *
 * It is a file copied into a build context rather than a module the CLI imports,
 * so depending on it would have made the published package unresolvable: a
 * `workspace:*` range cannot be installed from a registry.
 */
function resolveAdapter(): string {
  return resolveRuntimeAsset('adapter.mjs')
}

function resolveRuntimeAsset(name: string): string {
  return fileURLToPath(new URL(`../../runtime/${name}`, import.meta.url))
}
