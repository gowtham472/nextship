/**
 * Tests for the Server Actions encryption key: where it comes from, and who can read it.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveEncryptionKey } from './build.js'

const POSIX_ONLY = process.platform === 'win32' ? 'Windows has no POSIX file modes' : false

async function withoutEnvironmentKey<T>(run: () => Promise<T>): Promise<T> {
  const saved = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
  delete process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
  try {
    return await run()
  } finally {
    if (saved !== undefined) process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = saved
  }
}

test('a generated key is written readable by its owner only', { skip: POSIX_ONLY }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nextship-key-'))
  try {
    const key = await withoutEnvironmentKey(() => resolveEncryptionKey(root))
    const file = path.join(root, '.nextship', 'secrets.local.json')
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    assert.equal(JSON.parse(await readFile(file, 'utf8')).serverActionsEncryptionKey, key)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a key file an earlier version left world readable is tightened when read', { skip: POSIX_ONLY }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nextship-key-'))
  try {
    const file = path.join(root, '.nextship', 'secrets.local.json')
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ serverActionsEncryptionKey: 'kept' }), { mode: 0o644 })
    assert.equal(await withoutEnvironmentKey(() => resolveEncryptionKey(root)), 'kept', 'the stored key is never rotated')
    assert.equal((await stat(file)).mode & 0o777, 0o600)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
