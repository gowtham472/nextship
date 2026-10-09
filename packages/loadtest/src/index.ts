#!/usr/bin/env node
/**
 * nextship-loadtest: entry point
 *
 * One command: give it an address, and it reports how many users at once the
 * site held. It prints the plan and sends nothing until `--yes`, because a load
 * test is real traffic, and against a site that is not yours it is an attack.
 *
 * Author: Gowtham
 */

import { describeEngine, findEngine, invocation, runK6 } from './engine.js'
import { LoadtestError } from './errors.js'
import { detail, fail, ok, step } from './log.js'
import { DEFAULT_SECONDS, DEFAULT_USERS, MAX_SECONDS, MAX_USERS, MIN_SECONDS, planFor, totalSeconds } from './plan.js'
import { assertAnswered, readSummary, report } from './report.js'
import { renderScript } from './script.js'
import { VERSION } from './version.js'

const USAGE = `nextship-loadtest

Usage
  nextship-loadtest <url>          Show the plan for a load test of <url>
  nextship-loadtest <url> --yes    Run it, and report how many users at once it held

Options
  --users <n>         The most users at once, reached in steps (default ${DEFAULT_USERS}, at most ${MAX_USERS})
  --duration <s>      The length of the whole test in seconds (default ${DEFAULT_SECONDS}, ${MIN_SECONDS} to ${MAX_SECONDS})
  --yes               Send the requests. Without it, only the plan is printed
  -h, --help          Show this message
  -v, --version       Show the version

Runs k6, the one on PATH or the official Docker image. Only test a site you own
or have permission to test.
`

interface Arguments {
  url: string
  users: string | null
  duration: string | null
  confirmed: boolean
}

function parse(argv: string[]): Arguments {
  let url: string | null = null
  let users: string | null = null
  let duration: string | null = null
  let confirmed = false

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--yes') {
      confirmed = true
    } else if (token === '--users' || token === '--duration') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new LoadtestError(`${token} needs a value.`, 'Run `nextship-loadtest --help`.')
      }
      if (token === '--users') users = value
      else duration = value
      index += 1
    } else if (token.startsWith('-')) {
      throw new LoadtestError(`Unknown option \`${token}\`.`, 'Run `nextship-loadtest --help`.')
    } else if (url === null) {
      url = token
    } else {
      throw new LoadtestError(`Unexpected argument \`${token}\`.`, 'Give one address. Run `nextship-loadtest --help`.')
    }
  }

  if (url === null) throw new LoadtestError('No address was given.', 'Run `nextship-loadtest <url>`, for example https://example.com/.')
  return { url, users, duration, confirmed }
}

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE)
    return
  }
  if (argv.includes('-v') || argv.includes('--version')) {
    process.stdout.write(`${VERSION}\n`)
    return
  }

  const args = parse(argv)
  const plan = planFor(args.url, { users: args.users, duration: args.duration })
  const engine = await findEngine()
  const run = invocation(engine, plan.url, process.platform)
  const seconds = totalSeconds(plan)

  step('Plan')
  detail(`target     ${plan.url}`)
  if (run.target !== plan.url) detail(`           requested as ${run.target}, the name a container reaches this machine by`)
  detail(
    `load       ${plan.steps.length} step(s) of ${plan.steps[0].seconds} s: ${plan.steps.map((entry) => entry.users).join(', ')} users at once`
  )
  detail('           each user requests the address again as soon as it is answered')
  detail(`engine     ${describeEngine(engine)}`)
  detail(`traffic    real requests to the target for ${seconds} s`)

  if (!args.confirmed) {
    ok('This was a plan only. No request was sent.')
    detail('Only test a site you own or have permission to test. Add --yes to run it.')
    return
  }

  step(`Running, for ${seconds} s`)
  const results = readSummary(await runK6(run, renderScript(plan)), plan)
  assertAnswered(results, run.target)

  step('Result')
  const outcome = report(results)
  for (const line of outcome.table) detail(line)
  ok(outcome.headline)
  for (const note of outcome.notes) detail(note)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof LoadtestError) {
    fail(error.message, error.action)
  } else {
    fail(
      error instanceof Error ? error.message : String(error),
      'This is unexpected. Please report it with the output above.'
    )
  }
  process.exitCode = 1
})
