/**
 * @nextship/cli: tests for the app lock on a server
 *
 * The lock is only useful if a held one is never mistaken for a free one and an
 * abandoned one is never broken automatically, so both are pinned.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STALE_AFTER_MS, heldLockError, parseOwner } from './lock.js'

const now = new Date('2026-09-15T10:00:00.000Z')
const owner = (minutesAgo: number) => ({ host: 'laptop', pid: 4242, since: new Date(now.getTime() - minutesAgo * 60000).toISOString() })
const path = '/etc/nextship/apps/demo/lock'

test('a recent lock says to wait, and names who holds it', () => {
  const error = heldLockError('demo', path, owner(5), now)
  assert.match(error.message, /in progress \(laptop, pid 4242/)
  assert.match(error.action, /Wait for it to finish/)
  assert.doesNotMatch(error.action, /rm -rf/)
})

test('a lock older than 30 minutes is reported as abandoned, with the command to remove it by hand', () => {
  assert.equal(STALE_AFTER_MS, 30 * 60 * 1000)
  const error = heldLockError('demo', path, owner(31), now)
  assert.match(error.message, /looks abandoned/)
  assert.match(error.action, /rm -rf \/etc\/nextship\/apps\/demo\/lock/)
  assert.match(error.action, /does not break locks itself/)
})

// A holder that died between creating the lock and writing its owner leaves an
// empty file. That is still a held lock, never a free one.
test('an owner that cannot be read is still a held lock, reported as abandoned', () => {
  assert.equal(parseOwner(''), null)
  assert.equal(parseOwner('{"host":"x"}'), null)
  assert.match(heldLockError('demo', path, null, now).message, /did not record itself/)
  assert.deepEqual(parseOwner(JSON.stringify(owner(1))), owner(1))
})
