/**
 * nextship-loadtest: what a plan is built from
 *
 * The plan is the only place user input becomes numbers, so each test pins either
 * the staircase a valid input produces or the refusal an invalid one gets.
 *
 * Author: Gowtham
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { LoadtestError } from './errors.js'
import { planFor, totalSeconds } from './plan.js'

const defaults = { users: null, duration: null }

test('the default plan climbs to 50 users in five steps over a minute', () => {
  const plan = planFor('https://example.com', defaults)
  assert.equal(plan.url, 'https://example.com/')
  assert.deepEqual(plan.steps.map((entry) => entry.users), [10, 20, 30, 40, 50])
  assert.deepEqual(plan.steps.map((entry) => entry.seconds), [12, 12, 12, 12, 12])
  assert.equal(totalSeconds(plan), 60)
})

test('fewer users than steps gives one step per user', () => {
  const plan = planFor('http://localhost:3000/', { users: '3', duration: '30' })
  assert.deepEqual(plan.steps, [
    { users: 1, seconds: 10 },
    { users: 2, seconds: 10 },
    { users: 3, seconds: 10 },
  ])
})

test('the last step always reaches the users asked for, whatever the rounding', () => {
  const plan = planFor('http://localhost:3000/', { users: '7', duration: '23' })
  assert.deepEqual(plan.steps.map((entry) => entry.users), [1, 3, 4, 6, 7])
  // 23 s does not divide by five, so the run is the 20 s the steps add up to.
  assert.equal(totalSeconds(plan), 20)
})

test('the path and query of the address are kept', () => {
  assert.equal(planFor('https://example.com/shop?page=2', defaults).url, 'https://example.com/shop?page=2')
})

for (const [users, why] of [
  ['0', 'zero'],
  ['1001', 'over the limit'],
  ['12.5', 'a fraction'],
  ['-4', 'negative'],
  ['many', 'not a number'],
  ['1e2', 'an exponent'],
] as const) {
  test(`--users ${users} is refused: ${why}`, () => {
    assert.throws(() => planFor('https://example.com', { users, duration: null }), (error: unknown) => {
      assert.ok(error instanceof LoadtestError)
      assert.match(error.message, /--users must be a whole number from 1 to 1000/)
      return true
    })
  })
}

for (const duration of ['9', '601', '30s']) {
  test(`--duration ${duration} is refused`, () => {
    assert.throws(() => planFor('https://example.com', { users: null, duration }), (error: unknown) => {
      assert.ok(error instanceof LoadtestError)
      assert.match(error.message, /--duration must be a whole number from 10 to 600/)
      return true
    })
  })
}

test('something that is not a URL is refused with an example of one', () => {
  assert.throws(() => planFor('example', defaults), (error: unknown) => {
    assert.ok(error instanceof LoadtestError)
    assert.match(error.action, /https:\/\/example\.com\//)
    return true
  })
})

test('an address that is not http or https is refused', () => {
  assert.throws(() => planFor('ftp://example.com', defaults), /not an http or https address/)
})

test('an address carrying credentials is refused, since the plan would print them', () => {
  assert.throws(() => planFor('https://user:secret@example.com', defaults), (error: unknown) => {
    assert.ok(error instanceof LoadtestError)
    assert.doesNotMatch(error.message, /secret/)
    return true
  })
})
