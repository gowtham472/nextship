/**
 * Tests for image retention.
 *
 * The fixtures mirror what a real registry returns, because the shape is the
 * whole problem: a tag points to an index, and the index's platform manifests
 * are reported as untagged. Two opposite mistakes are possible, and both destroy
 * something, so both are pinned here. Deleting only tags reclaims nothing.
 * Deleting every untagged manifest deletes the running deployment.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderForDeletion, planPrune } from './images.js'
import { NextshipError } from './errors.js'
import type { ImageRecord } from './targets/target.js'

const MIB = 1048576

/** An index plus the platform manifest and attestation it references. */
function deployment(tag: string, day: number): ImageRecord[] {
  const at = `2026-09-${String(day).padStart(2, '0')}T00:00:00Z`
  return [
    { id: `sha256:index-${tag}`, tags: [tag], children: [`sha256:image-${tag}`, `sha256:att-${tag}`], sizeBytes: 3886, updatedAt: at },
    { id: `sha256:image-${tag}`, tags: [], children: [], sizeBytes: 182 * MIB, updatedAt: at },
    { id: `sha256:att-${tag}`, tags: [], children: [], sizeBytes: 1024, updatedAt: at },
  ]
}

const registry = (...tags: Array<[string, number]>): ImageRecord[] =>
  tags.flatMap(([tag, day]) => deployment(tag, day))

test('the image a live tag points to is never removed, though the API reports it untagged', () => {
  const manifests = registry(['new', 9], ['old', 8])
  const plan = planPrune(manifests, 'new', 1)

  const removed = new Set(plan.remove.map((m) => m.id))
  assert.ok(!removed.has('sha256:image-new'), 'this is the image the app is running')
  assert.ok(!removed.has('sha256:att-new'))
  assert.ok(!removed.has('sha256:index-new'))
})

test('an image no retained tag can reach is removed, along with its index', () => {
  const plan = planPrune(registry(['new', 9], ['old', 8]), 'new', 1)

  assert.deepEqual(
    plan.remove.map((m) => m.id).sort(),
    ['sha256:att-old', 'sha256:image-old', 'sha256:index-old'],
    'the whole unreachable deployment goes, not just its tag'
  )
  assert.deepEqual(plan.removeTags, ['old'])
})

test('the deployed image is kept even when it falls outside the limit', () => {
  // 'old' is the oldest and would be dropped on age alone, but it is running.
  const plan = planPrune(registry(['new', 9], ['mid', 8], ['old', 7]), 'old', 1)

  const removed = new Set(plan.remove.map((m) => m.id))
  assert.ok(!removed.has('sha256:image-old'), 'pruning the running image breaks the next restart')
  assert.ok(removed.has('sha256:image-mid'), 'the one actually outside the limit still goes')
})

test('reclaimable size counts the images removed, not the tiny index alone', () => {
  const plan = planPrune(registry(['new', 9], ['old', 8]), 'new', 1)

  assert.ok(plan.reclaimableBytes > 181 * MIB, 'a figure near zero would be the index only')
  assert.ok(plan.reclaimableBytes < 183 * MIB)
})

test('nothing is removed when everything is still reachable', () => {
  const plan = planPrune(registry(['new', 9], ['old', 8]), 'new', 5)

  assert.deepEqual(plan.remove, [])
  assert.equal(plan.reclaimableBytes, 0)
})

test('a manifest shared by two retained indexes survives', () => {
  const shared: ImageRecord[] = [
    { id: 'sha256:index-a', tags: ['a'], children: ['sha256:shared'], sizeBytes: 100, updatedAt: '2026-09-09T00:00:00Z' },
    { id: 'sha256:index-b', tags: ['b'], children: ['sha256:shared'], sizeBytes: 100, updatedAt: '2026-09-08T00:00:00Z' },
    { id: 'sha256:shared', tags: [], children: [], sizeBytes: 182 * MIB, updatedAt: '2026-09-08T00:00:00Z' },
  ]

  const plan = planPrune(shared, 'a', 1)
  const removed = new Set(plan.remove.map((m) => m.id))

  assert.ok(removed.has('sha256:index-b'), 'the unreachable index goes')
  assert.ok(!removed.has('sha256:shared'), 'but not content the retained tag still needs')
})

