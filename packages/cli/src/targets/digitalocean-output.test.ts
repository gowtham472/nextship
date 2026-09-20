/**
 * @nextship/cli: what the DigitalOcean commands print, line for line
 *
 * The target seam was introduced with a one-off check that `main` and the
 * refactor printed identical output for twenty commands. It found real
 * differences and it left no artifact, so the next change to a shared command
 * had nothing to compare against, and four regressions reached review: an app
 * with no ingress was told it "answers only on the domains attached to it",
 * `logs --follow` announced it was following a stream before asking for one,
 * `domain add` reported a missing token before a domain it could see was
 * malformed, and `doctor` threw on the config it exists to diagnose.
 *
 * None of those are caught by a driver test, because none of them are in a
 * driver: they are what a command decides to print, and only the printed lines
 * show them. So this pins the lines.
 *
 * The seam is `fetch`. Stubbing it exercises the real path a user's command
 * takes — `ownedApp`, `client()`, `DigitalOceanTarget`, `DigitalOcean` — rather
 * than a driver assembled by the test, which is the part where these four
 * defects lived.
 *
 * Author: Ragul D
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ProjectInfo } from '../detect.js'
import { listDomains, addDomain } from '../domain.js'
import { logs } from '../logs.js'
import { destroy } from '../destroy.js'
import { NextshipError } from '../errors.js'

// ------------------------------------------------------------------ harness

/** A project on disk with a nextship.json, which is what `ownedApp` reads. */
async function project(config: Record<string, unknown>): Promise<ProjectInfo & { cleanup: () => Promise<void> }> {
  // tmpdir(), not a hardcoded /tmp: Windows has no /tmp, and mkdtemp fails with
  // ENOENT there. Nothing here needs a short path — that constraint belongs to
  // the SSH control socket, not to a fixture directory.
  const root = await mkdtemp(path.join(tmpdir(), 'nextship-output-'))
  await writeFile(path.join(root, 'nextship.json'), `${JSON.stringify(config, null, 2)}\n`)
  return {
    root,
    contextRoot: root,
    appDir: '.',
    name: String(config.name),
    nextVersion: '15.0.0',
    packageManager: 'npm',
    lockfile: 'package-lock.json',
    buildCommand: ['npm', 'run', 'build'],
    nodeMajor: '22',
    sharpVersion: null,
    envFiles: [],
    installerConfigs: [],
    installerSecrets: [],
    userDockerignore: null,
    localDependencies: [],
    cleanup: () => rm(root, { recursive: true, force: true }),
  } as ProjectInfo & { cleanup: () => Promise<void> }
}

const OWNED = {
  version: 1,
  name: 'acme-web',
  target: 'digitalocean',
  appId: 'app-1',
  region: 'nyc',
  registry: 'acme',
}

/** Routes one stubbed response per endpoint, by the first pattern that matches. */
type Route = [RegExp, unknown]

