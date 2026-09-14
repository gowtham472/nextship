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
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { CONTAINER_PORT } from '../../image/dockerfile.js'
import { assertAppName, assertDomain } from './ssh.js'

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
}

const proxy = (container: string): string[] => [
  `  reverse_proxy ${container}:${CONTAINER_PORT} {`,
  '    flush_interval -1',
  '    lb_try_duration 5s',
  '  }',
]

export function renderSite(options: SiteOptions): string {
  assertAppName(options.name)
  const lines = [`# Written by nextship for ${options.name}. Regenerated on every deployment; edits are overwritten.`]

  if (options.isDefault) {
    lines.push('http://:80 {', ...proxy(options.container), '}')
  }

  // Caddy applies a block's tls settings to every name in it, so domains are
  // grouped by the minimum each asked for, primary first within a group.
  for (const minimum of ['1.2', '1.3']) {
    const names = options.domains
      .filter((entry) => entry.minimumTls === minimum)
      .sort((a, b) => Number(b.primary) - Number(a.primary))
      .map((entry) => assertDomain(entry.domain))
    if (names.length === 0) continue
    lines.push(`${names.join(', ')} {`, '  tls {', `    protocols tls${minimum}`, '  }', ...proxy(options.container), '}')
  }

  return `${lines.join('\n')}\n`
}
