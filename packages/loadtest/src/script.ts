/**
 * nextship-loadtest: the k6 script for a plan
 *
 * k6 runs a JavaScript file. This writes it, so nobody using the command has to.
 * Each step of the plan is its own k6 scenario, started when the one before ends,
 * because k6 reports figures per scenario only for a scenario a threshold names.
 * The thresholds here can never fail: they exist to make k6 keep the figures of
 * each step apart, which is the only way to see which step a site stopped coping at.
 *
 * The target is read from the environment and the numbers come from a validated
 * plan, so nothing the user typed is ever interpolated into the script.
 *
 * Author: Gowtham
 */

import type { Plan } from './plan.js'

/** The scenario name of a step, which the report reads the figures back by. */
export const scenarioName = (index: number): string => `step${index + 1}`

export function renderScript(plan: Plan): string {
  let startsAt = 0
  const scenarios: Record<string, unknown> = {}
  const thresholds: Record<string, string[]> = {}

  plan.steps.forEach((entry, index) => {
    const name = scenarioName(index)
    scenarios[name] = {
      executor: 'constant-vus',
      vus: entry.users,
      duration: `${entry.seconds}s`,
      startTime: `${startsAt}s`,
      // A request still in flight when a step ends would otherwise run into the
      // next step and be counted against it.
      gracefulStop: '0s',
    }
    thresholds[`http_req_duration{scenario:${name}}`] = ['max>=0']
    thresholds[`http_req_failed{scenario:${name}}`] = ['rate>=0']
    thresholds[`http_reqs{scenario:${name}}`] = ['count>=0']
    startsAt += entry.seconds
  })

  const options = { scenarios, thresholds, summaryTrendStats: ['med', 'p(95)'] }
  return [
    "import http from 'k6/http'",
    `export const options = ${JSON.stringify(options, null, 2)}`,
    'export default function () {',
    '  http.get(__ENV.TARGET)',
    '}',
    // The summary goes to stdout as JSON for the report to read, in place of the
    // text summary k6 prints by default.
    'export function handleSummary(data) {',
    '  return { stdout: JSON.stringify(data) }',
    '}',
    '',
  ].join('\n')
}
