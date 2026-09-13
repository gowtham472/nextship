/**
 * @nextship/cli: Docker invocation
 *
 * One place that knows how to call `docker build` for this project, so the
 * manifest export and the runtime image are built with identical inputs and
 * BuildKit can serve the second from the first's cache.
 *
 * Author: Gowtham
 * Design: ../../../docs/design.md §7
 */

import { createHash } from 'node:crypto'
import path from 'node:path'
import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import type { BuildIdentity } from './identity.js'
import type { PreparedContext } from './image/prepare.js'
import { KEY_SECRET_ID, TARGET_PLATFORM, envSecretId, installerSecretId, type BuildTarget } from './image/dockerfile.js'
import { capture, run } from './util/exec.js'

export interface DockerBuildOptions {
  target: BuildTarget
  /** Image tag for the runtime target. */
  tag?: string
  /** Directory to export the target's filesystem into. Used for the manifest target. */
  outputDir?: string
}

/**
 * Separated from the call so it can be asserted directly. Getting `--platform` or
 * a secret id wrong produces an image that only fails on the target, which is the
 * most expensive place to find out.
 */
export function buildArguments(
  project: ProjectInfo,
  context: PreparedContext,
  identity: BuildIdentity,
  options: DockerBuildOptions
): string[] {
  const args = [
    'build',
    // Without this the image is built for the machine that ran the command. An
    // arm64 laptop would produce an image that cannot run on an amd64 host, and
    // the failure appears at deploy time rather than build time.
    '--platform',
    TARGET_PLATFORM,
    '--file',
    context.dockerfilePath,
    '--target',
    options.target,
    // Declared after the dependency install in the Dockerfile, so a new id
    // invalidates the application build without re-running the install.
    '--build-arg',
    `NEXTSHIP_DEPLOYMENT_ID=${identity.deploymentId}`,
    '--build-arg',
    `NEXTSHIP_NEXT_CACHE_ID=${nextCacheId(project)}`,
    // Read from the child's environment rather than a file on disk, so the key
    // is never written anywhere the CLI does not already keep it.
    '--secret',
    `id=${KEY_SECRET_ID},env=NEXTSHIP_KEY`,
    '--label',
    `sh.nextship.deployment=${identity.deploymentId}`,
  ]

  for (const [index, file] of project.envFiles.entries()) {
    args.push('--secret', `id=${envSecretId(index)},src=${path.join(project.root, file)}`)
  }

  for (const [index, file] of project.installerSecrets.entries()) {
    args.push('--secret', `id=${installerSecretId(index)},src=${path.join(project.contextRoot, file)}`)
  }
  if (identity.installerDigest) {
    args.push('--build-arg', `NEXTSHIP_INSTALLER_DIGEST=${identity.installerDigest}`)
  }

  if (options.tag) args.push('--tag', options.tag)
  if (options.outputDir) args.push('--output', `type=local,dest=${options.outputDir}`)

  args.push(project.contextRoot)
  return args
}

/**
 * The Next.js build cache a project uses: its name for recognition, and a hash of
 * where it lives so two projects with the same name, or none, never share one.
 * The same project in the same place keeps its cache from build to build.
 */
export function nextCacheId(project: ProjectInfo): string {
  const location = createHash('sha256').update(`${project.contextRoot}\0${project.appDir}`).digest('hex')
  return `nextship-next-${project.name}-${location.slice(0, 12)}`
}

export async function dockerBuild(
  project: ProjectInfo,
  context: PreparedContext,
  identity: BuildIdentity,
  options: DockerBuildOptions
): Promise<void> {
  await run('docker', buildArguments(project, context, identity, options), {
    cwd: project.contextRoot,
    env: { NEXTSHIP_KEY: identity.encryptionKey },
  })
}

/**
 * Queries the daemon rather than the CLI. `docker --version` succeeds while the
 * daemon is stopped, which would let a build start and then fail later with a
 * pipe error that says nothing useful.
 */
export async function assertDockerAvailable(): Promise<void> {
  const serverVersion = await capture('docker', ['version', '--format', '{{.Server.Version}}'], {
    cwd: process.cwd(),
  })

  if (!serverVersion) {
    throw new NextshipError(
      'Cannot reach the Docker daemon.',
      'Start Docker (on Windows and macOS, open Docker Desktop and wait for it to report running), then run the command again.'
    )
  }

  // Secret and cache mounts and the local exporter all need BuildKit, which
  // has been the default builder since Docker 23.
  const [major] = serverVersion.split('.').map((part) => Number.parseInt(part, 10))
  if (Number.isFinite(major) && major < 23) {
    throw new NextshipError(
      `Docker ${serverVersion} is too old.`,
      'nextship needs Docker 23 or newer for BuildKit. Update Docker, then run the command again.'
    )
  }
}
