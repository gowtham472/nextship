/**
 * @nextship/cli: tests for choosing the Server Actions key for a server
 *
 * Every row of the decision table is a case here, because the one outcome that
 * must never happen is a key changing without anyone deciding it should.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NextshipError } from '../../errors.js'
import { decideKey } from './actions-key.js'

test('the environment variable wins, and warns only when it differs from the server', () => {
  assert.deepEqual(decideKey({ environment: 'E', server: null, local: 'L' }), { action: 'use', key: 'E', source: 'environment', warning: null })
  assert.deepEqual(decideKey({ environment: 'E', server: 'E', local: null }), { action: 'use', key: 'E', source: 'environment', warning: null })
  const differs = decideKey({ environment: 'E', server: 'S', local: null })
  assert.equal(differs.action, 'use')
  assert.match((differs as { warning: string }).warning, /differs from the key stored on the server/)
})

test("the server's key is used when this machine has none", () => {
  assert.deepEqual(decideKey({ environment: undefined, server: 'S', local: null }), { action: 'use', key: 'S', source: 'server', warning: null })
})

test('a local key the server lacks is uploaded rather than replaced by a new one', () => {
  assert.deepEqual(decideKey({ environment: undefined, server: null, local: 'L' }), { action: 'upload', key: 'L' })
})

test('matching keys on both sides are simply used', () => {
  assert.deepEqual(decideKey({ environment: undefined, server: 'K', local: 'K' }), { action: 'use', key: 'K', source: 'server', warning: null })
})

test('different keys on the server and here are refused, since either choice breaks open pages', () => {
  assert.throws(
    () => decideKey({ environment: undefined, server: 'S', local: 'L' }),
    (error: unknown) => error instanceof NextshipError && /differs/.test(error.message) && /NEXT_SERVER_ACTIONS_ENCRYPTION_KEY/.test(error.action)
  )
})

test('with no key anywhere, one is generated once, for the server only', () => {
  assert.deepEqual(decideKey({ environment: undefined, server: null, local: null }), { action: 'generate' })
})
