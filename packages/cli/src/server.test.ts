/**
 * @nextship/cli: tests for server setup decisions
 *
 * `server add` changes a server as root, so what it decides before connecting
 * is pinned here: which steps a flag removes, the order that keeps a login
 * proven before SSH is hardened, what a project may record, and how setup's
 * output is read. The script itself is run against os-release fixtures.
 *
 * Author: Ragul D
 * Design: ../../../docs/design.md §9.3
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NextshipError } from './errors.js'
import type { ProjectConfig } from './config.js'
import {
  SETUP_STEPS,
  applyPhases,
  assertCanRecord,
  parseServerAddress,
  parseStepLines,
  reportedArch,
  setupCommand,
  setupVersion,
  skippedSteps,
} from './server.js'

const ED25519 = 'AAAAC3NzaC1lZDI1NTE5AAAAIBAzLBUdetTLzoVHIVLcV5jAUBaPHnXQVkBwGe8ZAFq1'
const OTHER = 'AAAAC3NzaC1lZDI1NTE5AAAAIOAcvH/9nWZZCMAtztAmv9Rm8tknstGlFBaWtrS+QjI1'
const scanned = { type: 'ssh-ed25519', key: ED25519 }

test('an address reads as user, host and port, with 22 by default and brackets for IPv6', () => {
  assert.deepEqual(parseServerAddress('root@203.0.113.10'), { user: 'root', host: '203.0.113.10', port: 22 })
  assert.deepEqual(parseServerAddress('ubuntu@vps.example.com:2222'), { user: 'ubuntu', host: 'vps.example.com', port: 2222 })
  assert.deepEqual(parseServerAddress('root@[2001:db8::1]:22'), { user: 'root', host: '2001:db8::1', port: 22 })
})

test('addresses that are not user@host, or carry an option, are refused', () => {
  for (const bad of ['203.0.113.10', 'root@', 'root@host:0', 'root@host:70000', 'root@-oProxyCommand=id', 'ro ot@host', 'root@host:22:1']) {
    assert.throws(() => parseServerAddress(bad), NextshipError, bad)
  }
})

test('each opt-out flag removes exactly its step, and an unknown one is refused', () => {
  assert.deepEqual(skippedSteps(['no-firewall', 'no-swap']), ['firewall', 'swap'])
  assert.deepEqual(skippedSteps(['no-auto-updates', 'no-ssh-hardening']), ['updates', 'ssh-hardening'])
  assert.throws(() => skippedSteps(['no-docker']), /Unknown option `--no-docker`/)
})

// The order is the lockout protection: nothing depends on the new user before a
// login as it is proven, and SSH is hardened only after that.
test('setup applies up to the new user first, and SSH hardening alone and last', () => {
  const phases = applyPhases([])
  assert.equal(phases.length, 3)
  assert.equal(phases[0].at(-1), 'user')
  assert.ok(!phases[1].includes('ssh-hardening'))
  assert.deepEqual(phases[2], ['ssh-hardening'])
  assert.deepEqual(phases.flat().sort(), [...SETUP_STEPS].sort())
})

test('opting out of hardening leaves two phases, and opted out steps are never applied', () => {
  const phases = applyPhases(['ssh-hardening', 'firewall', 'swap'])
  assert.equal(phases.length, 2)
  assert.ok(!phases.flat().includes('firewall'))
  assert.ok(!phases.flat().includes('swap'))
})

test('only STEP lines are read, since apply output also carries apt and docker', () => {
  const output = [
    'Reading package lists...',
    'STEP os ok ubuntu 24.04',
    'STEP arch ok arm64',
    'STEP ports refuse ports 80 or 443 are held by: nginx',
    'STEP docker done Docker 27.3.1',
    'STEP swap skip opted out',
    'STEP bogus maybe something',
    'Status: Downloaded newer image for caddy:2.10',
  ].join('\n')
  const lines = parseStepLines(output)
  assert.deepEqual(
    lines.map((line) => [line.step, line.status]),
    [['os', 'ok'], ['arch', 'ok'], ['ports', 'refuse'], ['docker', 'done'], ['swap', 'skip']]
  )
  assert.equal(lines[2].detail, 'ports 80 or 443 are held by: nginx')
  assert.equal(reportedArch(lines), 'arm64')
  assert.throws(() => reportedArch([]), /supported architecture/)
})

test('setup runs through sudo unless connected as root, with every argument quoted', () => {
  assert.equal(
    setupCommand('ubuntu', 22, ['plan', '--skip', 'swap']),
    "sudo -n 'env' 'NEXTSHIP_ADMIN=ubuntu' 'NEXTSHIP_SSH_PORT=22' 'NEXTSHIP_MIN_DOCKER=23' 'bash' '-s' '--' 'plan' '--skip' 'swap'"
  )
  assert.ok(!setupCommand('root', 22, ['plan']).startsWith('sudo'))
})

const vm = (overrides: Partial<ProjectConfig> = {}): ProjectConfig => ({
  version: 2,
  target: 'vm',
  name: 'demo',
  server: { host: '203.0.113.10', port: 22, user: 'nextship', hostKey: `203.0.113.10 ssh-ed25519 ${ED25519}`, arch: 'amd64' },
  ...overrides,
})

test('a new project, or the same server again, may be recorded', () => {
  assertCanRecord(null, '203.0.113.10', 22, scanned)
  assertCanRecord(vm({ appId: 'a1' }), '203.0.113.10', 22, scanned)
})

test('a digitalocean project is refused rather than silently moved', () => {
  const digitalocean: ProjectConfig = { version: 1, target: 'digitalocean', region: 'blr', name: 'demo', registry: 'demo' }
  assert.throws(() => assertCanRecord(digitalocean, '203.0.113.10', 22, scanned), /deploys to DigitalOcean/)
})

test('a different server is refused while an app runs on the recorded one', () => {
  assert.throws(() => assertCanRecord(vm({ appId: 'a1' }), '198.51.100.7', 22, scanned), /leave it there unmanaged/)
  assertCanRecord(vm(), '198.51.100.7', 22, scanned)
})

test('the same server offering a different key is refused, naming both fingerprints', () => {
  assert.throws(
    () => assertCanRecord(vm(), '203.0.113.10', 22, { type: 'ssh-ed25519', key: OTHER }),
    (error: unknown) =>
      error instanceof NextshipError &&
      /recorded SHA256:PEAn0mP9alYc0qaVa3RssukBYCLu7hXsnMWCBtZ\/jwM/.test(error.message) &&
      /provider's console/.test(error.action)
  )
})

// ----------------------------------------------------------------- setup.sh

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'vm', 'setup.sh')

async function planWith(osRelease: string): Promise<{ status: number | null; stdout: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nextship-setup-'))
  const file = path.join(dir, 'os-release')
  await writeFile(file, osRelease)
  const result = spawnSync('bash', [script, 'plan'], { encoding: 'utf8', env: { ...process.env, NEXTSHIP_OS_RELEASE: file } })
  return { status: result.status, stdout: result.stdout }
}

const bash = spawnSync('bash', ['--version']).status === 0

test('setup.sh refuses an unsupported distribution before checking anything else', { skip: !bash }, async () => {
  for (const release of ['ID=centos\nVERSION_ID="9"\n', 'ID=ubuntu\nVERSION_ID="20.04"\n', 'ID=debian\nVERSION_ID="11"\n']) {
    const { status, stdout } = await planWith(release)
    assert.equal(status, 3)
    assert.equal(stdout.trim().split('\n').length, 1, 'no step after os runs on an unsupported system')
    assert.match(stdout, /^STEP os refuse .* is not supported; use Ubuntu 22.04, Ubuntu 24.04 or Debian 12/)
  }
})

test('setup.sh accepts Ubuntu 22.04, Ubuntu 24.04 and Debian 12', { skip: !bash }, async () => {
  for (const [release, name] of [
    ['ID=ubuntu\nVERSION_ID="22.04"\nVERSION_CODENAME=jammy\n', 'ubuntu 22.04'],
    ['ID=ubuntu\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\n', 'ubuntu 24.04'],
    ['ID=debian\nVERSION_ID="12"\nVERSION_CODENAME=bookworm\n', 'debian 12'],
  ]) {
    // Only the first line is asserted: the steps after it read /proc and run
    // ss, which exist only on the Linux server this script is written for.
    const { stdout } = await planWith(release)
    assert.equal(stdout.split('\n')[0], `STEP os ok ${name}`)
  }
})

test('the setup version the CLI compares against is the one the script records', async () => {
  const source = await readFile(script, 'utf8')
  assert.equal(await setupVersion(), Number(/^SETUP_VERSION=(\d+)$/m.exec(source)?.[1]))
})
