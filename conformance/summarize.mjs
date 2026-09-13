#!/usr/bin/env node
/**
 * Scores a compatibility suite run from the Jest results files the harness writes.
 *
 * With NEXT_TEST_JOB set, Next.js's test runner writes `<suite>.results.json` for
 * every suite, passing or failing, overwriting it on each retry, so the file left is
 * the final attempt. The logs only print failing suites, which made an exact total
 * impossible to recover from them; these files carry it.
 *
 * Two scores are reported, because they answer different questions. Suites is the
 * strict one: a suite with one failing assertion counts as failed. Assertions is
 * the one Next.js's adapters support page publishes, passed over passed plus failed,
 * with assertions the manifest skips left out of both.
 *
 * Usage: node summarize.mjs <directory of results files> [summary.json]
 * Prints Markdown for the job summary; writes the full result as JSON when a second
 * path is given.
 *
 * Author: Gowtham
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [directory, jsonOut] = process.argv.slice(2)
if (!directory) {
  console.error('usage: node summarize.mjs <results directory> [summary.json]')
  process.exit(2)
}

async function* resultFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* resultFiles(full)
    else if (entry.name.endsWith('.results.json')) yield full
  }
}

const suites = []
for await (const file of resultFiles(directory)) {
  let result
  try {
    result = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    // A results file cut short by a killed job is a suite whose outcome is unknown,
    // which is reported rather than silently dropped from the denominator.
    suites.push({ name: path.relative(directory, file), unreadable: String(error), passed: 0, failed: 0, failures: [] })
    continue
  }

  for (const suite of result.testResults ?? []) {
    const assertions = suite.assertionResults ?? []
    const name = suite.name.replace(/^.*?(?=test\/)/, '')
    const failures = assertions.filter((a) => a.status === 'failed').map((a) => a.fullName ?? a.title)
    suites.push({
      name,
      passed: assertions.filter((a) => a.status === 'passed').length,
      failed: failures.length,
      // A suite can fail without a single failing assertion: a build that breaks in
      // beforeAll, or a crash outside any test. Jest marks those as failed suites.
      suiteFailed: suite.status === 'failed',
      failures,
    })
  }
}

const failingSuites = suites.filter((s) => s.unreadable || s.suiteFailed || s.failed > 0)
const passedAssertions = suites.reduce((sum, s) => sum + s.passed, 0)
const failedAssertions = suites.reduce((sum, s) => sum + s.failed, 0)
const percent = (part, whole) => (whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)}%`)

const summary = {
  suites: { total: suites.length, passed: suites.length - failingSuites.length, failed: failingSuites.length },
  assertions: { passed: passedAssertions, failed: failedAssertions },
  failing: failingSuites
    .sort((a, b) => b.failed - a.failed || a.name.localeCompare(b.name))
    .map(({ name, passed, failed, failures, unreadable }) => ({ name, passed, failed, failures, ...(unreadable ? { unreadable } : {}) })),
}

const lines = [
  '## Compatibility suite',
  '',
  '| | Passed | Total | Rate |',
  '|---|---|---|---|',
  `| Suites | ${summary.suites.passed} | ${summary.suites.total} | ${percent(summary.suites.passed, summary.suites.total)} |`,
  `| Assertions | ${passedAssertions} | ${passedAssertions + failedAssertions} | ${percent(passedAssertions, passedAssertions + failedAssertions)} |`,
  '',
]
if (summary.failing.length > 0) {
  lines.push(`### ${summary.failing.length} failing suite(s)`, '')
  for (const suite of summary.failing) {
    lines.push(`- \`${suite.name}\`: ${suite.failed} failed, ${suite.passed} passed${suite.unreadable ? ' (results unreadable)' : ''}`)
    for (const failure of suite.failures.slice(0, 5)) lines.push(`  - ${failure}`)
    if (suite.failures.length > 5) lines.push(`  - and ${suite.failures.length - 5} more`)
  }
}
console.log(lines.join('\n'))

if (jsonOut) await writeFile(jsonOut, JSON.stringify(summary, null, 2) + '\n')
