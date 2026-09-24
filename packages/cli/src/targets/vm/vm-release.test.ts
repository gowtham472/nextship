/**
 * @nextship/cli: the order a release touches a server in
 *
 * `vm-target.test.ts` covers the pure helpers. Nothing covered the sequence, and
 * the sequence is where the damage is: whether the deployment history is written
 * before or after the previous container is stopped decides what `deployments.json`
 * says when a laptop closes mid-deploy, and whether the Caddy site comes down
 * before or after a container decides whether `destroy` leaves the proxy pointing
 * at something that is gone.
 *
 * None of that is observable except as a sequence of remote commands, so the test
 * records them. A fake shell answers each one and remembers it in order, which is
 * enough to assert "this happened before that" about steps that are otherwise
 * invisible.
 *
 * Author: Ragul D
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { VmTarget } from './vm-target.js'
import type { Ssh } from './ssh.js'
import type { ProjectConfig } from '../../config.js'
import { NextshipError } from '../../errors.js'

// ------------------------------------------------------------------ harness

interface Answer {
  /** Matched against the whole remote command. */
  when: RegExp
  stdout?: string
  code?: number
}

/**
 * A stand-in for the SSH connection that records every command in order and
 * answers from a list of patterns, newest first, so a test can change an answer
 * part way through a run.
 */
class FakeShell {
  readonly commands: string[] = []
  readonly stdins: (string | undefined)[] = []
  private readonly answers: Answer[] = []
  /**
   * The deployment history, which is the one file a release both writes and
   * reads back within a single run: `startRelease` appends the new deployment
   * and `finishRelease` marks it live, so a fake that always replayed the
   * starting state would make the second step fail on a record it had just
   * written.
   */
  private history: string | null = null

  answer(when: RegExp, stdout = '', code = 0): this {
    this.answers.unshift({ when, stdout, code })
    return this
  }

  private reply(command: string): { code: number; stdout: string; stderr: string } {
    const match = this.answers.find((answer) => answer.when.test(command))
    return { code: match?.code ?? 0, stdout: match?.stdout ?? '', stderr: match?.code ? 'fake failure' : '' }
  }

  async exec(command: string, options: { stdin?: string } = {}) {
    this.commands.push(command)
    this.stdins.push(options.stdin)

    if (/install -m 600 \/dev\/stdin .*deployments\.json/.test(command)) {
      this.history = options.stdin ?? ''
      return { code: 0, stdout: '', stderr: '' }
    }
    if (/cat .*deployments\.json/.test(command) && this.history !== null) {
      return { code: 0, stdout: this.history, stderr: '' }
    }
    return this.reply(command)
  }

  /** The deployment history as it stands now. */
  deployments(): Array<{ id: string; live?: boolean; served?: boolean }> {
    return JSON.parse(this.history ?? '[]')
  }

  async run(command: string, what: string, options: { stdin?: string } = {}): Promise<string> {
    const result = await this.exec(command, options)
    if (result.code !== 0) {
      throw new NextshipError(`Could not ${what} on fake: ${result.stderr}`, 'Check the message above.')
    }
    return result.stdout
  }

  async close(): Promise<void> {}

  /** The index of the first command matching `pattern` at or after `from`, or -1. */
  at(pattern: RegExp, from = 0): number {
    const found = this.commands.slice(from).findIndex((command) => pattern.test(command))
    return found === -1 ? -1 : found + from
  }

  /** Asserts `first` was sent before `second`, naming both when it was not. */
  before(first: RegExp, second: RegExp, why: string): void {
    const a = this.at(first)
    const b = this.at(second)
    assert.notEqual(a, -1, `never sent: ${first}\n${this.commands.join('\n')}`)
    assert.notEqual(b, -1, `never sent: ${second}\n${this.commands.join('\n')}`)
    assert.ok(a < b, `${why}\n  ${first} was at ${a}\n  ${second} was at ${b}`)
  }
}

class TestVmTarget extends VmTarget {
  constructor(
    config: ProjectConfig,
    private readonly shell: FakeShell
  ) {
    super(config)
  }

  protected override ssh(): Promise<Ssh> {
    return Promise.resolve(this.shell as unknown as Ssh)
  }
}

const CONFIG: ProjectConfig = {
  version: 2,
  name: 'acme-web',
  target: 'vm',
  appId: 'app-uuid',
  server: { host: '203.0.113.10', port: 22, user: 'nextship', hostKey: 'ssh-ed25519 AAAA', arch: 'amd64' },
}

