/**
 * @nextship/cli: deployment history on a server
 *
 * App Platform keeps a deployment history and says which deployment is live. A
 * server keeps nothing of the kind, so nextship writes its own:
 * `/etc/nextship/apps/<name>/deployments.json`, newest first, one entry per
 * container nextship started. It is what rollback chooses from and what `images
 * prune` keeps images for.
 *
 * Every change to it is a pure function here, so the transitions a release makes
 * (started, went live, failed) are tested without a server. The file is only
 * ever written while the app's lock is held.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { randomBytes } from 'node:crypto'
import { NextshipError } from '../../errors.js'
import type { DeploymentRecord } from '../target.js'

/**
 * A release id names one container, so it has to be unique per release rather
 * than per image: `env push` and rollback start a new container from an image
 * that already ran, and reusing its id would reuse its container name.
 */
export function newReleaseId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
  return `r${stamp}-${randomBytes(3).toString('hex')}`
}

/**
 * A deployment as a server records it: the record every target shares, plus
 * the health path its image was built with, which a rollback or an env change
 * needs to start that image again.
 */
export interface VmDeployment extends DeploymentRecord {
  healthPath: string | null
}

/** Reads the file, refusing one that is not a history rather than starting a new one over it. */
export function parseDeployments(contents: string): VmDeployment[] {
  if (contents.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    throw corrupt('is not valid JSON')
  }
  if (!Array.isArray(parsed)) throw corrupt('is not a list')
  return parsed.map((entry, index) => {
    const record = entry as Partial<VmDeployment>
    if (
      typeof record.id !== 'string' ||
      typeof record.served !== 'boolean' ||
      typeof record.live !== 'boolean' ||
      typeof record.cause !== 'string' ||
      typeof record.createdAt !== 'string' ||
      !(typeof record.imageTag === 'string' || record.imageTag === null) ||
      !(record.healthPath === undefined || record.healthPath === null || typeof record.healthPath === 'string')
    ) {
      throw corrupt(`has an unreadable entry at position ${index + 1}`)
    }
    return {
      id: record.id,
      served: record.served,
      live: record.live,
      cause: record.cause,
      createdAt: record.createdAt,
      imageTag: record.imageTag,
      healthPath: record.healthPath ?? null,
    }
  })
}

const corrupt = (problem: string): NextshipError =>
  new NextshipError(
    `The deployment history on the server ${problem}.`,
    'nextship will not guess which deployment is live. Restore the file, or inspect it on the server, before deploying again.'
  )

export function serializeDeployments(deployments: VmDeployment[]): string {
  return `${JSON.stringify(deployments, null, 2)}\n`
}

/** A new deployment, first in the list and not yet serving. */
export function recordStarted(
  deployments: VmDeployment[],
  entry: { id: string; imageTag: string; cause: string; createdAt: string; healthPath: string | null }
): VmDeployment[] {
  return [{ ...entry, served: false, live: false }, ...deployments]
}

/**
 * The deployment took traffic. It becomes the only live one, and stays a valid
 * rollback target from now on.
 */
export function recordLive(deployments: VmDeployment[], id: string): VmDeployment[] {
  if (!deployments.some((entry) => entry.id === id)) {
    throw new NextshipError(`Deployment ${id} is not in the history.`, 'This is a nextship defect. Please report it.')
  }
  return deployments.map((entry) =>
    entry.id === id ? { ...entry, served: true, live: true } : { ...entry, live: false }
  )
}

/** The deployment never served. The one that was live stays live. */
export function recordFailed(deployments: VmDeployment[], id: string, reason: string): VmDeployment[] {
  return deployments.map((entry) =>
    entry.id === id ? { ...entry, served: false, live: false, cause: `${entry.cause}, ${reason}` } : entry
  )
}

/**
 * Image tags a server keeps: the live one, and those of the newest served
 * deployments up to `keep`. Everything else can be removed, which is safe on a
 * server because removing an image frees its space at once and nothing else
 * reads it.
 */
export function imagesToKeep(deployments: DeploymentRecord[], keep: number): Set<string> {
  const kept = new Set<string>()
  const live = deployments.find((entry) => entry.live)?.imageTag
  if (live) kept.add(live)
  for (const entry of deployments) {
    if (kept.size >= keep) break
    if (entry.served && entry.imageTag) kept.add(entry.imageTag)
  }
  return kept
}
