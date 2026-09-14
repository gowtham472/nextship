/**
 * @nextship/cli: tests for the VM driver's decisions
 *
 * What a deployment starts, how much memory it may take, what a server must
 * have room for, and how domains are kept, pinned without a server. The
 * sequence itself runs against a real server in `conformance/vm/e2e.sh`.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { NextshipError } from '../../errors.js'
import {
  MOVE_STEPS,
  assertRoom,
  dnsWarnings,
  rebootProgress,
  healthCommand,
  memoryLimit,
  parseDockerSize,
  parseFacts,
  previousContainers,
  runArguments,
  withDomain,
  withoutDomain,
} from './vm-target.js'

const facts = (overrides = {}) => ({ memMib: 3900, diskFreeMib: 20000, dockerVersion: '27.3.1', defaultApp: null, ipv6: false, ...overrides })
const value = (args: string[], flag: string): string[] => args.flatMap((arg, index) => (args[index - 1] === flag ? [arg] : []))

test('the facts a server reports in one round trip are read, and a partial answer is refused', () => {
  assert.deepEqual(parseFacts('3900\n20480\n27.3.1\nshop\nyes\n'), { memMib: 3900, diskFreeMib: 20480, dockerVersion: '27.3.1', defaultApp: 'shop', ipv6: true })
  assert.equal(parseFacts('3900\n20480\n27.3.1\n\nno\n').defaultApp, null)
  assert.throws(() => parseFacts('3900\n'), /did not report/)
})

test('a server under 3 GB free is refused with a way to free space', () => {
  assert.throws(
    () => assertRoom(facts({ diskFreeMib: 2900 }), 'local'),
    (error: unknown) => error instanceof NextshipError && /below the 3 GB/.test(error.message) && /images prune/.test(error.action)
  )
  assertRoom(facts({ diskFreeMib: 3100 }), 'local')
})

test('a remote build on a server under 2 GB of RAM is refused, pointing at --build local', () => {
  assert.throws(() => assertRoom(facts({ memMib: 961 }), 'remote'), (error: unknown) => error instanceof NextshipError && /--build local/.test(error.action))
  assertRoom(facts({ memMib: 961 }), 'local')
})

test('memory is an even share of 80% of RAM across apps, floored, and --memory overrides it', () => {
  assert.equal(memoryLimit(4000, 1, null), '3200m')
  assert.equal(memoryLimit(4000, 4, null), '800m')
  assert.equal(memoryLimit(4000, 0, null), '3200m')
  assert.equal(memoryLimit(961, 10, null), '256m')
  assert.equal(memoryLimit(4000, 2, '1G'), '1g')
  assert.throws(() => memoryLimit(4000, 1, '1.5gb'), /is not a size/)
})

const run = (overrides = {}) =>
  runArguments({ name: 'shop', releaseId: 'r20260915-100000-abcdef', imageTag: 'dpl-1a2b-3c4d', memory: '800m', healthPath: '/about', dockerMajor: 27, workdir: '/src', ...overrides })

// The one property every other safety claim leans on: nothing reaches a
// container except through Caddy.
test('a deployment publishes no port and carries the labels removal is scoped by', () => {
  const args = run()
  assert.ok(!args.includes('-p') && !args.includes('--publish') && !args.includes('-P'))
  assert.deepEqual(value(args, '--label'), [
    'sh.nextship.managed=true',
    'sh.nextship.app=shop',
    'sh.nextship.deployment=r20260915-100000-abcdef',
    'sh.nextship.image=dpl-1a2b-3c4d',
  ])
  assert.deepEqual(value(args, '--name'), ['shop-r20260915-100000-abcdef'])
  assert.deepEqual(value(args, '--network'), ['nextship'])
  assert.deepEqual(value(args, '--restart'), ['unless-stopped'])
  assert.deepEqual(value(args, '--env-file'), ['/etc/nextship/apps/shop/env'])
  assert.deepEqual(value(args, '--log-driver'), ['journald'])
  assert.equal(args.at(-1), 'shop:dpl-1a2b-3c4d')
})

test('the health check matches the image, with a fast start interval only where Docker has one', () => {
  const args = run()
  assert.deepEqual(value(args, '--health-interval'), ['30s'])
  assert.deepEqual(value(args, '--health-retries'), ['3'])
  assert.deepEqual(value(args, '--health-start-interval'), ['2s'])
  assert.deepEqual(value(run({ dockerMajor: 24 }), '--health-start-interval'), [])
})

test('the health command polls the given path, and a path the shell would expand is refused', { skip: process.platform === 'win32' }, () => {
  const command = healthCommand('/about')
  assert.match(command, /'\/about'/)
  assert.match(healthCommand(null), /\+'\/',/)
  for (const bad of ['/$(id)', "/it's", '/a"b', 'about', '/`id`']) {
    assert.throws(() => healthCommand(bad), /is not a URL path/, bad)
  }
  // The check really is valid shell that runs node with valid JavaScript.
  execFileSync('/bin/sh', ['-n', '-c', command])
})

test('Docker sizes are read in its decimal units', () => {
  assert.equal(parseDockerSize('0B'), 0)
  assert.equal(parseDockerSize('12kB'), 12000)
  assert.equal(parseDockerSize('512.3MB'), 512300000)
  assert.equal(parseDockerSize('1.234GB'), 1234000000)
  assert.equal(parseDockerSize('n/a'), 0)
})

test('domains keep exactly one primary: the first, or whichever is asked for', () => {
  let domains = withDomain([], { domain: 'example.com', primary: false, minimumTls: '1.2' })
  assert.equal(domains[0].primary, true, 'the first domain is primary whatever is asked')
  domains = withDomain(domains, { domain: 'www.example.com', primary: false, minimumTls: '1.2' })
  assert.deepEqual(domains.map((entry) => [entry.domain, entry.primary]), [['example.com', true], ['www.example.com', false]])
  domains = withDomain(domains, { domain: 'shop.example.com', primary: true, minimumTls: '1.3' })
  assert.equal(domains.filter((entry) => entry.primary).length, 1)
  assert.equal(domains.find((entry) => entry.primary)?.domain, 'shop.example.com')

  domains = withoutDomain(domains, 'shop.example.com')
  assert.equal(domains.find((entry) => entry.primary)?.domain, 'example.com', 'the oldest remaining domain becomes primary')
  assert.deepEqual(withoutDomain(domains, 'nope.example.com'), domains)
})

// The defect this pins stopped the new container along with the old one: the
// listing held ids, so nothing equalled the new container's name.
test('the containers stopped after a switch are the other running ones of the app, never the new one', () => {
  const current = 'shop-r20260915-100000-abcdef'
  assert.deepEqual(previousContainers(`${current}\nshop-r20260914-090000-111111\n`, 'shop', current), ['shop-r20260914-090000-111111'])
  assert.deepEqual(previousContainers(`${current}\n`, 'shop', current), [])
  assert.deepEqual(previousContainers('6aa746b36aac\n', 'shop', current), [], 'an id is never taken for a container to stop')
  assert.deepEqual(previousContainers('shopfront-r1\nnextship-caddy\n', 'shop', current), [], 'another app or Caddy is never stopped')
})

// Regenerated pages belong to one build; optimized images and the fetch cache
// are shared, as Next.js keeps .next/cache between builds.
test('a deployment keeps its build output per image and the cache per app, both as named volumes', () => {
  assert.deepEqual(value(run(), '--volume'), ['nextship-shop-build-dpl-1a2b-3c4d:/src/.next', 'nextship-shop-cache:/src/.next/cache'])
  assert.deepEqual(value(run({ workdir: '/src/apps/web' }), '--volume'), [
    'nextship-shop-build-dpl-1a2b-3c4d:/src/apps/web/.next',
    'nextship-shop-cache:/src/apps/web/.next/cache',
  ])
  assert.ok(value(run(), '--volume').every((mount) => !mount.startsWith('/')), 'never a bind mount')
})

test('a domain that does not resolve, or resolves elsewhere, is warned about by name, and one that points here is not', () => {
  assert.match(dnsWarnings('app.example.com', null, '203.0.113.10')[0], /does not resolve yet.*203\.0\.113\.10/)
  assert.match(dnsWarnings('app.example.com', ['198.51.100.7'], '203.0.113.10')[0], /resolves to 198\.51\.100\.7, not to this server/)
  assert.deepEqual(dnsWarnings('app.example.com', ['198.51.100.7', '203.0.113.10'], '203.0.113.10'), [])
})

// Recorded from a server coming back: Docker starts restart-policy containers
// in no particular order, and a container with a health check runs before it is healthy.
test('after a reboot, a container counts as back only once it is healthy, or running without a health check', () => {
  const expected = ['shop-r1', 'blog-r2', 'plain-r3']
  assert.deepEqual(rebootProgress(expected, ''), { ready: [], waiting: expected })
  assert.deepEqual(rebootProgress(expected, 'shop-r1 running starting\nblog-r2 restarting \nplain-r3 running \n'), {
    ready: ['plain-r3'],
    waiting: ['shop-r1', 'blog-r2'],
  })
  assert.deepEqual(rebootProgress(expected, 'shop-r1 running healthy\nblog-r2 running healthy\nplain-r3 running \n'), {
    ready: expected,
    waiting: [],
  })
  assert.deepEqual(rebootProgress(['shop-r1'], 'shop-r1 running unhealthy\n').waiting, ['shop-r1'], 'unhealthy is not back')
  assert.deepEqual(rebootProgress(['shop-r1'], 'shop-r1 exited \n').waiting, ['shop-r1'])
})

// nextship.json is the last step, so a move that fails part way leaves every
// command still pointed at the server that serves the app.
test('a move copies before it deploys, and records the new server last', () => {
  assert.equal(MOVE_STEPS.length, 5)
  assert.match(MOVE_STEPS[0], /set up the new server/)
  assert.match(MOVE_STEPS[1], /env file and the Server Actions key, in memory/)
  assert.match(MOVE_STEPS[2], /stream the live image from the old server/)
  assert.match(MOVE_STEPS[3], /healthy/)
  assert.match(MOVE_STEPS.at(-1) ?? '', /record the new server in nextship.json/)
})
