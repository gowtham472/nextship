/**
 * nextship-loadtest: the plan for one test
 *
 * Turns what the user typed into the load that will be sent: a target, and a
 * staircase of steps, each holding more users at once than the last. A staircase
 * rather than one flat load, because the question is where a site stops coping,
 * and only a rising load shows the step where it did.
 *
 * Every number is checked here, so nothing unvalidated reaches the k6 script.
 *
 * Author: Gowtham
 */

import { LoadtestError } from './errors.js'

export const DEFAULT_USERS = 50
export const DEFAULT_SECONDS = 60

/**
 * One machine running k6 beside everything else cannot reliably hold more, and a
 * number typed by mistake should not become a flood.
 */
export const MAX_USERS = 1000
export const MIN_SECONDS = 10
export const MAX_SECONDS = 600

/** Enough steps to see a trend, few enough that each lasts long enough to measure. */
const STEP_COUNT = 5

export interface Step {
  /** Users requesting at once during this step. */
  users: number
  seconds: number
}

export interface Plan {
  /** The target as k6 will request it. */
  url: string
  steps: Step[]
}

/** The length of the whole run, which is what the user is told to expect. */
export function totalSeconds(plan: Plan): number {
  return plan.steps.reduce((sum, entry) => sum + entry.seconds, 0)
}

export function planFor(target: string, options: { users: string | null; duration: string | null }): Plan {
  const users = options.users === null ? DEFAULT_USERS : wholeNumber('--users', options.users, 1, MAX_USERS)
  const seconds =
    options.duration === null ? DEFAULT_SECONDS : wholeNumber('--duration', options.duration, MIN_SECONDS, MAX_SECONDS)

  const count = Math.min(STEP_COUNT, users)
  const each = Math.floor(seconds / count)
  const steps = Array.from({ length: count }, (_, index) => ({
    users: Math.round((users * (index + 1)) / count),
    seconds: each,
  }))
  return { url: targetUrl(target), steps }
}

function targetUrl(target: string): string {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    throw new LoadtestError(
      `"${target}" is not a URL.`,
      'Give the full address, such as https://example.com/ or http://localhost:3000/.'
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LoadtestError(
      `"${target}" is not an http or https address.`,
      'Give an address that starts with http:// or https://.'
    )
  }
  if (url.username !== '' || url.password !== '') {
    throw new LoadtestError(
      'The address carries a username or password, which this command would print in its plan and pass on a command line.',
      'Test an address that needs no credentials in it.'
    )
  }
  return url.href
}

function wholeNumber(flag: string, value: string, minimum: number, maximum: number): number {
  const number = Number(value)
  if (!/^\d+$/.test(value) || number < minimum || number > maximum) {
    throw new LoadtestError(
      `${flag} must be a whole number from ${minimum} to ${maximum}, not "${value}".`,
      flag === '--users'
        ? 'For a heavier test than that, run k6 directly on a machine sized for it.'
        : 'Give the length of the whole test in seconds.'
    )
  }
  return number
}
