/**
 * @nextship/cli: a release is told to stop, not killed
 *
 * The defect was a process that died holding a server's deploy lock because the
 * terminal closed. The first tests pin the mechanism in this process. The last one
 * runs a real process and sends it real signals, because the whole point is what
 * the operating system does to a process that does not listen: in that test the
 * child gives its "lock" back only if it outlives the signal.
 *
 * Author: Gowtham
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { STOP_SIGNALS, untilStopped } from './interrupt.js'

const listeners = (): number[] => STOP_SIGNALS.map((name) => process.listenerCount(name))

for (const name of STOP_SIGNALS) {
  test(`${name} aborts the work's signal instead of ending the process`, async () => {
    const before = listeners()
    const result = await untilStopped(async (signal) => {
      assert.equal(signal.aborted, false)
      process.emit(name)
      return signal.aborted
    })
    assert.equal(result, true)
    assert.deepEqual(listeners(), before, 'the listeners are removed afterwards')
  })
}

test('a stop that arrives before the work looks is still there when it does', async () => {
  const seen = await untilStopped(async (signal) => {
    process.emit('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 20))
    return signal.aborted
  })
  assert.equal(seen, true)
})

test('work that throws still has its listeners removed', async () => {
  const before = listeners()
  await assert.rejects(
    untilStopped(async () => {
      throw new Error('the release failed')
    }),
    /the release failed/
  )
  assert.deepEqual(listeners(), before)
})

test('after a stop, a failed write to the terminal no longer ends the process', async () => {
  const before = process.stdout.listenerCount('error')
  await untilStopped(async () => {
    process.emit('SIGHUP')
    assert.equal(process.stdout.listenerCount('error'), before + 1)
    assert.equal(process.stderr.listenerCount('error') > 0, true)
  })
  assert.equal(process.stdout.listenerCount('error'), before)
})

test('with no stop, the result is returned and nothing is aborted', async () => {
  assert.equal(await untilStopped(async (signal) => (signal.aborted ? 'stopped' : 'finished')), 'finished')
})

/**
 * A process that takes a lock, waits, and gives the lock back when told to stop.
 * It reports in a file, since after a hangup there may be no terminal to print to.
 */
const HOLDER = `
import { writeFileSync } from 'node:fs'
const { untilStopped } = await import(process.argv[2])
const report = process.argv[3]
await untilStopped(async (signal) => {
  writeFileSync(report, 'locked')
  // A release always has something open, an ssh process at least. A timer stands in
  // for it here: with nothing open, Node would exit before any signal arrived.
  const open = setInterval(() => {}, 1000)
  await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
  clearInterval(open)
  // What a real release does on the way out takes a moment and prints as it goes.
  await new Promise((resolve) => setTimeout(resolve, 150))
  console.log('giving the lock back')
  writeFileSync(report, 'released')
})
`

for (const name of ['SIGHUP', 'SIGTERM', 'SIGINT'] as const) {
  // Windows has no signals to send another process: `kill` there ends it outright,
  // which is what closing a console does ten seconds after delivering SIGHUP.
  test(`a real process sent ${name} gives its lock back before it exits`, { skip: process.platform === 'win32' }, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'nextship-interrupt-'))
    try {
      const script = path.join(directory, 'holder.mjs')
      const report = path.join(directory, 'report')
      writeFileSync(script, HOLDER)
      const module = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'interrupt.js')).href

      const child = spawn(process.execPath, [script, module, report], { stdio: 'ignore' })
      const exited = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)))
      for (let waited = 0; waited < 5000; waited += 25) {
        try {
          if (readFileSync(report, 'utf8') === 'locked') break
        } catch {
          // Not written yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      assert.equal(readFileSync(report, 'utf8'), 'locked', 'the process took its lock')

      child.kill(name)
      assert.equal(await exited, 0, 'it exited on its own, not by the signal')
      assert.equal(readFileSync(report, 'utf8'), 'released')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
