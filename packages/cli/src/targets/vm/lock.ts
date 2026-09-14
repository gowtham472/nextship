/**
 * @nextship/cli: one deployment at a time on a server
 *
 * Two deployments of the same app interleaving would start two containers, point
 * Caddy at whichever finished last and stop the other's predecessor, which can
 * leave nothing serving. So every change takes the app's lock first:
 * `mkdir /etc/nextship/apps/<name>/lock`, which either creates the directory or
 * fails, atomically, on any filesystem. An owner file inside says who holds it.
 *
 * A lock is never broken automatically. One that has been held for a long time
 * usually means a deployment was killed, but "usually" is how two deployments
 * end up running at once, so it is reported with the owner and left for a person
 * to remove.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { NextshipError } from '../../errors.js'

/** A deployment that has held the lock this long has almost certainly died. */
export const STALE_AFTER_MS = 30 * 60 * 1000

export interface LockOwner {
  host: string
  pid: number
  since: string
}

export function describeOwner(owner: LockOwner): string {
  return `${owner.host}, pid ${owner.pid}, since ${owner.since}`
}

/** Reads the owner file, which may be missing if the holder died between mkdir and writing it. */
export function parseOwner(contents: string): LockOwner | null {
  try {
    const parsed = JSON.parse(contents) as Partial<LockOwner>
    if (typeof parsed.host === 'string' && typeof parsed.pid === 'number' && typeof parsed.since === 'string') {
      return { host: parsed.host, pid: parsed.pid, since: parsed.since }
    }
  } catch {
    // Unreadable is reported as an unknown owner below, not as a free lock.
  }
  return null
}

/** The error for a held lock, which differs by whether it looks abandoned. */
export function heldLockError(app: string, lockPath: string, owner: LockOwner | null, now: Date): NextshipError {
  const since = owner ? Date.parse(owner.since) : Number.NaN
  const stale = !owner || Number.isNaN(since) || now.getTime() - since > STALE_AFTER_MS
  const who = owner ? describeOwner(owner) : 'an owner that did not record itself'

  if (!stale) {
    return new NextshipError(
      `Another change to "${app}" is in progress (${who}).`,
      'Wait for it to finish, then run the command again; a change written now would interleave with it.'
    )
  }
  return new NextshipError(
    `"${app}" is locked by ${who}, which looks abandoned.`,
    `Confirm no nextship command is still running against this server, then remove the lock on the server with \`rm -rf ${lockPath}\` and run the command again. nextship does not break locks itself.`
  )
}
