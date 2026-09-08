/**
 * Tests for build identity.
 *
 * These exist because of a reproduced defect: the id was derived from the commit
 * alone, so changing an environment variable produced a byte-different image
 * under an identical tag, with the old value still inside it. Every case here
 * asserts that something which changes the image also changes the id.
 *
 * Author: Gowtham
 * Review: ../../../docs/05-critical-review.md §2.1
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { computeDigest, resolveDeploymentId } from './identity.js'
import type { ProjectInfo } from './detect.js'

const project = (root: string, envFiles: string[] = []): ProjectInfo => ({
  root,
  contextRoot: root,
  appDir: '.',
  name: 'demo',
  nextVersion: '16.3.4',
  packageManager: 'pnpm',
  lockfile: 'pnpm-lock.yaml',
  buildCommand: ['pnpm', 'run', 'build'],
  nodeMajor: '22',
  sharpVersion: null,
  envFiles,
  installerConfigs: [],
  userDockerignore: null,
})

/** The build context inputs that feed the digest. */
const ctx = (dockerfile: string, helpers: string[] = ['adapter', 'prune']) => ({ dockerfile, helpers })

async function fixture(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'nextship-identity-'))
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(root, name), content)
  }
  return root
}

test('the digest is stable for identical inputs', async () => {
  const root = await fixture({ '.env.production': 'A=1\n' })
  try {
    const p = project(root, ['.env.production'])
    const a = await computeDigest(p, ctx('FROM node'), 'key')
    const b = await computeDigest(p, ctx('FROM node'), 'key')
    assert.equal(a, b)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('changing an env value changes the digest', async () => {
  const root = await fixture({ '.env.production': 'GREETING=one\n' })
  try {
    const p = project(root, ['.env.production'])
    const before = await computeDigest(p, ctx('FROM node'), 'key')
    await writeFile(path.join(root, '.env.production'), 'GREETING=two\n')
    const after = await computeDigest(p, ctx('FROM node'), 'key')
    assert.notEqual(before, after, 'an env change must produce a new image identity')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the build helpers affect the digest, so editing one produces a new image', async () => {
  const root = await fixture()
  try {
    const p = project(root)
    const before = await computeDigest(p, ctx('FROM node', ['adapter', 'prune-v1']), 'key')
    const after = await computeDigest(p, ctx('FROM node', ['adapter', 'prune-v2']), 'key')
    assert.notEqual(before, after, 'the nextship version alone is not enough')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the Dockerfile and the encryption key both affect the digest', async () => {
  const root = await fixture()
  try {
    const p = project(root)
    const base = await computeDigest(p, ctx('FROM node:22-slim'), 'key-one')
    assert.notEqual(base, await computeDigest(p, ctx('FROM node:24-slim'), 'key-one'))
    assert.notEqual(base, await computeDigest(p, ctx('FROM node:22-slim'), 'key-two'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('adding an env file changes the digest even when its content matches another', async () => {
  const root = await fixture({ '.env.production': 'A=1\n', '.env': 'A=1\n' })
  try {
    const one = await computeDigest(project(root, ['.env.production']), ctx('FROM node'), 'key')
    const two = await computeDigest(project(root, ['.env.production', '.env']), ctx('FROM node'), 'key')
    assert.notEqual(one, two, 'the file list is part of the identity, not just the bytes')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing env file is an error, not a silently different digest', async () => {
  const root = await fixture()
  try {
    await assert.rejects(computeDigest(project(root, ['.env.production']), ctx('FROM node'), 'key'), /cannot be read/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an explicit deployment id always wins', async () => {
  const root = await fixture()
  process.env.NEXTSHIP_DEPLOYMENT_ID = 'dpl-supplied'
  try {
    const { deploymentId, ephemeral } = await resolveDeploymentId(root, 'abcdef1234')
    assert.equal(deploymentId, 'dpl-supplied')
    assert.equal(ephemeral, false)
  } finally {
    delete process.env.NEXTSHIP_DEPLOYMENT_ID
    await rm(root, { recursive: true, force: true })
  }
})

test('outside git the id is unique per build and marked ephemeral', async () => {
  const root = await fixture()
  try {
    const a = await resolveDeploymentId(root, 'abcdef1234')
    const b = await resolveDeploymentId(root, 'abcdef1234')
    assert.match(a.deploymentId, /^dpl-local-[0-9a-f]{8}$/)
    assert.equal(a.ephemeral, true)
    assert.notEqual(a.deploymentId, b.deploymentId, 'a non-reproducible source must never reuse an id')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
