/**
 * Tests for the preflight diagnosis.
 *
 * Every case here represents something that changes behaviour without failing a
 * build, which is why a deliberate check is the only way to find it.
 *
 * Author: Gowtham
 * Review: ../../../docs/review.md §12
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { diagnose, type Finding } from './doctor.js'
import type { ProjectInfo } from './detect.js'

const projectFor = (root: string, overrides: Partial<ProjectInfo> = {}): ProjectInfo => ({
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
  envFiles: [],
  installerConfigs: [],
  userDockerignore: null,
  localDependencies: [],
  ...overrides,
})

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'nextship-doctor-'))
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  return root
}

const titled = (findings: Finding[], fragment: string): Finding | undefined =>
  findings.find((finding) => finding.title.includes(fragment))

test('flags Vercel packages that degrade silently', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({
      name: 'demo',
      dependencies: { next: '16.3.4', '@vercel/analytics': '^2.0.0' },
      devDependencies: { '@vercel/speed-insights': '^1.0.0' },
    }),
  })
  try {
    const findings = await diagnose(projectFor(root))
    const analytics = titled(findings, '@vercel/analytics')
    assert.ok(analytics, 'a runtime dependency is flagged')
    assert.equal(analytics.level, 'warning')
    assert.match(analytics.consequence, /Nothing errors/)
    assert.ok(titled(findings, '@vercel/speed-insights'), 'a dev dependency is flagged too')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cron jobs in vercel.json are a blocker, because nothing else runs them', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'demo' }),
    'vercel.json': JSON.stringify({ crons: [{ path: '/api/digest', schedule: '0 * * * *' }] }),
  })
  try {
    const findings = await diagnose(projectFor(root))
    const crons = titled(findings, 'cron job')
    assert.ok(crons)
    assert.equal(crons.level, 'blocker')
    assert.equal(findings[0].level, 'blocker', 'blockers sort first')
    assert.ok(titled(findings, 'vercel.json is present'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('routing rules in vercel.json are reported, since only next.config applies', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'demo' }),
    'vercel.json': JSON.stringify({ redirects: [{ source: '/a', destination: '/b' }], headers: [] }),
  })
  try {
    const findings = await diagnose(projectFor(root))
    assert.ok(titled(findings, 'redirects'), 'a non-empty rule set is reported')
    assert.equal(titled(findings, 'headers'), undefined, 'an empty rule set is not noise')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('finds Vercel environment variables read in source, in both access forms', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'demo' }),
    'app/page.tsx': 'export default function P() { return <a href={process.env.VERCEL_URL}>x</a> }',
    'lib/env.ts': "export const region = process.env['VERCEL_REGION']",
    'node_modules/pkg/index.js': 'process.env.VERCEL_ENV',
  })
  try {
    const findings = await diagnose(projectFor(root))
    const envs = titled(findings, 'environment variables')
    assert.ok(envs)
    assert.match(envs.title, /VERCEL_REGION/)
    assert.match(envs.title, /VERCEL_URL/)
    assert.doesNotMatch(envs.title, /VERCEL_ENV/, 'node_modules is not the user\'s code')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing lockfile is reported as a reproducibility risk', async () => {
  const root = await fixture({ 'package.json': JSON.stringify({ name: 'demo' }) })
  try {
    const withLock = await diagnose(projectFor(root))
    assert.equal(titled(withLock, 'No lockfile'), undefined)

    const withoutLock = await diagnose(projectFor(root, { lockfile: null }))
    assert.ok(titled(withoutLock, 'No lockfile'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a clean project reports only the standing note', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'demo', dependencies: { next: '16.3.4' } }),
    'app/page.tsx': 'export default function P() { return null }',
  })
  try {
    const findings = await diagnose(projectFor(root))
    assert.ok(
      findings.every((finding) => finding.level === 'note'),
      'nothing that changes behaviour is invented'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('every finding carries a consequence and an action', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'demo', dependencies: { '@vercel/blob': '^1.0.0' } }),
    'vercel.json': JSON.stringify({ crons: [{ path: '/x', schedule: '* * * * *' }] }),
  })
  try {
    for (const finding of await diagnose(projectFor(root))) {
      assert.ok(finding.consequence.length > 0, `${finding.title} states what happens`)
      assert.ok(finding.action.length > 0, `${finding.title} states what to do`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
