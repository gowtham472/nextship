/**
 * Tests for log frame decoding.
 *
 * The stream carries JSON frames, and the failures that matter are losing a
 * line and printing a frame's envelope as if it were application output.
 *
 * Inputs are built with `JSON.stringify` rather than written as string
 * literals, so the fixtures cannot drift from what the server actually sends
 * through an escaping mistake in the test itself.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frameText } from './logs.js'

const frame = (op: string, data?: unknown): string => JSON.stringify({ op, data })

test('a frame yields its line', () => {
  assert.equal(frameText(frame('stdout', 'web ready\n')), 'web ready\n')
})

test('a line without a newline gets one, so output does not run together', () => {
  assert.equal(frameText(frame('stdout', 'no newline')), 'no newline\n')
})

test('stderr frames are printed too, not filtered out', () => {
  assert.equal(frameText(frame('stderr', 'boom\n')), 'boom\n')
})

test('a frame carrying no line prints nothing rather than an empty line', () => {
  assert.equal(frameText(frame('ping')), '')
  assert.equal(frameText(frame('stdout', null)), '')
  assert.equal(frameText(frame('stdout', 42)), '')
})

test('output that is not a frame is printed rather than dropped', () => {
  // Losing application output is worse than printing something unexpected.
  assert.equal(frameText('plain text line'), 'plain text line\n')
})

test('a line that is itself JSON survives, because applications log JSON', () => {
  const line = JSON.stringify({ level: 'error', msg: 'failed' })
  assert.equal(frameText(frame('stdout', `${line}\n`)), `${line}\n`)
})

test('a multi-line frame is passed through whole', () => {
  assert.equal(frameText(frame('stdout', 'first\nsecond\n')), 'first\nsecond\n')
})

test('non-string input is handled rather than throwing', () => {
  assert.equal(frameText(undefined), 'undefined\n')
})
