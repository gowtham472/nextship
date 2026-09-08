/**
 * @nextship/cli: Docker invocation
 *
 * One place that knows how to call `docker build` for this project, so the
 * manifest export and the runtime image are built with identical inputs and
 * BuildKit can serve the second from the first's cache.
 *
 * Author: Gowtham
 * Design: ../../../docs/00-design.md §7
 */

import path from 'node:path'
import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import type { BuildIdentity } from './identity.js'
import type { PreparedContext } from './image/prepare.js'
import { KEY_SECRET_ID, TARGET_PLATFORM, envSecretId, type BuildTarget } from './image/dockerfile.js'
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

  if (options.tag) args.push('--tag', options.tag)
  if (options.outputDir) args.push('--output', `type=local,dest=${options.outputDir}`)

  args.push(project.contextRoot)
  return args
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
