/**
 * Tests for nextship.json validation.
 *
 * This file is how every cloud command knows which app belongs to the project,
 * so a wrong reading of it is what would let nextship touch an app it does not
 * own. The version checks are pinned individually because a malformed file and
 * a file from a newer CLI need opposite actions from the reader.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readConfig, writeConfig, type ServerRecord } from './config.js'
import { NextshipError } from './errors.js'

async function withConfig(contents: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'nextship-config-'))
  await writeFile(path.join(root, 'nextship.json'), contents)
  return root
}

test('a project with no config reads as null rather than throwing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nextship-config-'))

  assert.equal(await readConfig(root), null)
})

test('a config that is not valid JSON says so, and warns what deleting it means', async () => {
  const root = await withConfig('{ not json')

  await assert.rejects(readConfig(root), (error: unknown) => {
    assert.ok(error instanceof NextshipError)
    assert.match(error.message, /not valid JSON/)
    assert.match(error.action, /refuse to touch the existing one/)
    return true
  })
})

// Reporting "version undefined, update nextship" for a hand-written or truncated
// file sends the reader to fix the one thing that is not wrong.
test('a config with no version says so, and does not blame the CLI version', async () => {
  const root = await withConfig(JSON.stringify({ target: 'digitalocean', name: 'x' }))

  await assert.rejects(readConfig(root), (error: unknown) => {
    assert.ok(error instanceof NextshipError)
    assert.match(error.message, /has no version field/)
    assert.doesNotMatch(error.message, /undefined/)
    assert.match(error.action, /Delete it and run/)
    return true
  })
})

test('a config from a newer CLI says to update, one from an older CLI says to recreate', async () => {
  const newer = await withConfig(JSON.stringify({ version: 99, name: 'x' }))
  await assert.rejects(readConfig(newer), (error: unknown) => {
    assert.match((error as NextshipError).action, /Update nextship/)
    return true
  })

  const older = await withConfig(JSON.stringify({ version: 0, name: 'x' }))
  await assert.rejects(readConfig(older), (error: unknown) => {
    assert.match((error as NextshipError).action, /Delete it and run/)
    return true
  })
})

test('a config at the current version reads back', async () => {
  const root = await withConfig(
    JSON.stringify({ version: 1, target: 'digitalocean', region: 'blr', name: 'demo', registry: 'demo' })
  )

  const config = await readConfig(root)

  assert.equal(config?.version, 1)
  assert.equal(config?.name, 'demo')
  assert.equal(config?.registry, 'demo')
})

const server = {
  host: '203.0.113.10',
  port: 22,
  user: 'nextship',
  hostKey: '203.0.113.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
  arch: 'amd64',
}

/** Asserts a refusal whose message names the field, so a user knows what to fix. */
async function refuses(config: Record<string, unknown>, pattern: RegExp): Promise<void> {
  const root = await withConfig(JSON.stringify(config))
  await assert.rejects(readConfig(root), (error: unknown) => {
    assert.ok(error instanceof NextshipError)
    assert.match(error.message, pattern)
    assert.match(error.action, /will not guess/)
    return true
  })
}

test('a version 2 vm config reads back with its server', async () => {
  const root = await withConfig(JSON.stringify({ version: 2, target: 'vm', name: 'demo', server, build: 'local' }))

  const config = await readConfig(root)

  assert.equal(config?.target, 'vm')
  assert.equal(config?.server?.host, '203.0.113.10')
  assert.equal(config?.build, 'local')
})

test('a version 2 digitalocean config still reads, since a newer CLI may have written it', async () => {
  const root = await withConfig(
    JSON.stringify({ version: 2, target: 'digitalocean', region: 'blr', name: 'demo', registry: 'demo' })
  )

  assert.equal((await readConfig(root))?.target, 'digitalocean')
})

test('an unknown target is refused by name', async () => {
  await refuses({ version: 2, target: 'aws', name: 'demo' }, /unknown target "aws"/)
})

test('digitalocean needs a region and a registry, and refuses vm fields', async () => {
  await refuses({ version: 1, target: 'digitalocean', name: 'demo', registry: 'demo' }, /no region/)
  await refuses({ version: 1, target: 'digitalocean', region: 'blr', name: 'demo' }, /no registry/)
  await refuses(
    { version: 2, target: 'digitalocean', region: 'blr', name: 'demo', registry: 'demo', server },
    /only the vm target uses/
  )
})

test('vm needs version 2 and a complete server, and refuses digitalocean fields', async () => {
  await refuses({ version: 1, target: 'vm', name: 'demo', server }, /cannot describe the vm target/)
  await refuses({ version: 2, target: 'vm', name: 'demo' }, /server add/)
  await refuses({ version: 2, target: 'vm', name: 'demo', server: { ...server, host: '' } }, /no host/)
  await refuses({ version: 2, target: 'vm', name: 'demo', server: { ...server, port: 70000 } }, /invalid port/)
  await refuses({ version: 2, target: 'vm', name: 'demo', server: { ...server, hostKey: '' } }, /pinned host key/)
  await refuses({ version: 2, target: 'vm', name: 'demo', server: { ...server, arch: 'riscv64' } }, /architecture/)
  await refuses({ version: 2, target: 'vm', name: 'demo', server, build: 'cloud' }, /unknown build mode "cloud"/)
  await refuses({ version: 2, target: 'vm', name: 'demo', server, region: 'blr' }, /only the digitalocean target/)
})

test('a config with no name is refused', async () => {
  await refuses({ version: 1, target: 'digitalocean', region: 'blr', registry: 'demo' }, /no app name/)
})

// Rewriting an existing DigitalOcean project as version 2 would make an older
// nextship on another machine refuse the file for no reason.
test('a digitalocean config is written as version 1, a vm config as version 2', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nextship-config-'))

  await writeConfig(root, { version: 2, target: 'digitalocean', region: 'blr', name: 'demo', registry: 'demo' })
  assert.equal(JSON.parse(await readFile(path.join(root, 'nextship.json'), 'utf8')).version, 1)

  await writeConfig(root, { version: 1, target: 'vm', name: 'demo', server: server as ServerRecord })
  assert.equal(JSON.parse(await readFile(path.join(root, 'nextship.json'), 'utf8')).version, 2)
})