const APP_RECORD = JSON.stringify({ id: 'app-uuid', name: 'acme-web', createdAt: '2026-01-01T00:00:00Z', domains: [] })

/**
 * A server with room, Docker and whichever app holds the default address.
 *
 * Patterns are matched newest first, so the broad ones go on first: the facts
 * script is one command carrying every answer at once, and it mentions the
 * default-app file, which is why claiming the default is matched by `set -C`
 * rather than by the path both commands name.
 */
function server(
  shell: FakeShell,
  options: { deployments?: unknown[]; defaultApp?: string } = {}
): FakeShell {
  const { deployments = [], defaultApp = '' } = options
  return shell
    .answer(/MemTotal/, `4096\n20480\n27.0.0\n${defaultApp}\nno\n`)
    .answer(/cat .*app\.json/, APP_RECORD)
    .answer(/cat .*deployments\.json/, JSON.stringify(deployments))
    .answer(/cat .*\/env/, '')
    .answer(/test -[ef] /, '')
    .answer(/docker ps/, '')
    .answer(/docker inspect -f '\{\{\.State\.Running\}\}'/, 'true')
    .answer(/docker image ls/, '')
    // The exclusive create either wins or loses; either way the winner is what
    // the command prints.
    .answer(/set -C/, `${defaultApp || 'acme-web'}\n`)
}

const REQUEST = {
  name: 'acme-web',
  repository: 'acme-web',
  tag: 'abc123',
  port: 3000,
  instanceSize: null,
  memory: null,
  healthPath: '/',
}

/**
 * Starts a release and hands back its id, which the driver generates: `tag` is
 * the image, and the container is named after the release.
 */
async function start(shell: FakeShell): Promise<{ target: TestVmTarget; releaseId: string }> {
  const target = new TestVmTarget(CONFIG, shell)
  const released = await target.release('app-uuid', REQUEST)
  assert.ok(released.deploymentId, 'a release always reports an id to follow')
  return { target, releaseId: released.deploymentId }
}

/** A full deploy, start to live. */
async function deploy(shell: FakeShell): Promise<string> {
  const { target, releaseId } = await start(shell)
  await target.awaitRelease('app-uuid', releaseId, () => {}, true)
  return releaseId
}

// --------------------------------------------------------------- the switch

// The defect: Caddy was switched, then the previous container was stopped with a
// 30 second grace period, and only then was the deployment recorded live. A CLI
// that died in that window left deployments.json naming the stopped container as
// live, and `domain add` would rebuild the site from that record and point the
// proxy back at something no longer running.
test('the deployment is recorded live as soon as Caddy reloads, before anything is stopped', async () => {
  const shell = server(new FakeShell())
    .answer(/State\.Status/, 'running healthy')
    // Container names carry the release id, which always starts with `r`;
    // `previousContainers` uses that to tell nextship's containers from anything
    // else the app's labels might be on.
    .answer(/docker ps .*status=running/, 'acme-web-r20260101-000000-aaaaaa\n')
  await deploy(shell)

  // The history is written twice: once when the release starts, and again when it
  // goes live. It is the second one this is about, so it is found after the
  // reload rather than from the beginning.
  const reload = shell.at(/caddy reload/)
  const recordedLive = shell.at(/install -m 600 \/dev\/stdin .*deployments\.json/, reload)
  const stopped = shell.at(/docker stop -t 30/)

  assert.notEqual(reload, -1, 'Caddy was reloaded')
  assert.notEqual(recordedLive, -1, 'the deployment was recorded live')
  assert.notEqual(stopped, -1, 'the previous container was stopped')
  assert.ok(
    reload < recordedLive && recordedLive < stopped,
    'the live record belongs between the reload and the stop: from the reload the new container is what the server serves, ' +
      `and the stop takes up to 30 seconds. reload ${reload}, recorded ${recordedLive}, stopped ${stopped}\n${shell.commands.join('\n')}`
  )
})

test('the live record names the deployment that just went out', async () => {
  const shell = server(new FakeShell()).answer(/State\.Status/, 'running healthy')
  const releaseId = await deploy(shell)

  const live = shell.deployments().find((entry) => entry.live)
  assert.equal(live?.id, releaseId)
  assert.equal(live?.served, true)
})

// The defect: a previous container stuck restarting or paused was not listed as
// running, so it was never stopped. It keeps its resources and comes back on its
// own, and Docker then refuses to untag the image it was made from.
test('a previous container that is restarting or paused is stopped like a running one', async () => {
  const shell = server(new FakeShell()).answer(/State\.Status/, 'running healthy')
  await deploy(shell)

  const listing = shell.commands.find((command) => /docker ps .*--format/.test(command)) ?? ''
  assert.match(listing, /--filter status=running/)
  assert.match(listing, /--filter status=restarting/)
  assert.match(listing, /--filter status=paused/)
})

