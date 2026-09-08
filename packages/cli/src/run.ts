/**
 * @nextship/cli: local run
 *
 * Starts the packaged image on the developer's machine. This exists so the
 * artifact can be verified before any cloud account is involved: if the app does
 * not work here, no deployment target will fix it.
 *
 * Runs attached, so Ctrl+C stops the container and `--rm` removes it. There is
 * no background mode and no container name to manage, which means no state to
 * clean up when something goes wrong.
 *
 * Author: Gowtham
 * Roadmap: ../../../docs/01-roadmap.md v0.2
 */

import path from 'node:path'
import type { ProjectInfo } from './detect.js'
import type { ImageRef } from './packaging.js'
import { CONTAINER_PORT } from './image/dockerfile.js'
import { CommandError, run } from './util/exec.js'
import { detail, ok } from './util/log.js'

/**
 * Exit statuses that mean the container was stopped, not that it failed:
 * 128 plus SIGINT for Ctrl+C here, 128 plus SIGTERM for `docker stop` elsewhere.
 * Next.js exits with exactly these after its graceful shutdown.
 */
const STOPPED = new Set([130, 143])

export async function runImage(project: ProjectInfo, image: ImageRef): Promise<void> {
  const args = ['run', '--rm', '--publish', `${CONTAINER_PORT}:${CONTAINER_PORT}`]

  // Highest-precedence env file first, matching what Next.js would load. Secrets
  // stay outside the image, so the same image runs unchanged in every
  // environment. See docs/00-design.md §7.
  const envFile = project.envFiles[0]
  if (envFile) {
    args.push('--env-file', path.join(project.root, envFile))
    detail(`environment from ${envFile}`)
  }

  args.push(image.tag)

  ok(`Running at http://localhost:${CONTAINER_PORT}`)
  detail('press Ctrl+C to stop')

  // Ctrl+C reaches both this process and the attached docker client. Ignoring
  // it here lets docker stop the container and report, instead of this process
  // dying first and leaving the container to be cleaned up by --rm later.
  const ignoreInterrupt = (): void => {}
  process.on('SIGINT', ignoreInterrupt)

  try {
    await run('docker', args, { cwd: project.root })
  } catch (error) {
    if (error instanceof CommandError && STOPPED.has(error.exitCode)) {
      ok('Stopped')
      return
    }
    throw error
  } finally {
    process.off('SIGINT', ignoreInterrupt)
  }
}
