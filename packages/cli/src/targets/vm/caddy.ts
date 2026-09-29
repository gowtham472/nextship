/**
 * @nextship/cli: the Caddy site for an app
 *
 * Each app is one file in `/etc/nextship/caddy/sites/`, rendered here from what
 * the app records: its domains, its minimum TLS version, and whether it is the
 * server's default app. Nothing else writes that file, so a site can always be
 * regenerated from the record and never drifts from it.
 *
 * Two settings are what make the proxy correct for Next.js rather than merely
 * working. `flush_interval -1` sends each chunk as the upstream writes it: a
 * buffering proxy leaves streamed pages and Suspense apparently working while
 * delivering none of the benefit, which is the failure `design.md` §11 exists to
 * catch. `lb_try_duration` retries a request for a few seconds when the upstream
 * refuses it, which covers the instant between Caddy moving to a new container
 * and that container accepting a connection it has not seen before.
 *
 * For an hour after a deployment the previous one keeps running, and a request
 * that names its build goes to it. Next.js names the build on every request an open
 * tab makes: `x-deployment-id` on client navigations and Server Actions, and
 * `?dpl=` on every JavaScript and CSS file. Without this, a tab opened before the
 * deployment asks the new container for files and Server Actions that exist only
 * in the build it loaded, and fails. A page load names no build, so it gets the
 * new one. Once the previous container has stopped, its route fails over to the
 * live container, which is what every request got before this existed.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { CONTAINER_PORT } from '../../image/dockerfile.js'
import { assertAppName, assertDeploymentId, assertDomain } from './ssh.js'

export interface SiteDomain {
  domain: string
  primary: boolean
  minimumTls: string
}

interface SiteOptions {
  name: string
  /** The container Caddy proxies to, on the nextship network. */
  container: string
  domains: SiteDomain[]
  /** The first app deployed on a server answers plain HTTP on its address. */
  isDefault: boolean
  /** The deployment before the live one, while it still runs for the tabs that loaded it. */
  previous: { container: string; deploymentId: string } | null
  /** A preview asks crawlers not to index it: it is a copy of the site under another name. */
  preview: boolean
}

const proxy = (upstreams: string[], extra: string[] = []): string[] => [
  `  reverse_proxy ${upstreams.map((container) => `${container}:${CONTAINER_PORT}`).join(' ')} {`,
  ...extra,
  '    flush_interval -1',
  '    lb_try_duration 5s',
  '  }',
]

const indent = (lines: string[]): string[] => lines.map((line) => `  ${line}`)

function routes(options: SiteOptions): string[] {
  const noindex = options.preview ? ['  header X-Robots-Tag "noindex, nofollow"'] : []
  return [...noindex, ...upstreams(options)]
}

function upstreams(options: SiteOptions): string[] {
  if (options.previous === null) return proxy([options.container])
  const id = assertDeploymentId(options.previous.deploymentId)
  return [
    `  @previous expression \`{header.X-Deployment-Id} == "${id}" || {query.dpl} == "${id}"\``,
    '  handle @previous {',
    // `first` sends to the previous container while it answers. A failed dial marks
    // it down for 30 s and the retry goes to the live one, so a request that names a
    // build no longer running is served as it would be with no route at all.
    ...indent(proxy([options.previous.container, options.container], ['    lb_policy first', '    fail_duration 30s'])),
    '  }',
    '  handle {',
    ...indent(proxy([options.container])),
    '  }',
  ]
}

export function renderSite(options: SiteOptions): string {
  assertAppName(options.name)
  const lines = [`# Written by nextship for ${options.name}. Regenerated on every deployment; edits are overwritten.`]

  if (options.isDefault) {
    lines.push('http://:80 {', ...routes(options), '}')
  }

  // Caddy applies a block's tls settings to every name in it, so domains are
  // grouped by the minimum each asked for, primary first within a group.
  for (const minimum of ['1.2', '1.3']) {
    const names = options.domains
      .filter((entry) => entry.minimumTls === minimum)
      .sort((a, b) => Number(b.primary) - Number(a.primary))
      .map((entry) => assertDomain(entry.domain))
    if (names.length === 0) continue
    lines.push(`${names.join(', ')} {`, '  tls {', `    protocols tls${minimum}`, '  }', ...routes(options), '}')
  }

  return `${lines.join('\n')}\n`
}
