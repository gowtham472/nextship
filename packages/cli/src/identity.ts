/**
 * @nextship/cli: build identity
 *
 * The deployment id names one exact image. It is used as the image tag, so two
 * builds that would produce different content must never share one: a rollback
 * to a tag has to restore the bytes that tag described.
 *
 * This is why the id is a content address rather than a commit. An earlier
 * version used the commit alone, and changing an environment variable then
 * produced a byte-different image under an identical tag, with the old value
 * still inside it. Env files reach the build as secret mounts, and BuildKit
 * deliberately excludes secret contents from its cache key, so nothing else
 * would have invalidated that build either.
 *
 * Author: Gowtham
 * Design: ../../../docs/design.md §7.4
 */

import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import { VERSION } from './version.js'
import { hashParts } from './util/hash.js'
import { capture } from './util/exec.js'

/** How much of the digest appears in the id. 8 hex characters is 32 bits. */
const DIGEST_LENGTH = 8

export interface BuildIdentity {
  deploymentId: string
  encryptionKey: string
  /** True when the id could not be derived from content, so it is unique per build. */
  ephemeral: boolean
}

/**
 * Everything that changes the built image and is not already covered by the
 * source tree, which the build context hashes on its own.
 */
export async function computeDigest(
  project: ProjectInfo,
  context: { dockerfile: string; helpers: string[] },
  encryptionKey: string
): Promise<string> {
  const parts = [VERSION, context.dockerfile, ...context.helpers, encryptionKey]

  for (const file of project.envFiles) {
    const absolute = path.join(project.root, file)
    let contents: string
    try {
      contents = await readFile(absolute, 'utf8')
    } catch {
      throw new NextshipError(
        `${file} was found during detection but cannot be read now.`,
        'Something changed it mid-build. Run the command again.'
      )
    }
    parts.push(file, contents)
  }

  return hashParts(parts)
}

/**
 * A clean git tree plus the digest is a complete description of the image, so the
 * id is reproducible. A dirty tree is not describable without hashing the whole
 * working copy, and no git means no commit at all, so both get a unique id per
 * build. Unique is always safe here; only a reused id is dangerous.
 */
export async function resolveDeploymentId(
  root: string,
  digest: string
): Promise<{ deploymentId: string; ephemeral: boolean }> {
  const fromEnvironment = process.env.NEXTSHIP_DEPLOYMENT_ID
  if (fromEnvironment) return { deploymentId: fromEnvironment, ephemeral: false }

  const commit = await capture('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root })
  if (!commit) return { deploymentId: `dpl-local-${randomBytes(4).toString('hex')}`, ephemeral: true }

  const changes = await capture('git', ['status', '--porcelain'], { cwd: root })
  if (changes === '') {
    return { deploymentId: `dpl-${commit}-${digest.slice(0, DIGEST_LENGTH)}`, ephemeral: false }
  }

  return { deploymentId: `dpl-${commit}-${randomBytes(4).toString('hex')}`, ephemeral: true }
}
