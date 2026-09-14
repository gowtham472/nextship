/**
 * @nextship/cli: tests for running two commands as a pipeline
 *
 * The failure this exists to catch is silent: a shell pipeline reports only the
 * last command, so a sender that died part way through looks like a receiver
 * that succeeded. The children here are Node itself, so the tests run the same
 * on every platform.
 *
 * Author: Ragul D
 * Design: ../../../../docs/design.md §9.3
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NextshipError } from '../errors.js'
import { pipeline } from './exec.js'

const node = (script: string): [string, string[]] => [process.execPath, ['-e', script]]
const cwd = process.cwd()

test('data flows from the first command into the second', async () => {
  const sender = node('process.stdout.write("x".repeat(1 << 20))')
  // Fails unless every byte of the megabyte arrived.
  const receiver = node(
    'let n = 0; process.stdin.on("data", (c) => (n += c.length)); process.stdin.on("end", () => process.exit(n === 1 << 20 ? 0 : 3))'
  )
  await pipeline(sender, receiver, { cwd })
})

test('a sender that fails is reported even though the receiver exited 0', async () => {
  const sender = node('process.stdout.write("partial"); process.stderr.write("disk read error"); process.exit(2)')
  const receiver = node('process.stdin.resume()')
  await assert.rejects(pipeline(sender, receiver, { cwd }), (error: unknown) => {
    assert.ok(error instanceof NextshipError)
    assert.match(error.message, /exited with code 2: disk read error/)
    return true
  })
})

test('a receiver that exits early is named as the cause, not the sender it cut off', async () => {
  const sender = node('const b = Buffer.alloc(65536); const w = () => { while (process.stdout.write(b)); }; process.stdout.on("drain", w); w()')
  const receiver = node('process.stderr.write("no space left"); process.exit(4)')
  await assert.rejects(pipeline(sender, receiver, { cwd }), (error: unknown) => {
    assert.ok(error instanceof NextshipError)
    assert.match(error.message, /exited with code 4: no space left/)
    return true
  })
})

test('a side killed by a signal reports 128 plus the signal number', { skip: process.platform === 'win32' }, async () => {
  const sender = node('process.kill(process.pid, "SIGTERM")')
  const receiver = node('process.stdin.resume()')
  await assert.rejects(pipeline(sender, receiver, { cwd }), /exited with code 143/)
})

test('a command that is not installed says so by name', async () => {
  await assert.rejects(pipeline(['nextship-no-such-command', []], node('process.stdin.resume()'), { cwd }), /not installed or not on PATH/)
})
