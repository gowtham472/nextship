/**
 * The exit code a failure produces, checked through the real entry point.
 *
 * CI decides whether a deploy succeeded from nothing but this number. Our
 * end-to-end test on macOS recorded a failed deployment exiting 0; it did not reproduce, and
 * running through a pipe such as `| tee` reports the pipe's status instead, which
 * is the likely cause. This pins the behaviour either way: any error that reaches
 * the top level exits 1.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

// The regression: `doctor` began reading nextship.json to pick the target's
// wording, so a hand-edited file made the one command that exists to explain
// what is wrong refuse to run at all. It is the config problem that should be
// reported, along with everything else the command checks.
test('doctor reports an unreadable nextship.json as a finding instead of throwing on it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nextship-doctor-'))
  try {
    // doctor detects the project before it reads the config, so the project has
    // to look real: an installed Next.js is what detection requires.
    await mkdir(path.join(root, 'node_modules', 'next'), { recursive: true })
    await writeFile(
      path.join(root, 'node_modules', 'next', 'package.json'),
      JSON.stringify({ name: 'next', version: '16.3.4' })
    )
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { next: '16.3.4' }, scripts: { build: 'next build' } })
    )
    await writeFile(path.join(root, 'nextship.json'), '{ not json')

    const result = spawnSync(process.execPath, [CLI, 'doctor'], {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf8',
    })
    const output = `${result.stdout}${result.stderr}`
    assert.match(output, /nextship\.json cannot be read/, output)
    assert.match(output, /not valid JSON/, 'and says what is wrong with it')
    assert.doesNotMatch(output, /^x nextship\.json is not valid JSON/m, 'it is a finding, not the command failing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
