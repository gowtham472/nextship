/**
 * Tests for runtime environment handling.
 *
 * The classification and merge rules are pinned here. The file parsing is not:
 * it is done by `@next/env`, the loader Next.js itself uses, precisely so that
 * agreement with the build is structural rather than a property we keep testing
 * for. A hand-written parser passed fourteen tests and still truncated a
 * multi-line private key to its header line, because the tests only covered the
 * cases its author thought of.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact } from './env.js'
import { allEnvs, classify, mergeEnvs, serviceEnvs, withoutEnvs } from './targets/digitalocean-spec.js'

const secret = (key: string, value = 'EV[1:stored]'): Record<string, string> => ({
  key,
  value,
  scope: 'RUN_TIME',
  type: 'SECRET',
})

// -------------------------------------------------------------- classification

test('a NEXT_PUBLIC_ variable is stored readable, because it is already public', () => {
  const { type } = classify('NEXT_PUBLIC_API_URL', undefined)

  assert.equal(type, 'GENERAL', 'it is compiled into the browser bundle, so calling it secret is a lie')
})

test('everything else is a secret', () => {
  assert.equal(classify('DATABASE_URL', undefined).type, 'SECRET')
  assert.equal(classify('PUBLIC_URL', undefined).type, 'SECRET', 'only the exact NEXT_PUBLIC_ prefix is public')
  assert.equal(classify('next_public_lower', undefined).type, 'SECRET', 'the prefix is case sensitive')
})

test('a variable already stored as a secret is never downgraded', () => {
  const { type } = classify('NEXT_PUBLIC_THING', { key: 'NEXT_PUBLIC_THING', type: 'SECRET' })

  assert.equal(type, 'SECRET', 'a push must not move a value out of encrypted storage')
})

test('an existing scope is preserved rather than narrowed', () => {
  const { scope } = classify('API_KEY', { key: 'API_KEY', scope: 'RUN_AND_BUILD_TIME' })

  assert.equal(scope, 'RUN_AND_BUILD_TIME', 'narrowing would remove configuration the user chose')
})

test('a new variable is runtime only, because the build already happened locally', () => {
  assert.equal(classify('API_KEY', undefined).scope, 'RUN_TIME')
})

// ---------------------------------------------------------------------- merge

test('a variable already on the app is updated, not duplicated', () => {
  const merged = mergeEnvs([secret('API_KEY')], new Map([['API_KEY', 'fresh']]))

  assert.equal(merged.length, 1)
  assert.equal(merged[0].value, 'fresh')
})

test('a variable the push does not name keeps its value', () => {
  const merged = mergeEnvs([secret('SET_IN_PANEL')], new Map([['NEW_KEY', 'value']]))

  assert.equal(merged.find((entry) => entry.key === 'SET_IN_PANEL')?.value, 'EV[1:stored]')
  assert.equal(merged.length, 2)
})

test('updating a variable does not weaken how it was stored', () => {
  const existing = [{ key: 'API_KEY', value: 'plain', scope: 'RUN_AND_BUILD_TIME', type: 'GENERAL' }]
  const merged = mergeEnvs(existing, new Map([['API_KEY', 'new']]))

  assert.equal(merged[0].value, 'new')
  assert.equal(merged[0].scope, 'RUN_AND_BUILD_TIME', 'the build-time scope survives')
  assert.equal(merged[0].type, 'SECRET', 'a value not marked public is upgraded to a secret')
})

test('an app with no env list at all merges cleanly', () => {
  assert.equal(mergeEnvs(undefined, new Map([['A', '1']])).length, 1)
})

// --------------------------------------------------------------------- remove

test('only the named variables are removed', () => {
  const remaining = withoutEnvs([secret('A'), secret('B'), secret('C')], ['B'])

  assert.deepEqual(
    remaining.map((entry) => entry.key),
    ['A', 'C']
  )
})

test('removing a key that is not there changes nothing', () => {
  const existing = [secret('A')]
  assert.deepEqual(withoutEnvs(existing, ['MISSING']), existing)
})

// -------------------------------------------------------------------- reading

test('variables are found wherever App Platform keeps them', () => {
  const spec = {
    envs: [secret('APP_LEVEL')],
    services: [
      { name: 'worker', envs: [secret('WORKER_ONLY')] },
      { name: 'web', envs: [secret('WEB')] },
    ],
  }

  assert.deepEqual(
    allEnvs(spec).map((entry) => `${entry.key}@${entry.location}`),
    ['APP_LEVEL@app', 'WORKER_ONLY@worker', 'WEB@web'],
    'reporting only our own service would call an app with variables empty'
  )
})

test('only our own service is offered for writing', () => {
  const spec = {
    envs: [secret('APP_LEVEL')],
    services: [{ name: 'worker', envs: [secret('WORKER_ONLY')] }, { name: 'web', envs: [secret('WEB')] }],
  }

  assert.deepEqual(
    serviceEnvs(spec).map((entry) => entry.key),
    ['WEB'],
    'nextship writes to the component it created and no other'
  )
})

test('a spec with nothing in it yields nothing', () => {
  assert.deepEqual(allEnvs(null), [])
  assert.deepEqual(allEnvs({}), [])
  assert.deepEqual(serviceEnvs(null), [])
})

test('malformed entries are ignored rather than crashing a listing', () => {
  const spec = { services: [{ name: 'web', envs: [{ novalue: true }, secret('REAL')] }] }

  assert.deepEqual(
    serviceEnvs(spec).map((entry) => entry.key),
    ['REAL']
  )
})

// ------------------------------------------------------------------ redaction

test('a secret is removed from an error message', () => {
  const message = 'DigitalOcean refused: value "hunter2-the-real-password" is invalid'
  const scrubbed = redact(message, ['hunter2-the-real-password'])

  assert.ok(!scrubbed.includes('hunter2-the-real-password'), 'the value must not reach a terminal')
  assert.ok(scrubbed.includes('[redacted]'))
})

test('every occurrence is removed, not just the first', () => {
  const scrubbed = redact('sekrit-value and again sekrit-value', ['sekrit-value'])

  assert.equal(scrubbed, '[redacted] and again [redacted]')
})

test('very short values are left alone, so errors stay readable', () => {
  assert.equal(redact('the port is 80 and it failed', ['80']), 'the port is 80 and it failed')
})
