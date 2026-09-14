/**
 * @nextship/cli: tests for the env file on a server
 *
 * Docker reads this file literally, one line per variable, so the cases that
 * matter are a value Docker would read differently from what was pushed.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEnvFile, renderEnvFile } from './env-file.js'

test('values round-trip literally, including quotes, equals signs, hashes and spaces', () => {
  const values = new Map([
    ['DATABASE_URL', 'postgres://u:p@db:5432/app?sslmode=require'],
    ['QUOTED', '"kept with its quotes"'],
    ['WITH_EQUALS', 'a=b=c'],
    ['HASH', 'not # a comment'],
    ['EMPTY', ''],
    ['NEXT_PUBLIC_SITE', ' leading space'],
  ])
  const file = renderEnvFile(values)
  assert.equal(file.split('\n')[0], 'DATABASE_URL=postgres://u:p@db:5432/app?sslmode=require')
  assert.deepEqual(parseEnvFile(file), values)
})

test('an empty set of variables is an empty file', () => {
  assert.equal(renderEnvFile(new Map()), '')
  assert.deepEqual(parseEnvFile(''), new Map())
})

// Docker would read the second line as a variable of its own, so a multi-line
// value such as a PEM key must be refused, not silently truncated.
test('a value with a line break is refused before anything is written', () => {
  assert.throws(() => renderEnvFile(new Map([['KEY', '-----BEGIN KEY-----\nabc']])), /line break/)
  assert.throws(() => renderEnvFile(new Map([['KEY', 'a\rb']])), /line break/)
  assert.throws(() => renderEnvFile(new Map([['1BAD', 'x']])), /not a valid environment variable name/)
})

test('a file with a line that is not KEY=value is refused rather than skipped', () => {
  assert.throws(() => parseEnvFile('GOOD=1\njunk\n'), /Line 2/)
  assert.throws(() => parseEnvFile('=value\n'), /Line 1/)
})
