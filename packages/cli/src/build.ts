/**
 * @nextship/cli: build
 *
 * Stage two of the pipeline. Runs the project's build inside Docker, with the
 * adapter injected through the environment, and exports the manifest the
 * adapter wrote. Nothing on the developer's machine is compiled or modified
 * beyond `.nextship/`.
 *
 * Author: Gowtham
 * Design: ../../../docs/00-design.md §6, §7
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import { assertDockerAvailable, dockerBuild } from './docker.js'
import { computeDigest, resolveDeploymentId, type BuildIdentity } from './identity.js'
import { OUTPUT_DIR } from './image/dockerfile.js'
import { prepareContext, type PreparedContext } from './image/prepare.js'
import { detail, step, warn } from './util/log.js'

const SECRETS_FILE = '.nextship/secrets.local.json'
const MANIFEST_VERSION = 1

/** What the adapter wrote, read back to confirm it ran and applied what it was given. */
export interface Manifest {
  version: number
  buildId: string
  deploymentId: string
  framework: { name: string; version: string }
  /**
   * A prerendered route the health check can poll without rendering, or null
   * when the build has none. Optional so a manifest from an older adapter still
   * reads.
   */
  healthPath?: string | null
}

export interface BuildResult {
  manifest: Manifest
  identity: BuildIdentity
  context: PreparedContext
}

export async function buildProject(project: ProjectInfo): Promise<BuildResult> {
  await assertDockerAvailable()

  const context = await prepareContext(project)
  const encryptionKey = await resolveEncryptionKey(project.root)
  const digest = await computeDigest(project, context, encryptionKey)
  const { deploymentId, ephemeral } = await resolveDeploymentId(project.root, digest)
  const identity: BuildIdentity = { deploymentId, encryptionKey, ephemeral }

  step(`Building ${project.name} in Docker`)
  detail(`deployment ${deploymentId}`)
  if (ephemeral) {
    detail('this id is unique to this build, because the source is not a clean commit')
  }
  if (project.envFiles.length > 0) detail(`env files  ${project.envFiles.join(', ')}`)

  const outputDir = path.join(project.root, OUTPUT_DIR)
  await dockerBuild(project, context, identity, { target: 'manifest', outputDir })

  const manifest = await readManifest(outputDir)
  if (manifest.deploymentId !== deploymentId) {
    throw new NextshipError(
      'The build ran, but the adapter did not apply the deployment id.',
      'This is a nextship defect. Please report it with the output above.'
    )
  }

  return { manifest, identity, context }
}

/**
 * Keeps one key per project. Generating a new key on every build would break
 * Server Actions for any client still running the previous build.
 *
 * The key lives outside git, so a second machine or a CI runner will not have it
 * and would generate its own. That is why the environment variable takes
 * precedence and why both the mismatch and the first generation are reported.
 */
async function resolveEncryptionKey(root: string): Promise<string> {
  const file = path.join(root, SECRETS_FILE)
  const stored = await readStoredKey(file)
  const fromEnvironment = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY

  if (fromEnvironment) {
    if (stored && stored !== fromEnvironment) {
      warn(
        `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY differs from the key in ${SECRETS_FILE}. ` +
          'Using the environment variable. Clients built with the other key will fail Server Actions.'
      )
    }
    return fromEnvironment
  }

  if (stored) return stored

  const generated = randomBytes(32).toString('base64')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ serverActionsEncryptionKey: generated }, null, 2))
  detail(`generated a Server Actions encryption key in ${SECRETS_FILE}`)
  warn(
    `${SECRETS_FILE} is not committed, so another machine or a CI runner will generate a different key ` +
      'and break Server Actions for clients on builds made here. Copy the value into ' +
      'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY wherever else you build.'
  )
  return generated
}

/**
 * A file that exists but cannot be read must stop the build. Quietly generating a
 * replacement would rotate the key, and every client still on the previous
 * deployment would lose Server Actions.
 */
async function readStoredKey(file: string): Promise<string | null> {
  let existing: string
  try {
    existing = await readFile(file, 'utf8')
  } catch {
    return null
  }

  const advice =
    'Restore it from a backup, or delete it to generate a new key. A new key breaks Server Actions for clients on the previous deployment.'

  let stored: Record<string, unknown>
  try {
    stored = JSON.parse(existing)
  } catch {
    throw new NextshipError(`${SECRETS_FILE} exists but is not valid JSON.`, advice)
  }
  if (typeof stored.serverActionsEncryptionKey !== 'string') {
    throw new NextshipError(`${SECRETS_FILE} does not contain serverActionsEncryptionKey.`, advice)
  }
  return stored.serverActionsEncryptionKey
}

/**
 * The manifest is the adapter's only signal that it ran. Its absence means the
 * adapter was never invoked, which is the one failure the build itself reports
 * as success.
 */
async function readManifest(outputDir: string): Promise<Manifest> {
  const file = path.join(outputDir, 'manifest.json')
  let manifest: Manifest
  try {
    manifest = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    throw new NextshipError(
      'The build finished but produced no nextship manifest.',
      'The adapter did not run. Confirm the build command runs `next build` and that Next.js is 16.2 or newer.'
    )
  }

  if (manifest.version !== MANIFEST_VERSION) {
    throw new NextshipError(
      `This build produced a version ${manifest.version} manifest, but this CLI reads version ${MANIFEST_VERSION}.`,
      'Update nextship, which ships the adapter and the reader together.'
    )
  }

  return manifest
}
