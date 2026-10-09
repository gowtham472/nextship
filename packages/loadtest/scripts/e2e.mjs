#!/usr/bin/env node
/**
 * Runs the built command for real, against a server on this machine, and fails
 * unless it finds the limit that server was built to have.
 *
 * The server answers one request at a time and takes 25 ms over each, so the time
 * a request waits grows with the users waiting ahead of it: a few users are
 * answered well inside a second, and sixty are not. A correct run therefore holds
 * its first step, fails a later one on response time, and says which. The unit
 * tests cover the arithmetic; this covers what they cannot, that the k6 found on
 * this machine accepts the script and writes a summary the report can read.
 *
 * Usage: node scripts/e2e.mjs <local|docker>
 * The argument is the engine the run must use, so a machine that silently fell
 * back to the other one fails instead of passing for the wrong reason.
 *
 * Author: Gowtham
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const expected = process.argv[2]
if (expected !== 'local' && expected !== 'docker') {
  console.error('usage: node scripts/e2e.mjs <local|docker>')
  process.exit(2)
}

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js')

let queue = Promise.resolve()
const server = createServer((_request, response) => {
  queue = queue.then(() => new Promise((done) => setTimeout(() => done(response.end('ok')), 25)))
})
// Every interface, not loopback alone: a container on Docker Desktop reaches this
// machine through an address that is not 127.0.0.1.
await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve))
const url = `http://127.0.0.1:${server.address().port}/`

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('close', (code) => resolve({ code, output }))
  })
}

const failures = []
const check = (what, passed, output) => {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${what}`)
  if (!passed) failures.push(`${what}\n${output}`)
}

const engine = expected === 'local' ? /engine     k6 \d+\.\d+\.\d+, installed on this machine/ : /engine     k6 in Docker/

const plan = await run([url, '--users', '60', '--duration', '20'])
check('the plan exits 0 and sends nothing', plan.code === 0 && /No request was sent/.test(plan.output), plan.output)
check(`the plan names the ${expected} engine`, engine.test(plan.output), plan.output)

const test = await run([url, '--users', '60', '--duration', '20', '--yes'])
const held = /v Holds (\d+) users at once\n/.exec(test.output)
check('the run exits 0', test.code === 0, test.output)
check('the result has a row for each of the five steps', (test.output.match(/^\s+\d+\s+\d+\.\d\s+\d+ ms\s+\d+ ms\s+\d+\.\d%$/gm) ?? []).length === 5, test.output)
check('it holds a step below 60 users and says which', held !== null && Number(held[1]) < 60, test.output)
check('it says the step after failed on response time', /With \d+ users at once, 95% of requests took up to \d+ ms\./.test(test.output), test.output)

server.close()
// Requests k6 abandoned at the end of a step are still queued in the server.
server.closeAllConnections()

const closed = await run([url, '--users', '2', '--duration', '10', '--yes'])
check('a target that answers nothing is an error with no result', closed.code === 1 && /No request to .* succeeded/.test(closed.output) && !/Holds/.test(closed.output), closed.output)

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n\n${failures.join('\n\n')}`)
  process.exit(1)
}
console.log(`\nnextship-loadtest e2e: passed with the ${expected} engine`)
