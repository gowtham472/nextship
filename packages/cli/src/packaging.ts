/**
 * @nextship/cli: runtime image
 *
 * Stage three of the pipeline. Builds the runtime target of the same Dockerfile
 * the build stage used, so BuildKit serves the compile from cache and only the
 * runtime stage does new work.
 *
 * Author: Gowtham
 * Design: ../../../docs/design.md §7
 */

import type { ProjectInfo } from './detect.js'
import type { BuildResult } from './build.js'
import { dockerBuild } from './docker.js'
import { detail, step } from './util/log.js'

export interface ImageRef {
  /** Local tag, `<project>:<deploymentId>`, so an image is traceable to its build. */
  tag: string
}

export async function packageImage(project: ProjectInfo, build: BuildResult): Promise<ImageRef> {
  const tag = `${project.name}:${build.identity.deploymentId}`

  step('Packaging runtime image')
  detail(`base node:${project.nodeMajor}-slim`)

  await dockerBuild(project, build.context, build.identity, { target: 'runtime', tag })

  return { tag }
}
