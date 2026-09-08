/**
 * @nextship/cli: content hashing
 *
 * The deployment id is a content address over everything that changes the image.
 * Anything omitted here is something that can change without producing a new id,
 * which means a stale image served under a tag that claims to be current.
 *
 * Author: Gowtham
 * Design: ../../../docs/00-design.md §7.4
 */

import { createHash } from 'node:crypto'

/**
 * Hashes an ordered list of inputs. A separator that cannot appear in the inputs
 * keeps `["ab", "c"]` from colliding with `["a", "bc"]`.
 */
export function hashParts(parts: string[]): string {
  const digest = createHash('sha256')
  for (const part of parts) {
    digest.update(part)
    digest.update('\0')
  }
  return digest.digest('hex')
}
