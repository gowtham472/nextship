/**
 * @nextship/cli: DigitalOcean target
 *
 * Almost every call here is create, read or update. Two delete: `deleteManifest`,
 * so registry storage can be reclaimed, and `deleteApp`, which exists only for
 * `nextship destroy` and is never reached by any other command.
 *
 * It deletes by digest rather than by tag, and both halves of that were learned
 * by measuring. Deleting a tag reclaims nothing: the manifest survives untagged
 * and keeps referencing its layers, so garbage collection freed 0 bytes. But
 * deleting untagged manifests indiscriminately destroys running deployments,
 * because a tag points to an index whose platform manifests the API also reports
 * as untagged. Only a digest that no retained tag can reach may be deleted, and
 * working out which those are is the caller's job.
 *
 * Nothing else is ever deleted. An account running other services must be
 * unaffected by anything nextship does, and the worst outcome of a bug here
 * should be an orphaned resource rather than a destroyed one.
 *
 * Ownership is explicit rather than inferred. nextship only ever modifies an app
 * whose id it recorded in `nextship.json`. An app that merely shares a name is
 * refused, because a name collision with someone else's service is exactly the
 * case where guessing is unforgivable.
 *
 * Author: Gowtham
 * Design: ../../../../docs/design.md §9
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextshipError } from '../errors.js'
import { run } from '../util/exec.js'

const API = 'https://api.digitalocean.com/v2'
export const REGISTRY_HOST = 'registry.digitalocean.com'

/** Cheapest App Platform instance. 512 MiB is tight for heavy image optimization. */
export const DEFAULT_INSTANCE_SIZE = 'apps-s-1vcpu-0.5gb'
/** 5 GiB, enough to retain several images so rollback has something to roll back to. */
const REGISTRY_TIER = 'basic'

export interface AppSummary {
  id: string
  name: string
}

export interface DeploymentSummary {
  id: string
  phase: string
  cause: string
  createdAt: string
  /** The image this deployment runs, which is the nextship deployment id. */
  imageTag: string | null
}

export interface DeploymentStatus {
  id: string
  phase: string
  /** Terminal phases, after which polling stops. */
  done: boolean
  ok: boolean
}

/** The subset of App Platform's deployment object that rollback reads. */
export interface RawDeployment {
  id: string
  phase: string
  cause: string
  created_at: string
  spec?: { services?: Array<{ image?: { tag?: string } }> }
}

/**
 * The image tag lives in the deployment's own **spec**, which is the record of
 * what that deployment was asked to run. The sibling `services[]` array carries
 * only a resolved `source_image_digest`, no tag, so reading the tag from there
 * yields null for every deployment and rollback plans lose the one identifier a
 * human can match against a build.
 */
export function summarizeDeployment(d: RawDeployment): DeploymentSummary {
  return {
    id: d.id,
    phase: d.phase,
    cause: d.cause,
    createdAt: d.created_at,
    imageTag: d.spec?.services?.[0]?.image?.tag ?? null,
  }
}

/** Never widened to include the URL itself: it carries an access token. */
interface AppLogs {
  url?: string
  live_url?: string
  historic_urls?: string[]
}

/** How long to wait on a log URL before giving up and returning what arrived. */
const LOG_READ_TIMEOUT_MS = 20_000

/**
 * Reads one log URL. A failure returns an empty string rather than throwing:
 * one unreachable chunk should not discard the chunks that did arrive, and the
 * caller reports the empty case honestly. The URL is deliberately absent from
 * every message here because it embeds a token.
 */
async function readLogUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(LOG_READ_TIMEOUT_MS) })
    if (!response.ok) return ''
    return await response.text()
  } catch {
    return ''
  }
}

/**
 * One manifest in a repository, with the links needed to tell an orphan from the
 * image a live tag resolves to.
 *
 * `children` are the manifests this one references, which is what makes a tagged
 * OCI index distinguishable from the untagged platform manifests underneath it.
 */
export interface RegistryManifest {
  digest: string
  tags: string[]
  children: string[]
  /** Compressed size, which is what the registry bills. Layers are shared, so these overlap. */
  sizeBytes: number
  updatedAt: string
}

