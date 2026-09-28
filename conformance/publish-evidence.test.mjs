/**
 * Tests for what the nightly run publishes to the site.
 *
 * Each case is a way the published evidence could say something the run did not
 * show: a run that scored nothing reading as a result, a missing version, a rerun
 * counted twice, or a history that grows without end.
 *
 * Run with: node --test conformance/*.test.mjs
 * Author: Ragul D
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { HISTORY_LENGTH, appendHistory, nightlyRecord } from './publish-evidence.mjs'

const summary = {
  suites: { total: 1123, passed: 1121, failed: 2 },
  assertions: { passed: 3590, failed: 9 },
  failing: [
    { name: 'test/e2e/a.test.ts', passed: 1, failed: 5, failures: ['x'] },
    { name: 'test/e2e/b.test.ts', passed: 0, failed: 4, failures: ['y'] },
  ],
}
const meta = { date: '2026-09-29T03:40:00.000Z', version: '16.5.0-canary.3', sha: 'abc123', runUrl: 'https://github.com/gowtham472/nextship/actions/runs/1' }

test('a run is published with its totals, its Next.js version and the names of what failed', () => {
  assert.deepEqual(nightlyRecord(summary, meta), {
    date: meta.date,
    nextjs: { version: '16.5.0-canary.3', sha: 'abc123' },
    run: meta.runUrl,
    suites: { passed: 1121, total: 1123 },
    assertions: { passed: 3590, total: 3599 },
    failing: ['test/e2e/a.test.ts', 'test/e2e/b.test.ts'],
  })
})

test('a run that scored no suites is refused, so "0 of 0" is never shown as a result', () => {
  assert.throws(() => nightlyRecord({ ...summary, suites: { total: 0, passed: 0, failed: 0 } }, meta), /scored no suites/)
})

test('a run without its Next.js version is refused rather than published unlabelled', () => {
  assert.throws(() => nightlyRecord(summary, { ...meta, version: undefined }), /version is not set/)
})

test('a second run on the same day replaces that day, and history keeps only the newest', () => {
  const record = nightlyRecord(summary, meta)
  const rerun = { ...record, date: '2026-09-29T09:00:00.000Z', suites: { passed: 1123, total: 1123 } }
  const history = appendHistory(appendHistory([], record), rerun)
  assert.equal(history.length, 1)
  assert.equal(history[0].suites.passed, 1123)

  const long = Array.from({ length: HISTORY_LENGTH }, (_, i) => ({ ...history[0], date: `2026-01-${String(i + 1).padStart(2, '0')}T03:00:00Z` }))
  const next = appendHistory(long, record)
  assert.equal(next.length, HISTORY_LENGTH)
  assert.equal(next.at(-1).date, meta.date)
  assert.equal(next[0].date, long[1].date)
})