// ---------------------------------------------------------------- health

// The defect: Docker keeps the last health result for the whole restarting
// window, so a container that answered one probe and then began crash-looping
// still read `healthy`. It was accepted, Caddy was pointed at it, and the
// previous working container was stopped.
test('a container that went healthy once and is now restarting is not accepted', async () => {
  const shell = server(new FakeShell())
    .answer(/State\.Status/, 'restarting healthy')
    .answer(/docker logs/, 'boom\n')

  const { target, releaseId } = await start(shell)
  await assert.rejects(
    target.awaitRelease('app-uuid', releaseId, () => {}, true),
    /exited before it became healthy/
  )
  assert.notEqual(
    shell.at(new RegExp(`docker rm -f .*acme-web-${releaseId}`)),
    -1,
    'the container that never served is removed'
  )
  assert.equal(shell.at(/caddy reload/), -1, 'Caddy is never pointed at it')
})

test('a healthy container that is actually running is accepted', async () => {
  const shell = server(new FakeShell()).answer(/State\.Status/, 'running healthy')
  await deploy(shell)
  assert.notEqual(shell.at(/caddy reload/), -1)
  assert.equal(shell.at(/docker rm -f/), -1, 'nothing is discarded')
})

test('a failed deployment is recorded as failed and the previous one keeps serving', async () => {
  const shell = server(new FakeShell(), {
    deployments: [
      {
        id: 'old',
        imageTag: 'old',
        served: true,
        live: true,
        cause: 'deploy',
        createdAt: '2026-01-01T00:00:00Z',
        healthPath: '/',
      },
    ],
  })
    .answer(/State\.Status/, 'running unhealthy')
    .answer(/docker logs/, 'health check failed\n')

  const { target, releaseId } = await start(shell)
  await assert.rejects(
    target.awaitRelease('app-uuid', releaseId, () => {}, true),
    /failed its health check/
  )

  const history = shell.deployments()
  assert.equal(history.find((entry) => entry.id === releaseId)?.served, false)
  assert.equal(history.find((entry) => entry.id === 'old')?.live, true)
})

// ----------------------------------------------------------------- interrupt

// The defect: release() returned holding the app's deploy lock, and nothing
// broke a lock automatically. Ctrl-C during the health wait left a lock a person
// had to remove by hand, and the container it started running beside it.
test('an interrupted health wait removes the container and gives the lock back', async () => {
  const shell = server(new FakeShell())
    .answer(/State\.Status/, 'running starting')
    .answer(/docker logs/, '')

  const { target, releaseId } = await start(shell)

  const stopping = new AbortController()
  stopping.abort()
  await assert.rejects(
    target.awaitRelease('app-uuid', releaseId, () => {}, true, stopping.signal),
    /Stopped while waiting/
  )
  assert.notEqual(shell.at(new RegExp(`docker rm -f .*acme-web-${releaseId}`)), -1, 'the container is removed')
  assert.notEqual(shell.at(/rm -rf .*apps\/acme-web\/lock/), -1, 'the lock is released')
})

test('abandoning a release releases the lock even with no container to remove', async () => {
  const shell = server(new FakeShell())
  const { target } = await start(shell)
  await target.abandonRelease('app-uuid', null)
  assert.notEqual(shell.at(/rm -rf .*apps\/acme-web\/lock/), -1)
})

// -------------------------------------------------------------------- prune

// The defect: prune ran after the deployment was already live and threw on
// failure, so a container Docker would not remove made every later deploy of the
// app go live and then report a failure that had already been survived.
test('a prune that fails does not fail a deployment that is already serving', async () => {
  const shell = server(new FakeShell())
    .answer(/State\.Status/, 'running healthy')
    .answer(/docker image ls/, 'sha256:old\tv1\t2026-01-01 00:00:00 +0000 UTC\t100MB\n')
    .answer(/docker rmi/, '', 1)

  const phases: string[] = []
  const { target, releaseId } = await start(shell)
  await target.awaitRelease('app-uuid', releaseId, (line) => phases.push(line), true)

  assert.ok(
    phases.some((line) => line.includes('could not remove old images')),
    `the failure is reported as a warning: ${phases.join(' | ')}`
  )
  assert.ok(phases.some((line) => line.includes('images prune')), 'and says what to run')
})

