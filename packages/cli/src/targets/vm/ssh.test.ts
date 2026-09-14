/**
 * @nextship/cli: tests for the SSH layer
 *
 * Two things here protect a server: values placed in a remote command cannot
 * change what the command does, and an ssh failure is never mistaken for a
 * command's result. The quoting is checked by running it through a real POSIX
 * shell, because a quoting function that only looks right is the kind of bug
 * that is found by someone else.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextshipError } from '../../errors.js'
import {
  Ssh,
  assertAppName,
  assertDeploymentId,
  assertDomain,
  assertEnvKey,
  assertHost,
  assertUser,
  connectionFailure,
  shellQuote,
} from './ssh.js'

const ED25519 = 'AAAAC3NzaC1lZDI1NTE5AAAAIBAzLBUdetTLzoVHIVLcV5jAUBaPHnXQVkBwGe8ZAFq1'
const endpoint = { host: '203.0.113.10', port: 2222, user: 'nextship', hostKey: `203.0.113.10 ssh-ed25519 ${ED25519}` }

const hostile = [
  "'; touch /tmp/pwned; echo '",
  '$(id)',
  '`id`',
  'a\nb',
  '"; id; "',
  '\\',
  "it's",
  '',
  '-rf',
  '${HOME}',
  'a b\tc',
]

test('a quoted value reaches a real shell as exactly one unchanged argument', { skip: process.platform === 'win32' }, () => {
  for (const value of hostile) {
    // printf receives the value as its single argument and prints it back with
    // delimiters, so a split, an expansion or an injected command all show up.
    const out = execFileSync('/bin/sh', ['-c', `printf '[%s]' ${shellQuote(value)}`], { encoding: 'utf8' })
    assert.equal(out, `[${value}]`, `quoting changed ${JSON.stringify(value)}`)
  }
})

const refused = (fn: () => unknown): void => {
  assert.throws(fn, (error: unknown) => error instanceof NextshipError)
}

test('validators accept what nextship produces and refuse injection attempts', () => {
  assert.equal(assertAppName('acme-web.v2_x'), 'acme-web.v2_x')
  assert.equal(assertDeploymentId('dpl-1a2b3c4d5e6f-0a1b2c3d'), 'dpl-1a2b3c4d5e6f-0a1b2c3d')
  assert.equal(assertEnvKey('DATABASE_URL'), 'DATABASE_URL')
  assert.equal(assertDomain('app.example.com'), 'app.example.com')
  assert.equal(assertHost('203.0.113.10'), '203.0.113.10')
  assert.equal(assertHost('2001:db8::1'), '2001:db8::1')
  assert.equal(assertHost('vps.example.com'), 'vps.example.com')
  assert.equal(assertUser('root'), 'root')

  for (const value of hostile) {
    refused(() => assertAppName(value))
    refused(() => assertDeploymentId(value))
    refused(() => assertEnvKey(value))
    refused(() => assertDomain(value))
    refused(() => assertUser(value))
  }
  refused(() => assertAppName('../etc'))
  refused(() => assertAppName('.hidden'))
  refused(() => assertAppName('Upper'))
  refused(() => assertEnvKey('1ABC'))
  refused(() => assertHost('-oProxyCommand=id'))
  refused(() => assertHost('host name'))
  refused(() => assertHost('user@host'))
  refused(() => assertDomain('https://app.example.com'))
})

const result = (stderr: string, code = 255) => ({ code, stdout: '', stderr })

test('a changed host key is a hard error that says how to re-verify deliberately', () => {
  const error = connectionFailure(endpoint, result('@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\nHost key verification failed.\n'))
  assert.ok(error)
  assert.match(error.message, /does not match the one recorded/)
  assert.match(error.action, /provider's console/)
  assert.match(error.action, /server add/)
})

test('a refused key, an unreachable host and an unknown name are told apart', () => {
  assert.match(connectionFailure(endpoint, result('nextship@203.0.113.10: Permission denied (publickey).'))?.message ?? '', /refused every key/)
  assert.match(connectionFailure(endpoint, result('ssh: connect to host 203.0.113.10 port 2222: Connection refused'))?.message ?? '', /Could not reach/)
  assert.match(connectionFailure(endpoint, result('ssh: connect to host x port 22: Operation timed out'))?.message ?? '', /Could not reach/)
  assert.match(connectionFailure(endpoint, result('ssh: Could not resolve hostname nope: nodename nor servname provided'))?.message ?? '', /does not resolve/)
})

// A remote command is allowed to exit 255 on its own. Mapping that to a
// connection error would hide the command's real failure behind a wrong one.
test('a remote command exiting 255, or any other code, is not treated as an ssh failure', () => {
  assert.equal(connectionFailure(endpoint, result('docker: something went wrong')), null)
  assert.equal(connectionFailure(endpoint, result('Permission denied', 1)), null)
})

test('every connection pins the recorded key under an alias and never prompts', async () => {
  const ssh = await Ssh.open(endpoint)
  try {
    const options = ssh.options()
    const value = (name: string) => options.find((option) => option.startsWith(`${name}=`))
    assert.equal(value('StrictHostKeyChecking'), 'StrictHostKeyChecking=yes')
    assert.equal(value('BatchMode'), 'BatchMode=yes')
    assert.equal(value('PasswordAuthentication'), 'PasswordAuthentication=no')
    assert.equal(value('HostKeyAlias'), 'HostKeyAlias=nextship-server')
    assert.equal(value('HostKeyAlgorithms'), 'HostKeyAlgorithms=ssh-ed25519')
    assert.equal(options[options.indexOf('-p') + 1], '2222')

    const knownHosts = value('UserKnownHostsFile')?.split('=')[1] ?? ''
    assert.equal(await readFile(knownHosts, 'utf8'), `nextship-server ssh-ed25519 ${ED25519}\n`)
    assert.ok(path.dirname(knownHosts).length < 40, 'the control socket directory has to stay short')
    assert.deepEqual(ssh.destination(), ['--', 'nextship@203.0.113.10'])
  } finally {
    await ssh.close()
  }
})

test('a host key line that cannot be read is refused before anything connects', async () => {
  await assert.rejects(Ssh.open({ ...endpoint, hostKey: 'garbage' }), /not a key line/)
  await assert.rejects(Ssh.open({ ...endpoint, host: '-oProxyCommand=id' }), /not a valid host/)
})
