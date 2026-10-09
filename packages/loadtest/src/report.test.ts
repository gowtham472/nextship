/**
 * nextship-loadtest: from a k6 summary to a result
 *
 * The summaries here have the shape k6 2.3.0 wrote for a script this package
 * rendered, with only the fields the report reads. The headline is the one line
 * most people will act on, so every way it can come out has a test.
 *
 * Author: Gowtham
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { LoadtestError } from './errors.js'
import { planFor } from './plan.js'
import { assertAnswered, readSummary, report, struggle, type StepResult } from './report.js'

/** A summary with one entry per step: requests, failed share, median and 95th percentile. */
function summary(steps: Array<[number, number, number, number]>): string {
  const metrics: Record<string, unknown> = {}
  steps.forEach(([count, failed, med, p95], index) => {
    const tag = `{scenario:step${index + 1}}`
    // k6 divides by the whole run, so its own rate is deliberately wrong here.
    metrics[`http_reqs${tag}`] = { type: 'counter', values: { count, rate: 1 } }
    metrics[`http_req_failed${tag}`] = { type: 'rate', values: { rate: failed, passes: 0, fails: count } }
    metrics[`http_req_duration${tag}`] = { type: 'trend', values: { med, 'p(95)': p95 } }
  })
  return JSON.stringify({ metrics, state: { testRunDurationMs: 1 } })
}

const twoSteps = planFor('https://example.com', { users: '2', duration: '20' })

const held = (users: number): StepResult => ({ users, requests: 500, perSecond: 50, failed: 0, medianMs: 20, p95Ms: 40 })

test('each step is read by its scenario, and requests per second come from its own length', () => {
  const results = readSummary(summary([[300, 0, 31.4, 36.6], [450, 0.02, 40, 80]]), twoSteps)
  assert.deepEqual(results, [
    { users: 1, requests: 300, perSecond: 30, failed: 0, medianMs: 31.4, p95Ms: 36.6 },
    { users: 2, requests: 450, perSecond: 45, failed: 0.02, medianMs: 40, p95Ms: 80 },
  ])
})

test('a summary missing a step is an error, not a row of zeros', () => {
  assert.throws(() => readSummary(summary([[300, 0, 31, 36]]), twoSteps), (error: unknown) => {
    assert.ok(error instanceof LoadtestError)
    assert.match(error.message, /no http_reqs count for step 2/)
    return true
  })
})

test('output that is not a k6 summary is an error', () => {
  for (const output of ['', 'not json', '{"metrics":null}', '[]']) {
    assert.throws(() => readSummary(output, twoSteps), /without a summary this command can read/)
  }
})

test('a step struggles past 1% failed, past a second at the 95th percentile, or with nothing finished', () => {
  assert.equal(struggle(held(10)), null)
  assert.equal(struggle({ ...held(10), failed: 0.01 }), null)
  assert.equal(struggle({ ...held(10), p95Ms: 1000 }), null)
  assert.equal(struggle({ ...held(10), failed: 0.042 }), '4.2% of requests failed')
  assert.equal(struggle({ ...held(10), p95Ms: 1755.6 }), '95% of requests took up to 1756 ms')
  assert.equal(struggle({ ...held(10), requests: 0 }), 'no request finished')
})

test('when every step is held, the headline says so and that the limit was not found', () => {
  const outcome = report([held(10), held(20)])
  assert.equal(outcome.headline, 'Holds 20 users at once, the most this test tried')
  assert.equal(outcome.notes.at(-1), 'Raise --users to look for the limit.')
})

test('the headline is the last step held, and the first note is why the next was not', () => {
  const outcome = report([held(10), held(20), { ...held(30), p95Ms: 1756 }, { ...held(40), failed: 0.5 }])
  assert.equal(outcome.headline, 'Holds 20 users at once')
  assert.equal(outcome.notes[0], 'With 30 users at once, 95% of requests took up to 1756 ms.')
  assert.equal(outcome.notes[1], 'A step is held when at most 1.0% of its requests fail and 95% finish within 1000 ms.')
})

test('a first step that struggles means fewer than its users, with what to do next', () => {
  const outcome = report([{ ...held(10), failed: 0.2 }, held(20)])
  assert.equal(outcome.headline, 'Holds fewer than 10 users at once')
  assert.equal(outcome.notes[0], 'With 10 users at once, 20.0% of requests failed.')
  assert.equal(outcome.notes.at(-1), 'Run again with a lower --users to find what it does hold.')
})

test('a single user that struggles is said plainly, with no lower number to try', () => {
  const outcome = report([{ ...held(1), p95Ms: 4000 }])
  assert.equal(outcome.headline, 'Does not hold one user at a time')
  assert.equal(outcome.notes[0], 'With 1 user at a time, 95% of requests took up to 4000 ms.')
  assert.equal(outcome.notes.length, 2)
})

test('the table has a header and one aligned row per step', () => {
  const { table } = report([held(5), { ...held(100), perSecond: 1234.56, medianMs: 250.4, p95Ms: 1999.5, failed: 0.125 }])
  assert.deepEqual(table, [
    'users   requests/s   median   95% within   failed',
    '    5         50.0    20 ms        40 ms     0.0%',
    '  100       1234.6   250 ms      2000 ms    12.5%',
  ])
})

test('a target that never answered is refused rather than reported', () => {
  const dead = [{ ...held(1), failed: 1, medianMs: 0, p95Ms: 0 }, { ...held(2), requests: 0 }]
  assert.throws(() => assertAnswered(dead, 'http://localhost:9/'), (error: unknown) => {
    assert.ok(error instanceof LoadtestError)
    assert.match(error.message, /No request to http:\/\/localhost:9\/ succeeded/)
    return true
  })
})

test('a target that answered at first and failed under load is reported', () => {
  assert.doesNotThrow(() => assertAnswered([held(1), { ...held(2), failed: 1 }], 'http://localhost:9/'))
})
