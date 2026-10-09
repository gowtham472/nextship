/**
 * nextship-loadtest: the script k6 is given
 *
 * The report can only tell the steps apart if each is its own scenario with its
 * own thresholds, and one step must start when the last ends. These tests read
 * the options back out of the rendered script and check exactly that.
 *
 * Author: Gowtham
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { planFor } from './plan.js'
import { renderScript, scenarioName } from './script.js'

interface Options {
  scenarios: Record<string, { executor: string; vus: number; duration: string; startTime: string; gracefulStop: string }>
  thresholds: Record<string, string[]>
  summaryTrendStats: string[]
}

function optionsOf(script: string): Options {
  const match = /export const options = (\{[\s\S]*?\n\})\n/.exec(script)
  assert.ok(match, 'the script declares its options')
  return JSON.parse(match[1]) as Options
}

test('each step is a scenario that starts when the one before it ends', () => {
  const plan = planFor('https://example.com', { users: '30', duration: '30' })
  const { scenarios } = optionsOf(renderScript(plan))
  assert.deepEqual(Object.keys(scenarios), ['step1', 'step2', 'step3', 'step4', 'step5'])
  assert.deepEqual(
    Object.values(scenarios).map((scenario) => [scenario.vus, scenario.duration, scenario.startTime]),
    [
      [6, '6s', '0s'],
      [12, '6s', '6s'],
      [18, '6s', '12s'],
      [24, '6s', '18s'],
      [30, '6s', '24s'],
    ]
  )
  for (const scenario of Object.values(scenarios)) {
    assert.equal(scenario.executor, 'constant-vus')
    assert.equal(scenario.gracefulStop, '0s')
  }
})

test('every step has the three thresholds that make k6 report it on its own', () => {
  const plan = planFor('https://example.com', { users: '2', duration: '10' })
  const { thresholds, summaryTrendStats } = optionsOf(renderScript(plan))
  for (const index of [0, 1]) {
    const name = scenarioName(index)
    assert.deepEqual(thresholds[`http_req_duration{scenario:${name}}`], ['max>=0'])
    assert.deepEqual(thresholds[`http_req_failed{scenario:${name}}`], ['rate>=0'])
    assert.deepEqual(thresholds[`http_reqs{scenario:${name}}`], ['count>=0'])
  }
  assert.equal(Object.keys(thresholds).length, 6)
  assert.deepEqual(summaryTrendStats, ['med', 'p(95)'])
})

test('the address is never written into the script', () => {
  const script = renderScript(planFor('https://example.com/a"b', { users: null, duration: null }))
  assert.doesNotMatch(script, /example\.com/)
  assert.match(script, /http\.get\(__ENV\.TARGET\)/)
})

test('the summary is handed back as JSON on stdout', () => {
  const script = renderScript(planFor('https://example.com', { users: null, duration: null }))
  assert.match(script, /export function handleSummary\(data\) \{\n {2}return \{ stdout: JSON\.stringify\(data\) \}/)
})