test('the containers of a pruned image include the ones Docker will not remove without force', async () => {
  const shell = server(new FakeShell())
    .answer(/State\.Status/, 'running healthy')
    .answer(/docker image ls/, 'sha256:old\tv1\t2026-01-01 00:00:00 +0000 UTC\t100MB\n')
  await deploy(shell)

  const removal = shell.commands.find((command) => /docker ps -aq .*sh\.nextship\.image/.test(command)) ?? ''
  assert.match(removal, /--filter status=exited/)
  assert.match(removal, /--filter status=created/)
  assert.match(removal, /--filter status=restarting/)
  assert.match(removal, /--filter status=paused/)
  assert.match(removal, /docker rm -f$/, 'and are force-removed, which is safe because running is excluded')
  assert.doesNotMatch(removal, /--filter status=running/)
})

// -------------------------------------------------------------------- caddy

// The defect: the validation scratch space was one directory for the whole
// server while the deploy lock is per app, so two apps deploying at once wiped
// each other's set and the loser discarded a healthy container.
test('the Caddy validation scratch space is named after the app', async () => {
  const shell = server(new FakeShell()).answer(/State\.Status/, 'running healthy')
  await deploy(shell)

  const site = shell.commands.find((command) => /caddy validate/.test(command)) ?? ''
  assert.match(site, /chk='check-acme-web'/)
  assert.match(site, /chkfile='Caddyfile\.check-acme-web'/)
  assert.doesNotMatch(site, /"\$d\/check"/, 'never the shared directory')
})

test('claiming the default app is one command that cannot be won by both', async () => {
  const shell = server(new FakeShell()).answer(/State\.Status/, 'running healthy')
  await deploy(shell)

  const claim = shell.commands.find((command) => /default-app/.test(command) && /set -C/.test(command)) ?? ''
  assert.match(claim, /set -C/, 'the create is exclusive, so only one app can take it')
  assert.match(claim, /cat "\$f"/, 'and the winner is read back rather than assumed')
})

// ------------------------------------------------------------------ destroy

// The defect: the containers were removed before the Caddy site, so Caddy
// proxied to something that no longer existed, which answers 502 rather than
// falling through to the server's default app.
test('destroy takes the site down before the containers it points at', async () => {
  const shell = server(new FakeShell(), { defaultApp: 'other-app' })
  const target = new TestVmTarget(CONFIG, shell)
  await target.destroyApp('app-uuid')

  shell.before(
    /caddy reload/,
    /docker ps -aq .*xargs -r docker rm -f/,
    'the site has to stop pointing at the containers before they are removed'
  )
})

test('destroy releases the default address only when this app holds it', async () => {
  const mine = server(new FakeShell(), { defaultApp: 'acme-web' })
  await new TestVmTarget(CONFIG, mine).destroyApp('app-uuid')
  assert.notEqual(mine.at(/rm -f \/etc\/nextship\/default-app/), -1)

  const theirs = server(new FakeShell(), { defaultApp: 'other-app' })
  await new TestVmTarget(CONFIG, theirs).destroyApp('app-uuid')
  assert.equal(theirs.at(/rm -f \/etc\/nextship\/default-app/), -1)
})

// ------------------------------------------------------- lost build sessions

test('a lost build session is read from the server journal, from the build start on', async () => {
  const shell = new FakeShell().answer(/journalctl -u docker/, 'level=error msg="healthcheck failed fatally" error="session healthcheck failed fatally"')
  assert.equal(await new TestVmTarget(CONFIG, shell).buildSessionLost('1790229580'), true)
  assert.match(shell.commands.at(-1) ?? '', /journalctl -u docker --since @1790229580 /)
})

test('a journal with no lost session means the build failed on its own', async () => {
  const shell = new FakeShell().answer(/journalctl -u docker/, 'level=error msg="process did not complete successfully: exit code: 1"')
  assert.equal(await new TestVmTarget(CONFIG, shell).buildSessionLost('1790229580'), false)
})

test('a journal that cannot be read is no reason to retry', async () => {
  const shell = new FakeShell().answer(/journalctl -u docker/, 'session healthcheck failed fatally', 1)
  assert.equal(await new TestVmTarget(CONFIG, shell).buildSessionLost('1790229580'), false)
})

test('only a clock reading reaches the remote command', async () => {
  const shell = new FakeShell()
  await assert.rejects(new TestVmTarget(CONFIG, shell).buildSessionLost('1790229580; rm -rf /'), NextshipError)
  assert.equal(shell.commands.length, 0, 'nothing was sent')
})
