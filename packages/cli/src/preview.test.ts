/**
 * @nextship/cli: tests for preview deployments
 *
 * A preview name ends up in an app name, a container name and a hostname, and the
 * flag scopes every step of a command to another app, so both are pinned: what a
 * name may be, and which commands may be pointed at a preview at all.
 *
 * Author: Ragul D
 * Design: ../../../docs/design.md §9.3
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NextshipError } from './errors.js'
import { previewConfig } from './owned-app.js'
import { assertPreviewName, previewAppName, selectedPreview, takePreview } from './preview.js'
import type { ProjectConfig } from './config.js'

test('a preview is named after the app it previews', () => {
  assert.equal(previewAppName('acme-web', 'pr-42'), 'acme-web-pr-42')
})

test('a preview name is refused unless an app name, a container name and a hostname all accept it', () => {
  for (const good of ['pr-42', 'a', 'feature-login', '0']) assert.equal(assertPreviewName(good), good)
  for (const bad of ['', 'PR-42', 'pr_42', '-pr', 'pr-', 'pr.42', 'a'.repeat(33), 'x;rm']) {
    assert.throws(() => assertPreviewName(bad), NextshipError, bad)
  }
})

test('--preview is taken off the arguments and scopes the command', () => {
  assert.deepEqual(takePreview('env', ['push', '--preview', 'pr-7', '--yes']), ['push', '--yes'])
  assert.equal(selectedPreview(), 'pr-7')
  assert.deepEqual(takePreview('deploy', ['--yes']), ['--yes'], 'arguments without it are left as they are')
})

// A command that does not act on one app would otherwise ignore the flag and act
// on the server, or on the project's own app, while the user believes it is scoped.
test('--preview is refused by commands that do not act on one app, and without a name', () => {
  assert.throws(() => takePreview('server', ['status', '--preview', 'pr-7']), /takes no --preview/)
  assert.throws(() => takePreview('detect', ['--preview', 'pr-7']), /takes no --preview/)
  assert.throws(() => takePreview('deploy', ['--preview']), /needs a name/)
  assert.throws(() => takePreview('deploy', ['--preview', '--yes']), /needs a name/)
})

const server = { host: '203.0.113.10', port: 22, user: 'nextship', hostKey: 'k', arch: 'amd64' as const }

test('a preview runs on the project\'s server under its own name, with no app id of its own in nextship.json', () => {
  const config: ProjectConfig = { version: 2, target: 'vm', name: 'acme-web', appId: 'main-id', server, build: 'local' }
  assert.deepEqual(previewConfig(config, 'pr-42'), { version: 2, target: 'vm', name: 'acme-web-pr-42', server, build: 'local' })
})

test('a preview is refused on App Platform, which has no second app on the same server', () => {
  const config: ProjectConfig = { version: 2, target: 'digitalocean', name: 'acme-web', appId: 'main-id', region: 'blr', registry: 'r' }
  assert.throws(() => previewConfig(config, 'pr-42'), /Previews run on a server/)
})