/** Live domain state, as opposed to the spec's request for one. */
export interface AppStatus {
  /** Hostname only, which is what a CNAME record needs. */
  defaultIngress: string | null
  domains: Array<{ domain: string; phase: string }>
  /** A deployment App Platform has not finished, or null. See `deploymentInProgress`. */
  deploymentInProgress: { id: string; phase: string } | null
}

/** A CNAME target is a hostname, and App Platform reports a URL. */
const stripScheme = (value: string | null): string | null => (value ? value.replace(/^https?:\/\//, '') : null)

/** How App Platform names a deployment on the app object. */
interface DeploymentRef {
  id?: string
  phase?: string
}

/** Phases a deployment never leaves, so one reported in them is not in progress. */
const FINISHED_PHASES = new Set(['ACTIVE', 'SUPERSEDED', 'ERROR', 'CANCELED'])

/**
 * The deployment App Platform has not finished, if any.
 *
 * `in_progress_deployment` is one being built or rolled out, and
 * `pending_deployment` one accepted but not yet started. Either means a spec
 * written now would replace it part way through. It is read from the app rather
 * than from a local lock, so every machine that asks gets the same answer.
 */
export function deploymentInProgress(
  app: { in_progress_deployment?: DeploymentRef; pending_deployment?: DeploymentRef } | undefined
): { id: string; phase: string } | null {
  for (const entry of [app?.in_progress_deployment, app?.pending_deployment]) {
    if (!entry?.id) continue
    const phase = entry.phase ?? 'PENDING'
    if (!FINISHED_PHASES.has(phase)) return { id: entry.id, phase }
  }
  return null
}

export class DigitalOcean {
  constructor(private readonly token: string) {}

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${API}/${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    const text = await response.text()
    let parsed: unknown = {}
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      parsed = { raw: text }
    }

    if (response.status === 401) {
      throw new NextshipError(
        'DigitalOcean rejected the token.',
        'Check DIGITALOCEAN_TOKEN. If it expired, create a new one and update your environment.'
      )
    }
    if (response.status === 403) {
      throw new NextshipError(
        `The token is not allowed to ${method} ${endpoint}.`,
        'Create a token with Registry and Apps scopes (create, read, update, delete). Scopes cannot be edited after creation.'
      )
    }

    return { status: response.status, body: parsed as T }
  }

  /** Fails with the API's own message, which is more specific than anything invented here. */
  private assertOk(result: { status: number; body: unknown }, what: string): void {
    if (result.status >= 200 && result.status < 300) return
    const message = (result.body as { message?: string })?.message ?? JSON.stringify(result.body).slice(0, 200)
    throw new NextshipError(`DigitalOcean refused to ${what}: ${message}`, 'Check the message above.')
  }

  // ---------------------------------------------------------------- registry

  /** Returns the registry name, or null when the account has none. */
  async getRegistry(): Promise<string | null> {
    const result = await this.request<{ registry?: { name: string } }>('GET', 'registry')
    if (result.status === 404) return null
    this.assertOk(result, 'read the container registry')
    return result.body.registry?.name ?? null
  }

  /**
   * Storage the registry is billed for.
   *
   * Reported per registry rather than per tag because layers are shared between
   * images and a tag is an index whose own size is a few kilobytes. A per-tag
   * figure would read as near zero for every image, which is worse than showing
   * nothing.
   */
  async registryUsage(): Promise<{ storageBytes: number } | null> {
    const result = await this.request<{ registry?: { storage_usage_bytes?: number } }>('GET', 'registry')
    if (result.status === 404) return null
    this.assertOk(result, 'read registry usage')
    return { storageBytes: result.body.registry?.storage_usage_bytes ?? 0 }
  }

  /** Registry regions the account may use. Read-only. */
  async registryRegions(): Promise<string[]> {
    const result = await this.request<{ options?: { available_regions?: string[] } }>(
      'GET',
      'registry/options'
    )
    this.assertOk(result, 'read registry options')
    return result.body.options?.available_regions ?? []
  }

  /**
   * Creates the registry. Billable, so the caller confirms before this runs.
   * Registry names are unique across all of DigitalOcean, not just this account,
   * which is why a collision is reported as a name problem rather than a bug.
   */
  async createRegistry(name: string, region: string): Promise<void> {
    const result = await this.request('POST', 'registry', {
      name,
      subscription_tier_slug: REGISTRY_TIER,
      region,
    })
    if (result.status === 409) {
      throw new NextshipError(
        `The registry name "${name}" is already taken.`,
        'Registry names are unique across all of DigitalOcean. Choose another with --registry <name>.'
      )
    }
    this.assertOk(result, 'create the container registry')
  }

  /**
   * Writes registry credentials into a throwaway Docker config directory and
   * returns its path. Using a config directory keeps the credential out of the
   * argument list, where `docker login -p` would put it for any process on the
   * machine to read.
   */
  async dockerConfigDir(): Promise<string> {
    const result = await this.request<Record<string, unknown>>(
      'GET',
      'registry/docker-credentials?read_write=true'
    )
    this.assertOk(result, 'read registry credentials')

    const dir = await mkdtemp(path.join(tmpdir(), 'nextship-docker-'))
    await writeFile(path.join(dir, 'config.json'), JSON.stringify(result.body), { mode: 0o600 })
    return dir
  }

  // -------------------------------------------------------------------- apps

  /** Every app in the account. Read-only, and used only to detect name collisions. */
  async listApps(): Promise<AppSummary[]> {
    const result = await this.request<{ apps?: Array<{ id: string; spec: { name: string } }> }>(
      'GET',
      'apps?per_page=200'
    )
    this.assertOk(result, 'list apps')
    // Only what the caller uses: an app's address comes from `getAppStatus`,
    // which distinguishes the platform hostname from a custom domain that may
    // not resolve yet.
    return (result.body.apps ?? []).map((app) => ({ id: app.id, name: app.spec.name }))
  }

  async createApp(spec: AppSpec): Promise<{ id: string; deploymentId: string | null }> {
    const result = await this.request<{ app?: { id: string; pending_deployment?: { id: string } } }>(
      'POST',
      'apps',
      { spec }
    )
    this.assertOk(result, 'create the app')
    const app = result.body.app
    if (!app?.id) throw new NextshipError('DigitalOcean created the app but returned no id.', 'Check the control panel.')
    return { id: app.id, deploymentId: app.pending_deployment?.id ?? null }
  }

  /** Updates only the app whose id the caller already owns. Never resolves by name. */
  /**
   * Every manifest in a repository, with its tags and the manifests it
   * references.
   *
   * The reference graph is built from each manifest's `blobs` list, which
   * includes the digests of child manifests. That is what makes it possible to
   * tell a genuinely orphaned image from the untagged platform manifest that a
   * live tag resolves to, without authenticating against the registry itself.
   */
  async listManifests(registry: string, repository: string): Promise<RegistryManifest[]> {
    const result = await this.request<{
      manifests?: Array<{
        digest?: string
        tags?: string[]
        compressed_size_bytes?: number
        updated_at?: string
        blobs?: Array<{ digest?: string }>
      }>
    }>('GET', `registry/${registry}/repositories/${repository}/digests?per_page=200`)
    this.assertOk(result, 'list images')

    const entries = (result.body.manifests ?? []).filter((entry) => typeof entry.digest === 'string')
    const known = new Set(entries.map((entry) => entry.digest as string))

    return entries
      .map((entry) => ({
        digest: entry.digest as string,
        tags: (entry.tags ?? []).filter((tag) => typeof tag === 'string' && tag.length > 0),
        // A manifest lists itself among its blobs, and lists layer digests that
        // are not manifests. Only the ones that are manifests here are children.
        children: (entry.blobs ?? [])
          .map((blob) => blob.digest)
          .filter((digest): digest is string => typeof digest === 'string')
          .filter((digest) => digest !== entry.digest && known.has(digest)),
        sizeBytes: entry.compressed_size_bytes ?? 0,
        updatedAt: entry.updated_at ?? '',
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /**
   * Deletes an app and everything App Platform runs for it.
   *
   * Irreversible, and it takes the generated `.ondigitalocean.app` hostname with
   * it: a replacement app gets a new random suffix, so any DNS record pointing
   * at the old one stops resolving to anything. The caller confirms against the
   * recorded name before this runs.
   */
  async deleteApp(id: string): Promise<void> {
    const result = await this.request<unknown>('DELETE', `apps/${id}`)
    this.assertOk(result, 'delete the app')
  }

  /**
   * Deletes one manifest by digest, which also removes any tag pointing at it.
   *
   * Deleting a tag alone reclaims nothing: the manifest survives untagged and
   * keeps referencing its layers, so garbage collection finds nothing
   * unreferenced. Measured: deleting a tag and running collection freed 0 bytes
   * and deleted 0 blobs. The caller is responsible for only passing digests that
   * no retained tag can reach.
   */
  async deleteManifest(registry: string, repository: string, digest: string): Promise<void> {
    const result = await this.request<unknown>(
      'DELETE',
      `registry/${registry}/repositories/${repository}/digests/${encodeURIComponent(digest)}`
    )
    this.assertOk(result, `delete image ${digest.slice(0, 19)}`)
  }

  /** Starts garbage collection, which is what actually reclaims storage. */
  async startGarbageCollection(registry: string): Promise<void> {
    const result = await this.request<unknown>('POST', `registry/${registry}/garbage-collection`)
    this.assertOk(result, 'start garbage collection')
  }

  /** The garbage collection currently running, if any. */
  async activeGarbageCollection(registry: string): Promise<{ status: string } | null> {
    const result = await this.request<{ garbage_collection?: { status?: string } }>(
      'GET',
      `registry/${registry}/garbage-collection`
    )
    if (result.status === 404) return null
    this.assertOk(result, 'read garbage collection status')
    return { status: result.body.garbage_collection?.status ?? 'unknown' }
  }

  /**
   * What App Platform reports about the app's domains right now, which is not
   * the same as what the spec asks for. The spec is the request; this is whether
   * DNS resolves and whether a certificate has been issued.
   */
  async getAppStatus(id: string): Promise<AppStatus | null> {
    const result = await this.request<{
      app?: {
        default_ingress?: string
        live_url?: string
        domains?: Array<{ spec?: { domain?: string }; phase?: string; progress?: { steps?: unknown[] } }>
        in_progress_deployment?: DeploymentRef
        pending_deployment?: DeploymentRef
      }
    }>('GET', `apps/${id}`)
    if (result.status === 404) return null
    this.assertOk(result, 'read the app')

    const app = result.body.app
    return {
      defaultIngress: stripScheme(app?.default_ingress ?? app?.live_url ?? null),
      domains: (app?.domains ?? [])
        .map((entry) => ({ domain: entry.spec?.domain ?? '', phase: entry.phase ?? 'UNKNOWN' }))
        .filter((entry) => entry.domain.length > 0),
      deploymentInProgress: deploymentInProgress(app),
    }
  }

  /**
   * The app's current spec, exactly as App Platform holds it. Read before every
   * update so `mergeAppSpec` can preserve the parts nextship does not manage.
   */
  async getAppSpec(id: string): Promise<RawAppSpec | null> {
    const result = await this.request<{ app?: { spec?: RawAppSpec } }>('GET', `apps/${id}`)
    if (result.status === 404) return null
    this.assertOk(result, 'read the app spec')
    return result.body.app?.spec ?? null
  }

  async updateApp(id: string, spec: RawAppSpec): Promise<{ deploymentId: string | null }> {
    const result = await this.request<{ app?: { pending_deployment?: { id: string } } }>('PUT', `apps/${id}`, { spec })
    this.assertOk(result, 'update the app')
    return { deploymentId: result.body.app?.pending_deployment?.id ?? null }
  }

  /** Deployment history, newest first. Read-only. */
  async listDeployments(appId: string, limit = 20): Promise<DeploymentSummary[]> {
    const result = await this.request<{ deployments?: RawDeployment[] }>(
      'GET',
      `apps/${appId}/deployments?per_page=${limit}`
    )
    this.assertOk(result, 'list deployments')
    return (result.body.deployments ?? []).map(summarizeDeployment)
  }

  /**
   * Asks whether a rollback would be accepted before starting one. Worth doing
   * separately: a rollback pins the app, and a pinned app refuses new
   * deployments until it is committed or reverted, so failing after the pin is
   * considerably worse than failing before it.
   */
  async validateRollback(appId: string, deploymentId: string): Promise<{ valid: boolean; reason: string | null }> {
    const result = await this.request<{ valid?: boolean; error?: { message?: string }; message?: string }>(
      'POST',
      `apps/${appId}/rollback/validate`,
      { deployment_id: deploymentId }
    )
    if (result.status >= 400) {
      return { valid: false, reason: result.body.error?.message ?? result.body.message ?? `HTTP ${result.status}` }
    }
    return { valid: result.body.valid !== false, reason: null }
  }

  /** Starts the rollback. The app is pinned from here until commit or revert. */
  async createRollback(appId: string, deploymentId: string): Promise<string | null> {
    const result = await this.request<{ deployment?: { id: string } }>('POST', `apps/${appId}/rollback`, {
      deployment_id: deploymentId,
    })
    this.assertOk(result, 'start the rollback')
    return result.body.deployment?.id ?? null
  }

  /** Makes the rollback permanent and unpins the app so deploys work again. */
  async commitRollback(appId: string): Promise<void> {
    const result = await this.request('POST', `apps/${appId}/rollback/commit`)
    this.assertOk(result, 'commit the rollback')
  }

  /** Abandons a rollback and returns the app to the spec it had before it. */
  async revertRollback(appId: string): Promise<void> {
    const result = await this.request('POST', `apps/${appId}/rollback/revert`)
    this.assertOk(result, 'revert the rollback')
  }

  /**
   * Runtime logs for the active deployment. The API hands back URLs to stored
   * log files rather than the text itself.
   */
  /**
   * Runtime logs for the live deployment.
   *
   * App Platform does not return log text. It returns short-lived proxy URLs
   * that carry their own access token, so those URLs are secrets: they are
   * never logged, and never put in an error message.
   *
   * `historic_urls` holds archived chunks and is empty unless log forwarding is
   * configured, which is why reading only that field returned nothing for an
   * app that was plainly running and serving traffic. The live `url` is a
   * websocket endpoint that also answers a plain GET with everything currently
   * buffered, which is what makes a one-shot `logs` command possible at all.
   *
   * The buffer is small and holds only the running container's output, so a
   * container that was replaced takes its logs with it. That is App Platform's
   * retention, not a limit we impose, and `logs` says so rather than implying
   * the app was silent.
   */

  async deploymentStatus(appId: string, deploymentId: string): Promise<DeploymentStatus> {
    const result = await this.request<{ deployment?: { id: string; phase: string } }>(
      'GET',
      `apps/${appId}/deployments/${deploymentId}`
    )
    this.assertOk(result, 'read the deployment')
    const phase = result.body.deployment?.phase ?? 'UNKNOWN'
    const failed = ['ERROR', 'CANCELED'].includes(phase)
    return { id: deploymentId, phase, done: phase === 'ACTIVE' || failed, ok: phase === 'ACTIVE' }
  }

  // -------------------------------------------------------------------- logs

  /**
   * Runtime logs for the live deployment.
   *
   * App Platform does not return log text. It returns short-lived proxy URLs
   * that carry their own access token, so those URLs are secrets: they are
   * never logged, and never put in an error message.
   *
   * `historic_urls` holds archived chunks and is empty unless log forwarding is
   * configured, which is why reading only that field returned nothing for an
   * app that was plainly running and serving traffic. The live `url` is a
   * websocket endpoint that also answers a plain GET with everything currently
   * buffered, which is what makes a one-shot `logs` command possible at all.
   */
  async runLogs(appId: string): Promise<string> {
    const result = await this.request<AppLogs>('GET', `apps/${appId}/logs?type=RUN`)
    this.assertOk(result, 'read logs')

    const sources = [...(result.body.historic_urls ?? [])]
    if (result.body.url) sources.push(result.body.url)

    const chunks = await Promise.all(sources.map((url) => readLogUrl(url)))
    return chunks.filter(Boolean).join('')
  }

  /**
   * The live log stream endpoint.
   *
   * Returned rather than consumed here because following is a long-lived
   * operation the caller drives. The URL carries its own access token, so it is
   * a secret: it must never be printed, logged, or put in an error message.
   */
  async runLogStreamUrl(appId: string): Promise<string | null> {
    const result = await this.request<AppLogs>('GET', `apps/${appId}/logs?type=RUN&follow=true`)
    this.assertOk(result, 'open the log stream')
    return result.body.live_url ?? result.body.url ?? null
  }
}

/**
 * App Platform and the container registry use different region namespaces: the
 * app runs in `blr` while the registry lives in `blr1`. Passing an app region to
 * the registry API fails with "invalid or unsupported region", which is how this
 * was found. The mapping is resolved against the API's own list rather than
 * hardcoded, so a new datacenter needs no code change.
 *
 * Where a city has several datacenters, the first the API lists wins, which is
 * the newest generation.
 */
export function matchRegistryRegion(appRegion: string, available: string[]): string | null {
  return available.find((region) => region.replace(/\d+$/, '') === appRegion) ?? null
}

/** The App Platform spec nextship generates. Only the fields it actually sets. */
export interface AppSpec {
  name: string
  region: string
  services: Array<{
    name: string
    image: { registry_type: 'DOCR'; repository: string; tag: string }
    http_port: number
    instance_size_slug: string
    instance_count: number
    health_check: {
      http_path: string
      initial_delay_seconds: number
      period_seconds: number
      failure_threshold: number
    }
  }>
}

/**
 * An app spec as App Platform returns it, including every field nextship does
 * not manage.
 */
export type RawAppSpec = Record<string, unknown>

/**
 * Folds the spec nextship manages into the spec the app already has.
 *
 * `PUT /apps/{id}` replaces the spec wholesale: whatever the request omits is
 * gone. nextship builds its spec from scratch every deploy, so sending that
 * directly would silently drop anything added elsewhere. The live app already
 * carries an `ingress` block nextship never sends, and the same path would take
 * custom domains, alerts, runtime environment variables and any second
 * component with it.
 *
 * So the existing spec is the base, and only the fields nextship is responsible
 * for are written over it: the app name and region, and within its own service
 * the image, port, instance size, instance count and health check. Objects are
 * merged rather than replaced, which keeps values such as the registry name
 * that App Platform fills in itself. Every other service is left exactly as it
 * was.
 */
export function mergeAppSpec(existing: RawAppSpec | null, managed: AppSpec): RawAppSpec {
  if (!existing) return managed as unknown as RawAppSpec

  const managedService = managed.services[0]
  const services = Array.isArray(existing.services) ? [...(existing.services as RawAppSpec[])] : []
  const index = services.findIndex((service) => service?.name === managedService.name)
  const previous = index >= 0 ? services[index] : {}

  const merged: RawAppSpec = {
    ...previous,
    ...managedService,
    // Merged rather than replaced: App Platform adds `registry` to the image
    // itself, and replacing the object outright would drop it every deploy.
    image: { ...(previous.image as RawAppSpec | undefined), ...managedService.image },
    health_check: { ...(previous.health_check as RawAppSpec | undefined), ...managedService.health_check },
  }

  if (index >= 0) services[index] = merged
  else services.push(merged)

  return { ...existing, name: managed.name, region: managed.region, services }
}

export function buildAppSpec(options: {
  name: string
  region: string
  repository: string
  tag: string
  port: number
  instanceSize: string
  /** A route that is cheap to serve, chosen at build time. Falls back to `/`. */
  healthPath?: string | null
}): AppSpec {
  return {
    name: options.name,
    region: options.region,
    services: [
      {
        name: 'web',
        image: { registry_type: 'DOCR', repository: options.repository, tag: options.tag },
        http_port: options.port,
        instance_size_slug: options.instanceSize,
        // One instance, deliberately. Next.js's cache is per process, and more
        // than one would diverge without the shared cache handler that is v2.
        instance_count: 1,
        health_check: {
          // App Platform runs its own check and ignores the image's HEALTHCHECK.
          // The path comes from the build, which knows which routes are
          // prerendered: polling a rendered route every few seconds is a cost
          // that never stops. `/` is the fallback when nothing is prerendered.
          http_path: options.healthPath ?? '/',
          // The container reports ready in well under a second, but the image
          // pull before it does not.
          initial_delay_seconds: 20,
          period_seconds: 15,
          failure_threshold: 5,
        },
      },
    ],
  }
}

/**
 * Tags the local image for the registry and pushes it, authenticating through a
 * throwaway config directory that is removed afterwards whatever happens.
 */
export async function pushImage(options: {
  localTag: string
  remoteTag: string
  configDir: string
  cwd: string
}): Promise<void> {
  try {
    await run('docker', ['tag', options.localTag, options.remoteTag], { cwd: options.cwd })
    await run('docker', ['--config', options.configDir, 'push', options.remoteTag], { cwd: options.cwd })
  } finally {
    await rm(options.configDir, { recursive: true, force: true })
  }
}
