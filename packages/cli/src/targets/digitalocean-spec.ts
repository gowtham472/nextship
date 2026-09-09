/**
 * @nextship/cli: App Platform spec manipulation
 *
 * Pure functions that read and rewrite a DigitalOcean app spec.
 *
 * These lived in the command modules until there was a second cloud to plan for,
 * which made it obvious they were never command logic: an app spec is an App
 * Platform concept, and none of this has meaning on AWS. They sit here so the
 * DigitalOcean driver can use them without a command module importing the driver
 * that imports it back.
 *
 * Everything here is pure, which is why it is testable without an account.
 *
 * Author: Gowtham
 * Design: ../../../../docs/design.md §9
 */

import { NextshipError } from '../errors.js'
import type { RawAppSpec } from './digitalocean.js'

/** The component nextship creates and is therefore allowed to write to. */
export const MANAGED_SERVICE = 'web'

/** Values Next.js compiles into the client bundle, so they are public by construction. */
export const PUBLIC_PREFIX = 'NEXT_PUBLIC_'

// -------------------------------------------------------------------- env

/** One variable as App Platform stores it. Types are the API's, not ours, so they are widened. */
export interface AppEnv {
  key: string
  value?: string
  scope?: string
  type?: string
}

/** A variable found on the app, with where it lives, so a listing can say. */
export interface FoundEnv extends AppEnv {
  location: string
}

const asEnvArray = (value: unknown): AppEnv[] =>
  Array.isArray(value) ? (value as AppEnv[]).filter((entry) => typeof entry?.key === 'string') : []

/**
 * Every variable set on the app, wherever it lives.
 *
 * App Platform holds variables at the app level and on each component. Reading
 * only nextship's own service reports "none" for an app that plainly has them,
 * which is the same false negative that made `detect` call an installed `sharp`
 * missing.
 */
export function allEnvs(spec: RawAppSpec | null): FoundEnv[] {
  if (!spec) return []
  const found: FoundEnv[] = []

  for (const entry of asEnvArray(spec.envs)) found.push({ ...entry, location: 'app' })

  const services = Array.isArray(spec.services) ? (spec.services as RawAppSpec[]) : []
  for (const service of services) {
    const name = typeof service?.name === 'string' ? service.name : 'unnamed component'
    for (const entry of asEnvArray(service?.envs)) found.push({ ...entry, location: name })
  }

  return found
}

/** The variables on the service nextship manages, which is the only one it writes to. */
export function serviceEnvs(spec: RawAppSpec | null): AppEnv[] {
  const services = Array.isArray(spec?.services) ? (spec.services as RawAppSpec[]) : []
  const managed = services.find((service) => service?.name === MANAGED_SERVICE)
  return asEnvArray(managed?.envs)
}

/**
 * Decides how one variable is stored.
 *
 * `NEXT_PUBLIC_*` values are compiled into the JavaScript every visitor
 * downloads, so storing them encrypted claims a protection that does not exist
 * and makes them permanently unreadable. Everything else is a secret until
 * proven otherwise.
 *
 * Two rules keep a push from ever weakening what is already there: a variable
 * already stored as `SECRET` stays `SECRET`, because moving a value out of
 * encrypted storage is not something a push should do implicitly; and an
 * existing scope is kept, because narrowing `RUN_AND_BUILD_TIME` to `RUN_TIME`
 * removes configuration the user chose while the plan promises nothing is
 * removed.
 */
export function classify(key: string, existing: AppEnv | undefined): { type: string; scope: string } {
  const type = existing?.type === 'SECRET' || !key.startsWith(PUBLIC_PREFIX) ? 'SECRET' : 'GENERAL'
  return { type, scope: existing?.scope ?? 'RUN_TIME' }
}

/**
 * Writes the given variables into a service's env list.
 *
 * Keys not mentioned are left exactly as they are, so a variable set in the
 * control panel is not removed by a push that does not name it. This adds and
 * updates only; removal is `env rm`, which says what it is doing.
 */
export function mergeEnvs(existing: unknown, incoming: Map<string, string>): AppEnv[] {
  const current = asEnvArray(existing)
  const byKey = new Map(current.map((entry) => [entry.key, entry]))
  const result = current.filter((entry) => !incoming.has(entry.key))

  for (const [key, value] of incoming) {
    result.push({ key, value, ...classify(key, byKey.get(key)) })
  }

  return result.sort((a, b) => a.key.localeCompare(b.key))
}

/** Removes exactly the named keys from a service's env list. */
export function withoutEnvs(existing: unknown, keys: string[]): AppEnv[] {
  const removing = new Set(keys)
  return asEnvArray(existing).filter((entry) => !removing.has(entry.key))
}

/** Writes an env list onto nextship's own service, leaving every other component alone. */
export function withServiceEnvs(spec: RawAppSpec, envs: AppEnv[]): RawAppSpec {
  const services = Array.isArray(spec.services) ? (spec.services as RawAppSpec[]) : []
  return {
    ...spec,
    services: services.map((service) => (service?.name === MANAGED_SERVICE ? { ...service, envs } : service)),
  }
}

// ---------------------------------------------------------------- domains

export interface DomainSpec {
  domain: string
  type: 'PRIMARY' | 'ALIAS'
  minimum_tls_version?: string
}

/** Domains the app spec asks for. */
export function specDomains(spec: RawAppSpec | null): DomainSpec[] {
  const domains = Array.isArray(spec?.domains) ? (spec.domains as DomainSpec[]) : []
  return domains.filter((entry) => typeof entry?.domain === 'string' && entry.domain.length > 0)
}

/**
 * The role a domain will actually have, which is not always the one requested.
 *
 * App Platform promotes the first custom domain on an app to `PRIMARY` whatever
 * the spec asks for. Verified: a spec sending `ALIAS` for the only custom domain
 * came back stored as `PRIMARY`. Requesting `ALIAS` and reporting `ALIAS` would
 * describe something that does not happen, so the request is made to match the
 * outcome instead.
 */
export function effectiveRole(existingCount: number, requestedPrimary: boolean): 'PRIMARY' | 'ALIAS' {
  return requestedPrimary || existingCount === 0 ? 'PRIMARY' : 'ALIAS'
}

/**
 * Adds a domain to a spec's domain list.
 *
 * `zone` is deliberately never set. It tells App Platform to manage the DNS
 * records itself, which only works when the domain is on a DigitalOcean account
 * and, when it is not, produces an app that believes it owns records it cannot
 * see.
 */
export function addDomainToSpec(spec: RawAppSpec, entry: DomainSpec): RawAppSpec {
  const existing = specDomains(spec)

  if (existing.some((current) => current.domain === entry.domain)) {
    throw new NextshipError(
      `${entry.domain} is already attached to this app.`,
      'Run `nextship domain` to see its status.'
    )
  }

  // Only one domain may be PRIMARY, so promoting a new one demotes the old.
  const domains =
    entry.type === 'PRIMARY'
      ? existing.map((current) => (current.type === 'PRIMARY' ? { ...current, type: 'ALIAS' as const } : current))
      : [...existing]

  return { ...spec, domains: [...domains, entry] }
}

/** Removes a domain, refusing when it is not there rather than reporting a no-op as success. */
export function removeDomainFromSpec(spec: RawAppSpec, domain: string): RawAppSpec {
  const existing = specDomains(spec)
  if (!existing.some((entry) => entry.domain === domain)) {
    throw new NextshipError(
      `${domain} is not attached to this app.`,
      'Run `nextship domain` to see what is. Nothing was changed.'
    )
  }
  return { ...spec, domains: existing.filter((entry) => entry.domain !== domain) }
}
