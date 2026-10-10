/**
 * @nextship/cli: tests for deployment history on a server
 *
 * Rollback trusts this file to say what served and what is live, so each
 * transition a release makes is pinned, mirroring what `rollback.test.ts` pins
 * for choosing a target.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rollbackCandidates } from '../../rollback.js'
import {
  imagesToKeep,
  newReleaseId,
  parseDeployments,
  PREVIOUS_KEPT_MS,
  previousServing,
  recordFailed,
  recordLive,
  recordStarted,
  serializeDeployments,
} from './deployments.js'

const at = '2026-09-15T10:00:00.000Z'
const now = new Date(at)

test('a first deployment goes from started to live, and becomes a rollback target', () => {
  let history = recordStarted([], { id: 'r1', imageTag: 'dpl-a', cause: 'deploy', createdAt: at, healthPath: null })
  assert.deepEqual(history[0], { id: 'r1', imageTag: 'dpl-a', cause: 'deploy', createdAt: at, healthPath: null, served: false, live: false, keptUntil: null })
  history = recordLive(history, 'r1', now, true)
  assert.equal(history[0].live, true)
  assert.equal(history[0].served, true)
})

test('an update moves live to the new deployment and keeps the old one served', () => {
  let history = recordLive(recordStarted([], { id: 'r1', imageTag: 'dpl-a', cause: 'deploy', createdAt: at, healthPath: null }), 'r1', now, true)
  history = recordLive(recordStarted(history, { id: 'r2', imageTag: 'dpl-b', cause: 'deploy', createdAt: at, healthPath: null }), 'r2', now, true)
  assert.deepEqual(history.map((entry) => [entry.id, entry.live, entry.served]), [['r2', true, true], ['r1', false, true]])
  assert.deepEqual(rollbackCandidates(history, 'r2').map((entry) => entry.id), ['r1'])
})

// A failed deployment must not take live away from the one still serving, or
// rollback would report nothing live while traffic is flowing.
test('a failed health check leaves the previous deployment live and is never a rollback target', () => {
  let history = recordLive(recordStarted([], { id: 'r1', imageTag: 'dpl-a', cause: 'deploy', createdAt: at, healthPath: null }), 'r1', now, true)
  history = recordFailed(recordStarted(history, { id: 'r2', imageTag: 'dpl-b', cause: 'deploy', createdAt: at, healthPath: null }), 'r2', 'failed health check')
  assert.equal(history.find((entry) => entry.live)?.id, 'r1')
  assert.equal(history[0].cause, 'deploy, failed health check')
  assert.deepEqual(rollbackCandidates(history, 'r1'), [])
})

test('a rollback is a new deployment of an old image, recorded with its cause', () => {
  let history = recordLive(recordStarted([], { id: 'r1', imageTag: 'dpl-a', cause: 'deploy', createdAt: at, healthPath: null }), 'r1', now, true)
  history = recordLive(recordStarted(history, { id: 'r2', imageTag: 'dpl-b', cause: 'deploy', createdAt: at, healthPath: null }), 'r2', now, true)
  history = recordLive(recordStarted(history, { id: 'r3', imageTag: 'dpl-a', cause: 'rollback to r1', createdAt: at, healthPath: null }), 'r3', now, true)
  assert.deepEqual(history.map((entry) => entry.live), [true, false, false])
  assert.equal(history[0].imageTag, 'dpl-a')
})

test('marking an unknown deployment live is a defect, not a silent no-op', () => {
  assert.throws(() => recordLive([], 'r9', now, true), /not in the history/)
})

test('the history round-trips, and a damaged file is refused rather than replaced', () => {
  const history = recordLive(recordStarted([], { id: 'r1', imageTag: 'dpl-a', cause: 'deploy', createdAt: at, healthPath: null }), 'r1', now, true)
  assert.deepEqual(parseDeployments(serializeDeployments(history)), history)
  assert.deepEqual(parseDeployments(''), [])
  assert.throws(() => parseDeployments('{'), /not valid JSON/)
  assert.throws(() => parseDeployments('{}'), /not a list/)
  assert.throws(() => parseDeployments('[{"id":"r1"}]'), /unreadable entry at position 1/)
  // A history written before healthPath and keptUntil were recorded still reads.
  const { healthPath: _health, keptUntil: _kept, ...older } = history[0]
  assert.equal(parseDeployments(JSON.stringify([older]))[0].healthPath, null)
  assert.equal(parseDeployments(JSON.stringify([older]))[0].keptUntil, null)
})

test('release ids are unique per release even for the same image, and valid container name suffixes', () => {
  const a = newReleaseId(now)
  assert.notEqual(a, newReleaseId(now))
  assert.match(a, /^r20260915-100000-[0-9a-f]{6}$/)
})

test('images kept are the live one and the newest served ones, never a failed one', () => {
  let history: ReturnType<typeof recordStarted> = []
  for (const [id, tag] of [['r1', 'a'], ['r2', 'b'], ['r3', 'c'], ['r4', 'd']]) {
    history = recordLive(recordStarted(history, { id, imageTag: tag, cause: 'deploy', createdAt: at, healthPath: null }), id, now, true)
  }
  history = recordFailed(recordStarted(history, { id: 'r5', imageTag: 'broken', cause: 'deploy', createdAt: at, healthPath: null }), 'r5', 'failed')
  assert.deepEqual([...imagesToKeep(history, 2)].sort(), ['c', 'd'])

  // Rolled back to the oldest: it is live, so it is kept even beyond the count, and
  // so is the one it replaced, whose container keeps running for its tabs.
  history = recordLive(recordStarted(history, { id: 'r6', imageTag: 'a', cause: 'rollback to r1', createdAt: at, healthPath: null }), 'r6', now, true)
  assert.deepEqual([...imagesToKeep(history, 1)].sort(), ['a', 'd'])
  assert.ok(!imagesToKeep(history, 10).has('broken'))
})

const start = (history: ReturnType<typeof recordStarted>, id: string, imageTag: string) =>
  recordStarted(history, { id, imageTag, cause: 'deploy', createdAt: at, healthPath: null })

// The defect this prevents: a tab loaded before a deployment asking the new
// container for its build's files and Server Actions, which only the old one has.
test('a new build keeps the one it replaced for an hour, and no other', () => {
  let history = recordLive(start([], 'r1', 'dpl-a'), 'r1', now, true)
  history = recordLive(start(history, 'r2', 'dpl-b'), 'r2', now, true)
  assert.equal(previousServing(history, now)?.id, 'r1')
  assert.equal(history.find((entry) => entry.id === 'r1')?.keptUntil, new Date(now.getTime() + PREVIOUS_KEPT_MS).toISOString())
  history = recordLive(start(history, 'r3', 'dpl-c'), 'r3', now, true)
  assert.deepEqual(history.filter((entry) => entry.keptUntil !== null).map((entry) => entry.id), ['r2'])
  assert.equal(previousServing(history, new Date(now.getTime() + PREVIOUS_KEPT_MS + 1)), null, 'nothing is kept once its hour is over')
})

// Both containers would answer to one deployment id, so routing by it would send
// every tab, new ones too, to the container being replaced.
test('the same build started again is not kept, and does not end a keep already running', () => {
  let history = recordLive(start([], 'r1', 'dpl-a'), 'r1', now, true)
  history = recordLive(start(history, 'r2', 'dpl-b'), 'r2', now, true)
  const later = new Date(now.getTime() + 60_000)
  history = recordLive(start(history, 'r3', 'dpl-b'), 'r3', later, true)
  assert.equal(previousServing(history, later)?.id, 'r1')
  assert.equal(history.find((entry) => entry.id === 'r1')?.keptUntil, new Date(now.getTime() + PREVIOUS_KEPT_MS).toISOString())
})

// An instant rollback: the kept deployment becomes live again without a new
// container, and the one it replaces is kept in its place.
test('going back to the kept deployment makes it live and keeps the one it replaces', () => {
  let history = recordLive(start([], 'r1', 'dpl-a'), 'r1', now, true)
  history = recordLive(start(history, 'r2', 'dpl-b'), 'r2', now, true)
  history = recordLive(history, 'r1', now, true)
  assert.equal(history.find((entry) => entry.live)?.id, 'r1')
  assert.equal(previousServing(history, now)?.id, 'r2')
  assert.equal(history.filter((entry) => entry.keptUntil !== null).length, 1)
})

// A server set up before the retire timer existed has nothing to stop a kept
// container, which would run with its whole memory limit until the next deployment.
test('on a server with no retire timer, a new build keeps nothing', () => {
  let history = recordLive(start([], 'r1', 'dpl-a'), 'r1', now, false)
  history = recordLive(start(history, 'r2', 'dpl-b'), 'r2', now, false)
  assert.equal(previousServing(history, now), null)
  assert.ok(history.every((entry) => entry.keptUntil === null))
  assert.equal(history.find((entry) => entry.live)?.id, 'r2')
})
