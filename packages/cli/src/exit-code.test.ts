/**
 * The exit code a failure produces, checked through the real entry point.
 *
 * CI decides whether a deploy succeeded from nothing but this number. A first
 * outside test reported a failed deployment exiting 0; it did not reproduce, and
 * running through a pipe such as `| tee` reports the pipe's status instead, which
 * is the likely cause. This pins the behaviour either way: any error that reaches
 * the top level exits 1.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js')

test('a command that fails exits 1, not 0', async () => {
  const empty = await mkdtemp(path.join(tmpdir(), 'nextship-exit-'))
  try {
    const result = spawnSync(process.execPath, [CLI, 'logs'], {
      cwd: empty,
      env: { ...process.env, DIGITALOCEAN_TOKEN: '', NO_COLOR: '1' },
      encoding: 'utf8',
    })
    assert.equal(result.status, 1, `stderr: ${result.stderr}`)
    assert.match(result.stderr, /^x /m, 'the failure is printed as one')
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
})

test('an unknown command exits 1 as well', () => {
  const result = spawnSync(process.execPath, [CLI, 'no-such-command'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  assert.equal(result.status, 1)
})
