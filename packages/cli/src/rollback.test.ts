/**
 * Tests for rollback target selection.
 *
 * These exist because of a real failure: only `ACTIVE` deployments were treated
 * as rollback targets, but a deployment that has been replaced reports
 * `SUPERSEDED`. The effect was that rollback always claimed there was nothing to
 * roll back to, even with a healthy previous deployment in the history.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rollbackCandidates } from './rollback.js'
import type { DeploymentRecord } from './targets/target.js'

/**
 * `served` is what the driver reports, having already translated its platform's
 * phases. The test names the phase it stands for so the origin of the rule stays
 * readable.
 */
const deployment = (id: string, phase: string, createdAt = '2026-09-08T00:00:00Z'): DeploymentRecord => ({
  id,
  served: phase === 'ACTIVE' || phase === 'SUPERSEDED',
  live: phase === 'ACTIVE',
  cause: 'test',
  createdAt,
  imageTag: `dpl-${id}`,
})

test('a superseded deployment is a valid rollback target', () => {
  const history = [deployment('new', 'ACTIVE'), deployment('old', 'SUPERSEDED')]
  const candidates = rollbackCandidates(history, 'new')

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].id, 'old')
})

test('the live deployment is never offered as its own target', () => {
  const history = [deployment('live', 'ACTIVE'), deployment('old', 'SUPERSEDED')]
  assert.ok(!rollbackCandidates(history, 'live').some((d) => d.id === 'live'))
})

test('deployments that never served are excluded', () => {
  const history = [
    deployment('live', 'ACTIVE'),
    deployment('broken', 'ERROR'),
    deployment('stopped', 'CANCELED'),
    deployment('building', 'BUILDING'),
    deployment('good', 'SUPERSEDED'),
  ]
  const candidates = rollbackCandidates(history, 'live')

  assert.deepEqual(candidates.map((d) => d.id), ['good'], 'only a deployment that actually ran is a target')
})

test('order is preserved, so the newest previous deployment is the default', () => {
  const history = [
    deployment('live', 'ACTIVE', '2026-09-08T03:00:00Z'),
    deployment('recent', 'SUPERSEDED', '2026-09-08T02:00:00Z'),
    deployment('older', 'SUPERSEDED', '2026-09-08T01:00:00Z'),
  ]
  assert.equal(rollbackCandidates(history, 'live')[0].id, 'recent')
})

test('an app with a single deployment offers nothing', () => {
  assert.deepEqual(rollbackCandidates([deployment('only', 'ACTIVE')], 'only'), [])
})
