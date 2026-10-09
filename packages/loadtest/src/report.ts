/**
 * nextship-loadtest: reading the result
 *
 * Turns the summary k6 wrote into one row per step, and one sentence: how many
 * users at once the site held. A step is held when at most 1% of its requests
 * failed and 95% of them finished within a second. Both lines are stated in the
 * output, because a result means nothing without the rule that produced it.
 *
 * Requests per second are counted here from the length of each step. k6 gives a
 * rate per scenario too, but divides by the length of the whole run, which
 * understates every step.
 *
 * Author: Gowtham
 */

import { LoadtestError } from './errors.js'
import type { Plan } from './plan.js'
import { scenarioName } from './script.js'

/** The most requests of a step that may fail for the step to count as held. */
export const FAILED_LIMIT = 0.01
/** The time within which 95% of the requests of a step must finish. */
export const P95_LIMIT_MS = 1000

export interface StepResult {
  users: number
  requests: number
  perSecond: number
  /** The share of requests that failed: an error status, or no answer at all. */
  failed: number
  medianMs: number
  p95Ms: number
}

export interface Report {
  /** A header row and one row per step, aligned. */
  table: string[]
  /** The result in one sentence. */
  headline: string
  notes: string[]
}

export function readSummary(summary: string, plan: Plan): StepResult[] {
  let metrics: Record<string, { values?: Record<string, unknown> } | undefined>
  try {
    metrics = (JSON.parse(summary) as { metrics: typeof metrics }).metrics
    if (typeof metrics !== 'object' || metrics === null) throw new Error('no metrics')
  } catch {
    throw unreadable('k6 finished without a summary this command can read')
  }

  return plan.steps.map((entry, index) => {
    const name = scenarioName(index)
    const value = (metric: string, field: string): number => {
      const found = metrics[`${metric}{scenario:${name}}`]?.values?.[field]
      if (typeof found !== 'number') throw unreadable(`the summary has no ${metric} ${field} for step ${index + 1}`)
      return found
    }
    const requests = value('http_reqs', 'count')
    return {
      users: entry.users,
      requests,
      perSecond: requests / entry.seconds,
      failed: value('http_req_failed', 'rate'),
      medianMs: value('http_req_duration', 'med'),
      p95Ms: value('http_req_duration', 'p(95)'),
    }
  })
}

/** Why a step was not held, or null when it was. */
export function struggle(result: StepResult): string | null {
  if (result.requests === 0) return 'no request finished'
  if (result.failed > FAILED_LIMIT) return `${percent(result.failed)} of requests failed`
  if (result.p95Ms > P95_LIMIT_MS) return `95% of requests took up to ${Math.round(result.p95Ms)} ms`
  return null
}

export function report(results: StepResult[]): Report {
  const rows = [
    ['users', 'requests/s', 'median', '95% within', 'failed'],
    ...results.map((result) => [
      String(result.users),
      result.perSecond.toFixed(1),
      `${Math.round(result.medianMs)} ms`,
      `${Math.round(result.p95Ms)} ms`,
      percent(result.failed),
    ]),
  ]
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  const table = rows.map((row) => row.map((cell, column) => cell.padStart(widths[column])).join('   '))

  const rule = `A step is held when at most ${percent(FAILED_LIMIT)} of its requests fail and 95% finish within ${P95_LIMIT_MS} ms.`
  const first = results.findIndex((result) => struggle(result) !== null)
  if (first === -1) {
    return {
      table,
      headline: `Holds ${atOnce(results[results.length - 1].users)}, the most this test tried`,
      notes: [rule, 'Raise --users to look for the limit.'],
    }
  }
  const failing = results[first]
  const reason = `With ${atOnce(failing.users)}, ${struggle(failing)}.`
  if (first > 0) return { table, headline: `Holds ${atOnce(results[first - 1].users)}`, notes: [reason, rule] }
  if (failing.users === 1) return { table, headline: 'Does not hold one user at a time', notes: [reason, rule] }
  return {
    table,
    headline: `Holds fewer than ${atOnce(failing.users)}`,
    notes: [reason, rule, 'Run again with a lower --users to find what it does hold.'],
  }
}

/**
 * Refuses to report on a target that never answered. Every request failing from
 * the first step on says nothing about load: the address is wrong, the site is
 * down, or it cannot be reached from where k6 ran.
 */
export function assertAnswered(results: StepResult[], target: string): void {
  if (results.every((result) => result.requests === 0 || result.failed === 1)) {
    throw new LoadtestError(
      `No request to ${target} succeeded, so there is no result to report.`,
      'Check that the address is right and the site is up, then run the same command again.'
    )
  }
}

const atOnce = (users: number): string => (users === 1 ? '1 user at a time' : `${users} users at once`)

const percent = (share: number): string => `${(share * 100).toFixed(1)}%`

function unreadable(what: string): LoadtestError {
  return new LoadtestError(
    `The test ran, but ${what}.`,
    'This is a defect in nextship-loadtest, or a k6 version it was not written for. Please report it with the k6 version.'
  )
}