test('an orphan left by an earlier tag-only deletion is collected', () => {
  const manifests = [
    ...deployment('live', 9),
    // No tag: what deleting a tag leaves behind, which reclaimed nothing.
    { id: 'sha256:index-orphan', tags: [], children: ['sha256:image-orphan'], sizeBytes: 3886, updatedAt: '2026-09-07T00:00:00Z' },
    { id: 'sha256:image-orphan', tags: [], children: [], sizeBytes: 182 * MIB, updatedAt: '2026-09-07T00:00:00Z' },
  ]

  const plan = planPrune(manifests, 'live', 5)

  assert.deepEqual(
    plan.remove.map((m) => m.id).sort(),
    ['sha256:image-orphan', 'sha256:index-orphan'],
    'a previously untagged deployment is exactly what should be reclaimed'
  )
})

test('an unknown deployed tag still prunes by age rather than refusing', () => {
  const plan = planPrune(registry(['c', 9], ['b', 8], ['a', 7]), null, 1)

  assert.deepEqual(plan.keepTags, ['c'])
  assert.deepEqual(plan.removeTags.sort(), ['a', 'b'])
})

test('an empty repository plans nothing', () => {
  assert.deepEqual(planPrune([], null, 5), { keepTags: [], removeTags: [], remove: [], reclaimableBytes: 0 })
})

test('keeping zero images is refused, because rollback would have no target', () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => planPrune(registry(['a', 9]), 'a', bad),
      (error: unknown) => {
        assert.ok(error instanceof NextshipError)
        assert.match(error.message, /at least 1/)
        return true
      }
    )
  }
})

/**
 * Deletion order.
 *
 * Found by the registry refusing a delete: "manifest is referenced by one or
 * more other manifests". An orphaned index and its images are removed together,
 * and deleting a child first fails.
 */
test('an index is deleted before the images it references', () => {
  const orphan: ImageRecord[] = [
    { id: 'sha256:image', tags: [], children: [], sizeBytes: 182 * MIB, updatedAt: '2026-09-07T00:00:00Z' },
    { id: 'sha256:index', tags: [], children: ['sha256:image'], sizeBytes: 3886, updatedAt: '2026-09-07T00:00:00Z' },
  ]

  assert.deepEqual(
    orderForDeletion(orphan).map((m) => m.id),
    ['sha256:index', 'sha256:image'],
    'the child cannot go while its parent still points at it'
  )
})

test('ordering handles several independent orphans', () => {
  const many: ImageRecord[] = [
    { id: 'sha256:image-a', tags: [], children: [], sizeBytes: 1, updatedAt: '' },
    { id: 'sha256:index-a', tags: [], children: ['sha256:image-a'], sizeBytes: 1, updatedAt: '' },
    { id: 'sha256:image-b', tags: [], children: [], sizeBytes: 1, updatedAt: '' },
    { id: 'sha256:index-b', tags: [], children: ['sha256:image-b'], sizeBytes: 1, updatedAt: '' },
  ]

  const order = orderForDeletion(many).map((m) => m.id)
  assert.ok(order.indexOf('sha256:index-a') < order.indexOf('sha256:image-a'))
  assert.ok(order.indexOf('sha256:index-b') < order.indexOf('sha256:image-b'))
  assert.equal(order.length, 4, 'every manifest is emitted exactly once')
})

test('ordering emits everything even for a malformed graph', () => {
  const cyclic: ImageRecord[] = [
    { id: 'sha256:a', tags: [], children: ['sha256:b'], sizeBytes: 1, updatedAt: '' },
    { id: 'sha256:b', tags: [], children: ['sha256:a'], sizeBytes: 1, updatedAt: '' },
  ]

  assert.equal(orderForDeletion(cyclic).length, 2, 'a bad graph must not hang the command')
})
