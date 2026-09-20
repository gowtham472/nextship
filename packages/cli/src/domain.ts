/**
 * @nextship/cli: custom domains
 *
 * An app is reachable at a generated platform hostname until a domain
 * is attached to it. Attaching one is two halves that nextship cannot do alone:
 * the app has to accept the hostname, which is what these commands do, and DNS
 * has to point at the app, which happens wherever the domain's records live.
 *
 * nextship deliberately does not touch DNS. Doing so needs a token scope beyond
 * what deploying requires, and a tool that edits DNS records can break every
 * other service on a domain, not just the app it was pointed at. So the record
 * to create is printed, and creating it stays a decision the owner makes.
 *
 * TLS is the platform's: once the record resolves, it issues and renews a
 * certificate. There is nothing to configure and nothing to renew.
 *
 * Author: Gowtham
 * Roadmap: ../../../docs/roadmap.md v0.4
 */

import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import { ownedApp } from './owned-app.js'
import { detail, ok, step, warn } from './util/log.js'

/**
 * TLS 1.2 is the floor because 1.0 and 1.1 are deprecated and broken, while
 * requiring 1.3 still turns away clients that are otherwise fine. Set
 * explicitly rather than left to the platform's default, so the answer is
 * recorded rather than inherited.
 */
export const DEFAULT_MIN_TLS = '1.2'

const ALLOWED_TLS = new Set(['1.2', '1.3'])


export interface AddDomainOptions {
  confirmed: boolean
  domain: string
  /** Make this the app's primary domain rather than an additional one. */
  primary: boolean
  minimumTls: string
}

export interface RemoveDomainOptions {
  confirmed: boolean
  domain: string
}

// ------------------------------------------------------------------- pure

/**
 * Checks the shape of a hostname, which needs no target and so runs before one
 * is resolved.
 *
 * The API would reject most of these too, but only after the request, and its
 * message describes a spec field rather than the thing the user typed. A URL
 * pasted instead of a hostname is the common case and deserves to be named.
 *
 * Split from the platform check below because resolving a target authenticates
 * against it, and something the user mistyped should not first be reported as a
 * missing token: the domain is wrong whether or not there is a token to check
 * it with.
 */
