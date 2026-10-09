/**
 * nextship-loadtest: the command a test runs
 *
 * Which k6 runs, and how a container is pointed at this machine, are decided by a
 * pure function, so each case is checked here without k6 or Docker installed.
 * Running the command for real is `scripts/e2e.mjs`.
 *
 * Author: Gowtham
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { describeEngine, invocation, isLoopback, K6_IMAGE } from './engine.js'

const local = { kind: 'local', version: '2.3.0' } as const
const docker = { kind: 'docker' } as const

test('a local k6 reads the script from stdin and the target from its environment', () => {
  assert.deepEqual(invocation(local, 'http://localhost:3000/', 'linux'), {
    command: 'k6',
    args: ['run', '--quiet', '-e', 'TARGET=http://localhost:3000/', '-'],
    target: 'http://localhost:3000/',
  })
})

test('Docker runs the pinned image, removed afterwards, with stdin open', () => {
  assert.deepEqual(invocation(docker, 'https://example.com/', 'linux'), {
    command: 'docker',
    args: ['run', '--rm', '-i', K6_IMAGE, 'run', '--quiet', '-e', 'TARGET=https://example.com/', '-'],
    target: 'https://example.com/',
  })
})

test('on Linux a container reaches a target on this machine through the host network', () => {
  const run = invocation(docker, 'http://127.0.0.1:3000/', 'linux')
  assert.deepEqual(run.args.slice(0, 5), ['run', '--rm', '-i', '--network', 'host'])
  assert.equal(run.target, 'http://127.0.0.1:3000/')
})

for (const platform of ['darwin', 'win32'] as const) {
  test(`on ${platform} a target on this machine is requested as host.docker.internal`, () => {
    const run = invocation(docker, 'http://localhost:3000/shop?page=2', platform)
    assert.equal(run.target, 'http://host.docker.internal:3000/shop?page=2')
    assert.ok(run.args.includes('TARGET=http://host.docker.internal:3000/shop?page=2'))
    assert.ok(!run.args.includes('--network'))
  })
}

test('a target elsewhere is never rewritten or given the host network', () => {
  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    const run = invocation(docker, 'https://example.com/', platform)
    assert.equal(run.target, 'https://example.com/')
    assert.ok(!run.args.includes('--network'))
  }
})

test('loopback is localhost, its subdomains, 127.0.0.0/8 and ::1, and nothing else', () => {
  for (const hostname of ['localhost', 'app.localhost', '127.0.0.1', '127.8.9.10', '[::1]']) {
    assert.equal(isLoopback(hostname), true, hostname)
  }
  for (const hostname of ['example.com', 'localhost.example.com', '128.0.0.1', '10.0.0.1', 'notlocalhost']) {
    assert.equal(isLoopback(hostname), false, hostname)
  }
})

test('the plan names the k6 that will run', () => {
  assert.equal(describeEngine(local), 'k6 2.3.0, installed on this machine')
  assert.equal(describeEngine(docker), `k6 in Docker (${K6_IMAGE}), pulled on first use`)
})
