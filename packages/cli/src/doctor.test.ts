/**
 * Tests for the preflight diagnosis.
 *
 * Every case here represents something that changes behaviour without failing a
 * build, which is why a deliberate check is the only way to find it.
 *
 * Author: Gowtham
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
  installerSecrets: [],
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
    const findings = await diagnose(projectFor(root), 'digitalocean')
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
    const findings = await diagnose(projectFor(root), 'digitalocean')
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
    const findings = await diagnose(projectFor(root), 'digitalocean')
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
    const findings = await diagnose(projectFor(root), 'digitalocean')
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
    const withLock = await diagnose(projectFor(root), 'digitalocean')
    assert.equal(titled(withLock, 'No lockfile'), undefined)

    const withoutLock = await diagnose(projectFor(root, { lockfile: null }), 'digitalocean')
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
    const findings = await diagnose(projectFor(root), 'digitalocean')
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
    for (const finding of await diagnose(projectFor(root), 'digitalocean')) {
      assert.ok(finding.consequence.length > 0, `${finding.title} states what happens`)
      assert.ok(finding.action.length > 0, `${finding.title} states what to do`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a package reachable only through another platform, but in the lockfile, is not a blocker', async () => {
  // The shape of @img/sharp-wasm32 in every Next.js 16.3.4 project: installed, reached
  // only through sharp's optional packages for other systems, and carried by the lockfile.
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'demo', dependencies: { next: '16.3.4' } }),
    'node_modules/next/package.json': JSON.stringify({ name: 'next' }),
    'node_modules/@img/sharp-wasm32/package.json': JSON.stringify({ name: '@img/sharp-wasm32' }),
    'package-lock.json': JSON.stringify({
      packages: { '': {}, 'node_modules/next': {}, 'node_modules/@img/sharp-wasm32': {} },
    }),
  })
  try {
    const npm = { packageManager: 'npm' as const, lockfile: 'package-lock.json' }
    const findings = await diagnose(projectFor(root, npm), 'digitalocean')
    assert.equal(titled(findings, 'not declared anywhere'), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a package neither declared nor in the lockfile is still a blocker', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'demo', dependencies: { next: '16.3.4' } }),
    'node_modules/next/package.json': JSON.stringify({ name: 'next' }),
    'node_modules/copied-by-hand/package.json': JSON.stringify({ name: 'copied-by-hand' }),
    'package-lock.json': JSON.stringify({ packages: { '': {}, 'node_modules/next': {} } }),
  })
  try {
    const npm = { packageManager: 'npm' as const, lockfile: 'package-lock.json' }
    const finding = titled(await diagnose(projectFor(root, npm), 'digitalocean'), 'not declared anywhere')
    assert.equal(finding?.level, 'blocker')
    assert.ok(finding?.title.includes('copied-by-hand'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('on-demand revalidation in the source is warned about, since the CDN keeps static pages', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'demo', dependencies: { next: '16.3.4' } }),
    'app/actions.ts': "'use server'\nimport { revalidatePath } from 'next/cache'\nexport async function add() { revalidatePath('/posts') }",
  })
  try {
    const finding = titled(await diagnose(projectFor(root), 'digitalocean'), 'On-demand revalidation')
    assert.equal(finding?.level, 'warning')
    assert.ok(finding?.title.includes('revalidatePath'))
    assert.match(finding?.action ?? '', /export const revalidate/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a project that never revalidates on demand gets no such warning', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'demo', dependencies: { next: '16.3.4' } }),
    'app/page.tsx': 'export const revalidate = 60\nexport default function P() { return null }',
  })
  try {
    assert.equal(titled(await diagnose(projectFor(root), 'digitalocean'), 'On-demand revalidation'), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// A server has no CDN in front of it, so the App Platform advice would send a vm
// project chasing a cache it does not have.
test('on a vm target, revalidation is not warned about and cron advice names the server', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'demo', dependencies: { next: '16.3.4' } }),
    'vercel.json': JSON.stringify({ crons: [{ path: '/api/digest', schedule: '0 * * * *' }] }),
    'app/actions.ts': "'use server'\nimport { revalidatePath } from 'next/cache'\nexport async function add() { revalidatePath('/posts') }",
  })
  try {
    const findings = await diagnose(projectFor(root), 'vm')
    assert.equal(titled(findings, 'On-demand revalidation'), undefined)
    assert.match(titled(findings, 'cron job')?.action ?? '', /systemd timer/)
    assert.doesNotMatch(titled(findings, 'cron job')?.action ?? '', /DigitalOcean/)
    assert.equal(titled(findings, 'does not survive a restart'), undefined)
    assert.ok(titled(findings, 'survive a restart'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a vm project is warned that it runs on one server, and about request.url when the source reads it', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'demo', dependencies: { next: '16.3.4' } }),
    'app/api/callback/route.ts': 'export async function GET(request: Request) { return Response.json({ url: new URL("/done", request.url).href }) }',
  })
  try {
    const vm = await diagnose(projectFor(root), 'vm')
    assert.equal(titled(vm, 'One server')?.level, 'warning')
    assert.match(titled(vm, 'One server')?.action ?? '', /vm\.md/)
    assert.match(titled(vm, 'request.url')?.consequence ?? '', /0\.0\.0\.0:3000/)

    const digitalocean = await diagnose(projectFor(root), 'digitalocean')
    assert.equal(titled(digitalocean, 'One server'), undefined, 'the server findings are for vm projects only')
    assert.equal(titled(digitalocean, 'request.url'), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