function stubFetch(routes: Route[]): () => void {
  const real = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    const match = routes.find(([pattern]) => pattern.test(url))
    if (!match) throw new Error(`no stub for ${url}`)
    return new Response(JSON.stringify(match[1]), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return () => {
    globalThis.fetch = real
  }
}

/**
 * Everything the command wrote, with the stream it went to, so a warning on
 * stderr is not silently accepted as a detail line on stdout.
 */
async function capture(run: () => Promise<void>): Promise<{ out: string[]; err: string[]; error: NextshipError | null }> {
  const out: string[] = []
  const err: string[] = []
  const realOut = process.stdout.write.bind(process.stdout)
  const realErr = process.stderr.write.bind(process.stderr)
  process.stdout.write = ((text: string) => {
    out.push(...String(text).replace(/\n$/, '').split('\n'))
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((text: string) => {
    err.push(...String(text).replace(/\n$/, '').split('\n'))
    return true
  }) as typeof process.stderr.write

  let error: NextshipError | null = null
  try {
    await run()
  } catch (thrown) {
    if (!(thrown instanceof NextshipError)) throw thrown
    error = thrown
  } finally {
    process.stdout.write = realOut
    process.stderr.write = realErr
  }
  return { out, err, error }
}

const TOKEN = 'DIGITALOCEAN_TOKEN'

function withToken(value: string | undefined): () => void {
  const before = process.env[TOKEN]
  if (value === undefined) delete process.env[TOKEN]
  else process.env[TOKEN] = value
  return () => {
    if (before === undefined) delete process.env[TOKEN]
    else process.env[TOKEN] = before
  }
}

// ------------------------------------------------------------------- domain

// The regression: an app whose ingress is not assigned yet is one that has not
// deployed, and App Platform always gives it one. Saying it "answers only on
// the domains attached to it" describes a server, not App Platform, and sends
// someone attaching a domain to an app that would have worked without one.
test('an app with no ingress yet reads as unknown, never as having none', async () => {
  const proj = await project(OWNED)
  const restoreToken = withToken('token')
  const restoreFetch = stubFetch([[/apps\/app-1/, { app: { id: 'app-1', spec: { name: 'acme-web', domains: [] } } }]])
  try {
    const { out } = await capture(() => listDomains(proj))
    assert.deepEqual(out, [
      '> Domains for acme-web',
      '  platform   unknown  (always works, managed by DigitalOcean)',
      '  No custom domain is attached.',
      '  Add one with `nextship domain add <domain>`.',
      'v 0 custom domain(s).',
    ])
  } finally {
    restoreFetch()
    restoreToken()
    await proj.cleanup()
  }
})

test('an app with an ingress names it, and lists each attached domain', async () => {
  const proj = await project(OWNED)
  const restoreToken = withToken('token')
  const restoreFetch = stubFetch([
    [
      /apps\/app-1/,
      {
        app: {
          id: 'app-1',
          default_ingress: 'https://acme-web-abc.ondigitalocean.app',
          domains: [{ spec: { domain: 'acme.example.com' }, phase: 'ACTIVE' }],
          spec: { name: 'acme-web', domains: [{ domain: 'acme.example.com', type: 'PRIMARY' }] },
        },
      },
    ],
  ])
  try {
    const { out } = await capture(() => listDomains(proj))
    assert.equal(out[0], '> Domains for acme-web')
    assert.equal(out[1], '  platform   acme-web-abc.ondigitalocean.app  (always works, managed by DigitalOcean)')
    assert.match(out[2], /^ {2}acme\.example\.com {2}primary {2}/)
    assert.equal(out[3], 'v 1 custom domain(s).')
  } finally {
    restoreFetch()
    restoreToken()
    await proj.cleanup()
  }
})

// The regression: the domain is wrong whether or not there is a token to check
// it with, and resolving the target authenticates. Reporting the token first
// sends someone to fix their environment over a typo they can see.
test('a malformed domain is reported as malformed, even with no token to authenticate with', async () => {
  const proj = await project(OWNED)
  const restoreToken = withToken(undefined)
  try {
    const { error } = await capture(() =>
      addDomain(proj, { domain: 'not a domain', primary: false, minimumTls: '1.2', confirmed: false })
    )
    assert.match(error?.message ?? '', /is not a valid domain name/)
  } finally {
    restoreToken()
    await proj.cleanup()
  }
})

test('a pasted URL is named as a URL before anything is resolved', async () => {
  const proj = await project(OWNED)
  const restoreToken = withToken(undefined)
  try {
    const { error } = await capture(() =>
      addDomain(proj, { domain: 'https://acme.example.com/', primary: false, minimumTls: '1.2', confirmed: false })
    )
    assert.match(error?.message ?? '', /looks like a URL, not a hostname/)
  } finally {
    restoreToken()
    await proj.cleanup()
  }
})

// The platform check still needs a target, so it stays behind one. What it must
// not do is change which error a well-formed platform domain gets.
test('a platform domain is still refused as the platform\'s own', async () => {
  const proj = await project(OWNED)
  const restoreToken = withToken('token')
  const restoreFetch = stubFetch([[/apps\/app-1/, { app: { id: 'app-1', spec: { name: 'acme-web' } } }]])
  try {
    const { error } = await capture(() =>
      addDomain(proj, { domain: 'acme-web.ondigitalocean.app', primary: false, minimumTls: '1.2', confirmed: false })
    )
    assert.match(error?.message ?? '', /is a platform domain, which the target manages itself/)
  } finally {
    restoreFetch()
    restoreToken()
    await proj.cleanup()
  }
})

test('an unsupported TLS version is refused before the domain is resolved', async () => {
  const proj = await project(OWNED)
  const restoreToken = withToken(undefined)
  try {
    const { error } = await capture(() =>
      addDomain(proj, { domain: 'acme.example.com', primary: false, minimumTls: '1.1', confirmed: false })
    )
    assert.match(error?.message ?? '', /Minimum TLS version "1.1" is not supported/)
  } finally {
    restoreToken()
    await proj.cleanup()
  }
})

// --------------------------------------------------------------------- logs

// The regression: "following" was printed before the stream was asked for, so
// an app with no running container announced that it was following something
// and then reported that there was nothing to follow.
test('an app with no log stream says so, and never claims to be following one', async () => {
  const proj = await project(OWNED)
  const restoreToken = withToken('token')
  const restoreFetch = stubFetch([
    [/apps\/app-1\/logs/, { live_url: null, historic_urls: [] }],
    [/apps\/app-1/, { app: { id: 'app-1', spec: { name: 'acme-web' } } }],
  ])
  try {
    const { out, error } = await capture(() => logs(proj, { follow: true }))
    assert.deepEqual(out, ['> Runtime logs for acme-web'])
    assert.match(error?.message ?? '', /returned no log stream/)
  } finally {
    restoreFetch()
    restoreToken()
    await proj.cleanup()
  }
})

test('an empty snapshot explains that the platform keeps only the current container', async () => {
  const proj = await project(OWNED)
  const restoreToken = withToken('token')
  const restoreFetch = stubFetch([
    [/apps\/app-1\/logs/, { live_url: null, historic_urls: [] }],
    [/apps\/app-1/, { app: { id: 'app-1', spec: { name: 'acme-web' } } }],
  ])
  try {
    const { out, error } = await capture(() => logs(proj, { follow: false }))
    assert.equal(error, null)
    assert.deepEqual(out, [
      '> Runtime logs for acme-web',
      '  The running container has no buffered output.',
      '  The platform keeps only the current container recent logs, so output from a',
      '  replaced deployment is already gone.',
    ])
  } finally {
    restoreFetch()
    restoreToken()
    await proj.cleanup()
  }
})

// ------------------------------------------------------------------ destroy

test('the destroy plan says what goes, what stays and that nothing has happened yet', async () => {
  const proj = await project(OWNED)
  const restoreToken = withToken('token')
  const restoreFetch = stubFetch([
    [/apps\?per_page/, { apps: [{ id: 'app-1', spec: { name: 'acme-web' } }, { id: 'app-2', spec: { name: 'other' } }] }],
    [
      /apps\/app-1/,
      {
        app: {
          id: 'app-1',
          default_ingress: 'https://acme-web-abc.ondigitalocean.app',
          spec: { name: 'acme-web' },
        },
      },
    ],
  ])
  try {
    const { out, err } = await capture(() => destroy(proj, { name: 'acme-web', images: false, confirmed: false }))
    assert.equal(out[0], '> Plan')
    assert.equal(out[1], '  app        DESTROY "acme-web" (app-1)')
    assert.ok(
      out.some((line) => line.includes('acme-web-abc.ondigitalocean.app')),
      'the plan names the address that stops serving'
    )
    assert.equal(out.at(-2), 'v This was a plan only. Nothing was destroyed.')
    assert.equal(out.at(-1), '  Run `nextship destroy acme-web --yes` to execute it.')
    assert.ok(
      err.some((line) => line.includes('This cannot be undone')),
      'the warning goes to stderr'
    )
  } finally {
    restoreFetch()
    restoreToken()
    await proj.cleanup()
  }
})

test('the destroy plan counts the other apps it will not touch', async () => {
  const proj = await project(OWNED)
  const restoreToken = withToken('token')
  const restoreFetch = stubFetch([
    [
      /apps\?per_page/,
      {
        apps: [
          { id: 'app-1', spec: { name: 'acme-web' } },
          { id: 'app-2', spec: { name: 'other' } },
          { id: 'app-3', spec: { name: 'third' } },
        ],
      },
    ],
    [/apps\/app-1/, { app: { id: 'app-1', spec: { name: 'acme-web' } } }],
  ])
  try {
    const { out } = await capture(() => destroy(proj, { name: 'acme-web', images: false, confirmed: false }))
    assert.ok(out.includes('  untouched  2 other app(s) in this account'), out.join('\n'))
  } finally {
    restoreFetch()
    restoreToken()
    await proj.cleanup()
  }
})

// ----------------------------------------------------------------- ownership

test('a project with no recorded app is refused before anything is asked of the API', async () => {
  const proj = await project({ version: 1, name: 'acme-web', target: 'digitalocean', region: 'nyc', registry: 'acme' })
  const restoreToken = withToken('token')
  try {
    const { error } = await capture(() => listDomains(proj))
    assert.match(error?.message ?? '', /no deployed app on record/)
  } finally {
    restoreToken()
    await proj.cleanup()
  }
})

test('a missing token is reported as a missing token when the input is otherwise fine', async () => {
  const proj = await project(OWNED)
  const restoreToken = withToken(undefined)
  try {
    const { error } = await capture(() => listDomains(proj))
    assert.match(error?.message ?? '', /DIGITALOCEAN_TOKEN is not set/)
  } finally {
    restoreToken()
    await proj.cleanup()
  }
})
