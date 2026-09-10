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
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readConfig } from './config.js'
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
