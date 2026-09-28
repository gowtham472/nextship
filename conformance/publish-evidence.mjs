#!/usr/bin/env node
/**
 * Turns a scored compatibility suite run into the files the site reads.
 *
 * The nightly run against the newest Next.js canary is only evidence if someone can
 * see it without opening GitHub Actions, so its score is written to the `evidence`
 * branch, which the site's evidence page reads in the browser. `latest.json` is the
 * last run; `history.json` keeps the last ninety, so a regression shows as a drop on
 * a date rather than as a number that quietly changed. A run that scored no suite at
 * all is refused rather than published, because "0 of 0" would read as a result.
 *
 * Usage: node publish-evidence.mjs <summary.json> <evidence directory>
 * Reads NEXTJS_VERSION, NEXTJS_SHA and RUN_URL from the environment, and writes
 * latest.json and history.json into the directory, keeping the history already there.
 *
 * Author: Ragul D
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HISTORY_LENGTH = 90

/** The published record of one run. Only the names of failing suites, so the file stays small. */
export function nightlyRecord(summary, meta) {
  if (!summary?.suites?.total) {
    throw new Error('The run scored no suites, so there is nothing to publish. Check the test jobs of this run for why none reported.')
  }
  for (const [name, value] of Object.entries(meta)) {
    if (!value) throw new Error(`${name} is not set. The workflow passes it from the build job; check that step's output.`)
  }
  return {
    date: meta.date,
    nextjs: { version: meta.version, sha: meta.sha },
    run: meta.runUrl,
    suites: { passed: summary.suites.passed, total: summary.suites.total },
    assertions: { passed: summary.assertions.passed, total: summary.assertions.passed + summary.assertions.failed },
    failing: summary.failing.map((suite) => suite.name),
  }
}

/** The history with this run appended, one entry per date, the newest last, at most HISTORY_LENGTH long. */
export function appendHistory(history, record) {
  const entry = {
    date: record.date,
    version: record.nextjs.version,
    suites: record.suites,
    assertions: record.assertions,
  }
  // A run started again on the same day replaces that day's entry rather than
  // counting twice.
  const day = (date) => date.slice(0, 10)
  return [...history.filter((previous) => day(previous.date) !== day(entry.date)), entry].slice(-HISTORY_LENGTH)
}

async function main() {
  const [summaryPath, directory] = process.argv.slice(2)
  if (!summaryPath || !directory) {
    console.error('usage: node publish-evidence.mjs <summary.json> <evidence directory>')
    process.exit(2)
  }
  const summary = JSON.parse(await readFile(summaryPath, 'utf8'))
  const record = nightlyRecord(summary, {
    date: new Date().toISOString(),
    version: process.env.NEXTJS_VERSION,
    sha: process.env.NEXTJS_SHA,
    runUrl: process.env.RUN_URL,
  })

  const historyPath = path.join(directory, 'history.json')
  let history = []
  try {
    history = JSON.parse(await readFile(historyPath, 'utf8'))
  } catch (error) {
    // Only a first publish has no history. A file that exists but cannot be read is
    // stopped on, since writing over it would erase every earlier night.
    if (error.code !== 'ENOENT') throw error
  }

  await writeFile(path.join(directory, 'latest.json'), JSON.stringify(record, null, 2) + '\n')
  await writeFile(historyPath, JSON.stringify(appendHistory(history, record), null, 2) + '\n')
  console.log(`Published ${record.suites.passed} of ${record.suites.total} suites on Next.js ${record.nextjs.version}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
