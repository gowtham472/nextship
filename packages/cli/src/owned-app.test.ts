/**
 * @nextship/cli: tests for choosing a project's driver
 *
 * Every command reaches its target through `client`, so a wrong choice here is
 * a command acting on a target the project never deployed to.
 *
 * Author: Ragul D
 * Design: ../../../docs/design.md §9.1
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { client } from './owned-app.js'
import { NextshipError } from './errors.js'
import type { ProjectConfig } from './config.js'

const digitalocean: ProjectConfig = { version: 1, target: 'digitalocean', region: 'blr', name: 'demo', registry: 'demo' }

function withToken<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.DIGITALOCEAN_TOKEN
  if (value === undefined) delete process.env.DIGITALOCEAN_TOKEN
  else process.env.DIGITALOCEAN_TOKEN = value
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.DIGITALOCEAN_TOKEN
    else process.env.DIGITALOCEAN_TOKEN = previous
  }
}

test('a digitalocean project gets the digitalocean driver', () => {
  const target = withToken('dop_v1_test', () => client(digitalocean))
  assert.equal(target.id, 'digitalocean')
})

test('digitalocean without a token says which variable to set', () => {
  assert.throws(
    () => withToken(undefined, () => client(digitalocean)),
    (error: unknown) => error instanceof NextshipError && /DIGITALOCEAN_TOKEN/.test(error.message)
  )
})

test('an unknown target is refused by name', () => {
  assert.throws(
    () => withToken('dop_v1_test', () => client(null, 'aws')),
    (error: unknown) => error instanceof NextshipError && /Unknown target "aws"/.test(error.message)
  )
})

// --target on a project that already records a target would otherwise act on
// the wrong one, or silently ignore what the user asked for.
test('--target that disagrees with nextship.json is refused', () => {
  assert.throws(
    () => withToken('dop_v1_test', () => client(digitalocean, 'vm')),
    (error: unknown) => error instanceof NextshipError && /deploys to digitalocean/.test(error.message)
  )
})