export function validateDomainShape(domain: string): void {
  if (domain !== domain.trim() || domain.length === 0) {
    throw new NextshipError('The domain is empty or has surrounding whitespace.', 'Pass the hostname on its own.')
  }
  if (domain.includes('://') || domain.includes('/')) {
    throw new NextshipError(
      `"${domain}" looks like a URL, not a hostname.`,
      'Pass just the hostname, for example preview.example.com.'
    )
  }
  if (!/^(?=.{4,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
    throw new NextshipError(
      `"${domain}" is not a valid domain name.`,
      'Use lowercase letters, digits, hyphens and dots, for example preview.example.com.'
    )
  }
}

/**
 * Refuses a hostname the target manages itself, which can only be asked of a
 * resolved target.
 */
export function assertNotPlatformDomain(domain: string, platformSuffixes: string[]): void {
  if (platformSuffixes.some((suffix) => domain.endsWith(suffix))) {
    throw new NextshipError(
      `${domain} is a platform domain, which the target manages itself.`,
      'It always works and cannot be attached. Add a domain you own instead.'
    )
  }
}

/** Both checks, for callers that already hold a target. */
export function validateDomain(domain: string, platformSuffixes: string[]): void {
  validateDomainShape(domain)
  assertNotPlatformDomain(domain, platformSuffixes)
}

// --------------------------------------------------------------- commands

/** Lists the domains attached to the app and whether each is live. */
export async function listDomains(project: ProjectInfo): Promise<void> {
  const app = await ownedApp(project)
  const address = await app.target.address(app.appId)
  const configured = address?.domains ?? []

  step(`Domains for ${app.name}`)
  // An app nextship cannot read at all is unknown on every target. One that
  // reads back without a platform host is the driver's to describe, because
  // what that means differs by target.
  detail(
    address?.platformHost
      ? `platform   ${address.platformHost}  (always works, managed by ${app.target.displayName})`
      : address === null
        ? `platform   unknown  (always works, managed by ${app.target.displayName})`
        : app.target.noPlatformHost
  )

  if (configured.length === 0) {
    detail('No custom domain is attached.')
    detail('Add one with `nextship domain add <domain>`.')
    ok('0 custom domain(s).')
    return
  }

  for (const entry of configured) {
    detail(`${entry.domain}  ${entry.primary ? 'primary' : 'alias'}  ${entry.detail}`)
  }
  ok(`${configured.length} custom domain(s).`)
}

/** Attaches a domain to the app and prints the DNS record to create. */
export async function addDomain(project: ProjectInfo, options: AddDomainOptions): Promise<void> {
  if (!ALLOWED_TLS.has(options.minimumTls)) {
    throw new NextshipError(
      `Minimum TLS version "${options.minimumTls}" is not supported.`,
      'Targets accept 1.2 or 1.3.'
    )
  }

  // Before the target is resolved, so a mistyped domain is reported as a
  // mistyped domain rather than as whatever authenticating would have failed on.
  validateDomainShape(options.domain)

  const app = await ownedApp(project)
  assertNotPlatformDomain(options.domain, app.target.platformSuffixes)
  const address = await app.target.address(app.appId)
  const existing = address?.domains ?? []
  // The first custom domain becomes primary whatever is asked for, so the plan
  // has to describe the outcome rather than the request.
  const primary = options.primary || existing.length === 0
  const demoted = primary ? existing.find((current) => current.primary) : undefined

  step('Plan')
  detail(`app        ${app.name} (${app.appId})`)
  detail(`add        ${options.domain}`)
  detail(
    primary
      ? `role       primary, the main address for this app${
          options.primary ? '' : ' (the first custom domain is always primary)'
        }`
      : 'role       alias, served alongside the domains already attached'
  )
  detail(`min TLS    ${options.minimumTls}`)
  if (demoted) detail(`demoting   ${demoted.domain} from primary to alias`)
  detail(`keeping    ${existing.length} domain(s) already attached`)
  detail('nextship does not change DNS; the record below is yours to create')
  for (const warning of await app.target.domainWarnings(app.appId, options.domain)) warn(warning)

  if (!options.confirmed) {
    ok('This was a plan only. Nothing changed.')
    detail('Run the same command with --yes to execute it.')
    return
  }

  step('Attaching')
  const record = await app.target.attachDomain(app.appId, options.domain, {
    primary: options.primary,
    minimumTls: options.minimumTls,
  })
  ok(`${options.domain} is attached to "${app.name}".`)

  step('Create this DNS record')
  detail(`type    ${record.type}`)
  detail(`name    ${record.name}`)
  detail(`value   ${record.value}`)
  for (const note of record.notes) detail(note)

  warn('The domain will not serve until that record resolves. A certificate is issued automatically after it does.')
  detail('Check progress with `nextship domain`.')
}

/** Detaches a domain. DNS records are left alone, because nextship did not create them. */
export async function removeDomain(project: ProjectInfo, options: RemoveDomainOptions): Promise<void> {
  const app = await ownedApp(project)
  const address = await app.target.address(app.appId)
  const remaining = (address?.domains ?? []).filter((entry) => entry.domain !== options.domain)

  step('Plan')
  detail(`app        ${app.name} (${app.appId})`)
  detail(`remove     ${options.domain}`)
  detail(`keeping    ${remaining.length} other domain(s)`)
  detail('the DNS record stays as it is; nextship did not create it and will not remove it')
  warn(`${options.domain} stops serving this app once this is applied.`)

  if (!options.confirmed) {
    ok('This was a plan only. Nothing changed.')
    detail('Run the same command with --yes to execute it.')
    return
  }

  step('Detaching')
  await app.target.detachDomain(app.appId, options.domain)
  ok(`${options.domain} is no longer attached to "${app.name}".`)
  detail(`Remove the DNS record too, or it will point at an app that no longer answers for it.`)
}
