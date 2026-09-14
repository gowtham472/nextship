/**
 * @nextship/cli: tests for what a deploy records before anything exists
 *
 * A first deploy writes these settings into nextship.json, and every later
 * command trusts them, so a flag applied to the wrong target or a recorded
 * value silently replaced is where a deploy would go somewhere unintended.
 *
 * Author: Ragul D
 * Design: ../../../docs/design.md §9.1
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { settingsFor } from './deploy.js'
import { NextshipError } from './errors.js'
import type { ProjectConfig } from './config.js'

const recorded: ProjectConfig = { version: 1, target: 'digitalocean', region: 'nyc', name: 'shop', registry: 'acme', appId: 'a1' }

test('a first deploy defaults to digitalocean in blr with a registry named after the project', () => {
  assert.deepEqual(settingsFor('demo', null, { confirmed: false }), {
    version: 1,
    target: 'digitalocean',
    name: 'demo',
    region: 'blr',
    registry: 'demo',
  })
})

test('the recorded region and name win over flags, because an app cannot move by redeploying', () => {
  const settings = settingsFor('renamed-locally', recorded, { confirmed: false, region: 'sfo' })
  assert.equal(settings.region, 'nyc')
  assert.equal(settings.name, 'shop')
  assert.equal(settings.appId, 'a1')
})

test('a vm target with no server on record says to add one', () => {
  assert.throws(
    () => settingsFor('demo', null, { confirmed: false, target: 'vm' }),
    (error: unknown) => error instanceof NextshipError && /server add/.test(error.action)
  )
})

test('digitalocean flags on a vm project are refused by name', () => {
  const vm: ProjectConfig = {
    version: 2,
    target: 'vm',
    name: 'demo',
    server: { host: 'h', port: 22, user: 'nextship', hostKey: 'h ssh-ed25519 AAAA', arch: 'amd64' },
  }
  assert.throws(
    () => settingsFor('demo', vm, { confirmed: false, region: 'blr', instanceSize: 'x' }),
    (error: unknown) => error instanceof NextshipError && /--region, --size only apply to the digitalocean target/.test(error.message)
  )
})

test('vm flags on a digitalocean project are refused by name, and an unknown build mode is refused', () => {
  const digitalocean: ProjectConfig = { version: 1, target: 'digitalocean', region: 'blr', name: 'demo', registry: 'demo' }
  assert.throws(
    () => settingsFor('demo', digitalocean, { confirmed: false, build: 'local' }),
    (error: unknown) => error instanceof NextshipError && /--build only applies to the vm target/.test(error.message)
  )
  const vm: ProjectConfig = {
    version: 2,
    target: 'vm',
    name: 'demo',
    server: { host: 'h', port: 22, user: 'nextship', hostKey: 'h ssh-ed25519 AAAA', arch: 'amd64' },
  }
  assert.throws(() => settingsFor('demo', vm, { confirmed: false, build: 'cloud' as never }), /is not a build mode/)
  assert.equal(settingsFor('demo', vm, { confirmed: false, build: 'local' }).build, 'local', 'a build mode is recorded')
})
