/**
 * @nextship/cli: the DigitalOcean driver
 *
 * Implements `Target` in App Platform's terms, and keeps those terms here.
 *
 * The orchestration a command used to do now lives in this file, because it was
 * never portable. Rolling back pins the app and then commits or reverts, and a
 * failure anywhere in that sequence has to clear the pin or the app refuses
 * every later deployment. Updating replaces the whole spec, so the current one
 * has to be read and merged first or a deploy silently drops a custom domain.
 * Reclaiming storage is a separate collection pass that makes the entire
 * registry read-only. On AWS none of those are true, so a command that knew
 * about them could not be pointed at a second cloud.
 *
 * Author: Gowtham
 * Design: ../../../../docs/design.md §9, §10
 */

import { NextshipError } from '../errors.js'
import {
  DEFAULT_INSTANCE_SIZE,
  DigitalOcean,
  REGISTRY_HOST,
  buildAppSpec,
  matchRegistryRegion,
  mergeAppSpec,
  pushImage,
  type RawAppSpec,
} from './digitalocean.js'
import {
  addDomainToSpec,
  allEnvs,
  classify,
  effectiveRole,
  mergeEnvs,
  removeDomainFromSpec,
  serviceEnvs,
  specDomains,
  withServiceEnvs,
  withoutEnvs,
  type DomainSpec,
} from './digitalocean-spec.js'
import { DEFAULT_PLATFORM } from '../image/dockerfile.js'
import type {
  AppAddress,
  AppRef,
  DeployPlanContext,
  DeploymentRecord,
  DnsInstruction,
  DomainState,
  EnvRecord,
  EnvStorageWording,
  ImageBuilder,
  ImageRecord,
  PhaseReporter,
  ReclaimOutcome,
  ReleaseRequest,
  StorageWording,
  DestroyPlan,
  Target,
} from './target.js'

/** How long to wait for App Platform to report a terminal phase. */
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000
const ROLLBACK_TIMEOUT_MS = 10 * 60 * 1000
const POLL_INTERVAL_MS = 10_000
/** How long to wait for the log server to answer a close before finishing anyway. */
const CLOSE_GRACE_MS = 2000

/** The region a first deploy uses when `--region` is not given. */
export const DEFAULT_REGION = 'blr'

/** Where a DigitalOcean project runs and keeps its images, from nextship.json or deploy's flags. */
export interface DigitalOceanPlacement {
  region: string
  registry: string
  /** The app name, which is also its repository in the registry. */
  name: string
}

/** Phases that mean a deployment took traffic, and so is a valid rollback target. */
const SERVED_PHASES = new Set(['ACTIVE', 'SUPERSEDED'])

export class DigitalOceanTarget implements Target {
  readonly id = 'digitalocean'
  readonly displayName = 'DigitalOcean'
  readonly appScope = 'in this account'

  constructor(
    private readonly api: DigitalOcean,
    private readonly placement: DigitalOceanPlacement
  ) {}

  // ------------------------------------------------------------- ownership

  async listApps(): Promise<AppRef[]> {
    return this.api.listApps()
  }

  async requireApp(appId: string): Promise<AppRef> {
    const apps = await this.api.listApps()
    const app = apps.find((entry) => entry.id === appId)
    if (!app) {
      throw new NextshipError(
        `nextship.json records app ${appId}, which no longer exists in this account.`,
        'Remove the appId from nextship.json to create a new app, after confirming the old one is really gone.'
      )
    }
    return app
  }

  // ------------------------------------------------------------------ plan

  async planLines(context: DeployPlanContext): Promise<string[]> {
    return [
      `target        DigitalOcean, region ${this.placement.region}`,
      ...context.delivery,
      context.appId
        ? `app           UPDATE "${context.name}" (${context.appId}), which nextship created`
        : `app           CREATE "${context.name}" on ${context.instanceSize ?? DEFAULT_INSTANCE_SIZE}`,
      `instance      ${context.instanceSize ?? DEFAULT_INSTANCE_SIZE}, 1 instance`,
      `project       default (this token cannot assign projects)`,
    ]
  }

  readonly envStorage: EnvStorageWording = {
    secret: 'encrypted, not readable afterwards',
    plain: 'readable, already public in the browser',
    notice: 'These values leave your machine and are stored in your DigitalOcean account.',
    listedSecret: 'secret, value not readable',
    listedPlain: 'plain, readable',
    removal: 'A secret cannot be read back, so its value is gone once removed. Have a copy before you continue.',
    unchanged:
      'Every variable in this push is already set. A stored secret is never returned, so nextship ' +
      'cannot tell whether any value actually differs, and this will restart the app either way.',
  }

  readonly deployRemoves = null

  readonly rollbackNotes: string[] = []

  async actionsKey(): Promise<string | null> {
    return null
  }

  // ----------------------------------------------------------------- build

  async buildPlatform(): Promise<string> {
    return DEFAULT_PLATFORM
  }

  async builder(): Promise<ImageBuilder> {
    return { dockerHost: null, cacheScope: null, warning: null, close: async () => {} }
  }

  /**
   * DigitalOcean allows one registry per account, shared by every project, so
   * one is created only when the account has none and otherwise the existing
   * one is used untouched.
   */
  async planDelivery(name: string): Promise<string[]> {
    const existing = await this.api.getRegistry()
    return [
      existing
        ? `registry      use existing "${existing}", unchanged`
        : `registry      CREATE "${this.placement.registry}" on the Basic tier, 5 GiB, $5/month`,
      `repository    ${existing ?? this.placement.registry}/${name}`,
    ]
  }

  async deliverImage(options: {
    localTag: string
    name: string
    tag: string
    cwd: string
    onPhase: PhaseReporter
  }): Promise<{ reference: string | null; store: string | null }> {
    let store = await this.api.getRegistry()
    if (!store) {
      store = this.placement.registry
      options.onPhase(`creating an image store named "${store}" (Basic, $5/month)`)
      await this.createRegistry(store)
    }

    const reference = `${REGISTRY_HOST}/${store}/${options.name}:${options.tag}`
    await pushImage({
      localTag: options.localTag,
      remoteTag: reference,
      configDir: await this.api.dockerConfigDir(),
      cwd: options.cwd,
    })
    return { reference, store }
  }

  private async createRegistry(name: string): Promise<void> {
    // An App Platform region and a registry region are different namespaces:
    // the app region `blr` corresponds to the registry region `blr1`.
    const region = this.placement.region
    const available = await this.api.registryRegions()
    const registryRegion = matchRegistryRegion(region, available)
    if (!registryRegion) {
      throw new NextshipError(
        `No container registry region corresponds to the app region "${region}".`,
        `The registry supports: ${available.join(', ')}. Choose an app region in one of those cities with --region.`
      )
    }
    await this.api.createRegistry(name, registryRegion)
  }

  // --------------------------------------------------------------- release

  async release(
    appId: string | null,
    request: ReleaseRequest
  ): Promise<{ appId: string; deploymentId: string | null }> {
    const spec = buildAppSpec({
      ...request,
      region: this.placement.region,
      instanceSize: request.instanceSize ?? DEFAULT_INSTANCE_SIZE,
    })

    if (!appId) {
      const created = await this.api.createApp(spec)
      return { appId: created.id, deploymentId: created.deploymentId }
    }

    // Read first, then write over only what nextship manages. A spec built from
    // scratch would drop anything added in the control panel, because the API
    // replaces the whole spec rather than patching it.
    const current = await this.api.getAppSpec(appId)
    await this.assertIdle(appId)
    const updated = await this.api.updateApp(appId, mergeAppSpec(current, spec))
    return { appId, deploymentId: updated.deploymentId }
  }

  async awaitRelease(appId: string, deploymentId: string, onPhase: PhaseReporter, replacing: boolean): Promise<void> {
    const logs = 'Check the build and runtime logs in the DigitalOcean control panel.'
    await this.poll(appId, deploymentId, onPhase, DEPLOY_TIMEOUT_MS, {
      failed: replacing
        ? `The previous revision keeps serving. ${logs}`
        : `This was the app's first deployment, so nothing is serving yet. ${logs}`,
      timedOut: 'It may still succeed. Nothing was rolled back or deleted. Check the control panel.',
    })
  }

  async assertIdle(appId: string): Promise<void> {
    const running = (await this.api.getAppStatus(appId))?.deploymentInProgress
    if (!running) return

    throw new NextshipError(
      `This app already has a deployment in progress: ${running.id}, ${running.phase.toLowerCase().replace(/_/g, ' ')}.`,
      'Wait for it to finish, then run the command again; a change written now would replace it part way through. ' +
        'Its progress shows in the DigitalOcean control panel.'
    )
  }

  async address(appId: string): Promise<AppAddress | null> {
    const status = await this.api.getAppStatus(appId)
    if (!status) return null

    const spec = await this.api.getAppSpec(appId)
    const live = new Map(status.domains.map((entry) => [entry.domain, entry.phase]))

    return {
      platformHost: status.defaultIngress,
      platformUrl: status.defaultIngress ? `https://${status.defaultIngress}` : null,
      domains: specDomains(spec).map((entry) => ({
        domain: entry.domain,
        primary: entry.type === 'PRIMARY',
        state: domainState(live.get(entry.domain)),
        detail: describePhase(live.get(entry.domain)),
      })),
    }
  }

  /**
   * What an update will keep rather than overwrite.
   *
   * Reported because the guarantee is worth showing: the API replaces the whole
   * spec, so "these survive" is a claim the plan should make explicitly rather
   * than leave the user to trust.
   */
  async preservedSettings(appId: string): Promise<string[]> {
    const spec = await this.api.getAppSpec(appId)
    if (!spec) return []

    const managed = new Set(['name', 'region', 'services'])
    const fields = Object.keys(spec).filter((key) => !managed.has(key))

    const envs = serviceEnvs(spec)
    if (envs.length > 0) fields.push(`${envs.length} env var(s)`)

    const services = Array.isArray(spec.services) ? spec.services.length : 0
    if (services > 1) fields.push(`${services - 1} other component(s)`)

    return fields
  }

  // -------------------------------------------------------------- rollback

  async deployments(appId: string): Promise<DeploymentRecord[]> {
    const deployments = await this.api.listDeployments(appId)
    return deployments.map((entry) => ({
      id: entry.id,
      served: SERVED_PHASES.has(entry.phase),
      live: entry.phase === 'ACTIVE',
      cause: entry.cause,
      createdAt: entry.createdAt,
      imageTag: entry.imageTag,
    }))
  }

  /**
   * App Platform's three-step rollback, kept behind one call.
   *
   * Creating a rollback **pins** the app, and a pinned app refuses every further
   * deployment until the rollback is committed or reverted. Leaving one pinned
   * is the only way this can cause lasting trouble, so the pin is validated
   * before it is taken, committed the moment the deployment reports active, and
   * reverted on every failure path in between.
   */
  async rollback(appId: string, deploymentId: string, onPhase: PhaseReporter): Promise<void> {
    const validation = await this.api.validateRollback(appId, deploymentId)
    if (!validation.valid) {
      throw new NextshipError(
        `DigitalOcean will not roll back to ${deploymentId}: ${validation.reason ?? 'no reason given'}.`,
        'The image for that deployment may no longer exist in the registry. Nothing was changed.'
      )
    }

    const rollbackDeployment = await this.api.createRollback(appId, deploymentId)
    if (!rollbackDeployment) {
      await this.revertQuietly(appId, onPhase)
      throw new NextshipError(
        'DigitalOcean accepted the rollback but returned no deployment to follow.',
        'The rollback was reverted so the app is not left pinned. Check the control panel.'
      )
    }

    try {
      await this.poll(appId, rollbackDeployment, onPhase, ROLLBACK_TIMEOUT_MS, {
        failed: 'Check the logs in the DigitalOcean control panel.',
        timedOut: 'Check the control panel.',
      })
    } catch (error) {
      await this.revertQuietly(appId, onPhase)
      throw error
    }

    await this.api.commitRollback(appId)
    onPhase('committed, the app accepts new deployments again')
  }

  /**
   * Clears the pin after a failure.
   *
   * A failure to revert is reported rather than thrown, because it must not mask
   * the original error, but the user has to know the app is still pinned.
   */
  private async revertQuietly(appId: string, onPhase: PhaseReporter): Promise<void> {
    try {
      await this.api.revertRollback(appId)
      onPhase('rollback reverted, the app is not left pinned')
    } catch {
      onPhase(
        'WARNING: the rollback could not be reverted, so the app is still pinned and will refuse new ' +
          'deployments. Commit or revert it in the DigitalOcean control panel.'
      )
    }
  }

  // ------------------------------------------------------------------- env

  async env(appId: string): Promise<EnvRecord[]> {
    const spec = await this.api.getAppSpec(appId)
    return allEnvs(spec).map((entry) => ({
      key: entry.key,
      secret: entry.type === 'SECRET',
      location: entry.location,
    }))
  }

  async previewEnv(
    appId: string,
    values: Map<string, string>
  ): Promise<Array<{ key: string; action: 'add' | 'update'; secret: boolean }>> {
    const spec = await this.api.getAppSpec(appId)
    const existing = new Map(serviceEnvs(spec).map((entry) => [entry.key, entry]))

    return [...values.keys()].sort().map((key) => ({
      key,
      action: existing.has(key) ? ('update' as const) : ('add' as const),
      secret: classify(key, existing.get(key)).type === 'SECRET',
    }))
  }

  async setEnv(appId: string, values: Map<string, string>): Promise<void> {
    const spec = await this.requireSpec(appId)
    await this.assertIdle(appId)
    await this.api.updateApp(appId, withServiceEnvs(spec, mergeEnvs(serviceEnvs(spec), values)))
  }

  async unsetEnv(appId: string, keys: string[]): Promise<void> {
    const spec = await this.requireSpec(appId)
    await this.assertIdle(appId)
    await this.api.updateApp(appId, withServiceEnvs(spec, withoutEnvs(serviceEnvs(spec), keys)))
  }

  // --------------------------------------------------------------- domains

  async attachDomain(
    appId: string,
    domain: string,
    options: { primary: boolean; minimumTls: string }
  ): Promise<DnsInstruction> {
    const spec = await this.requireSpec(appId)
    const status = await this.api.getAppStatus(appId)
    const target = status?.defaultIngress
    if (!target) {
      throw new NextshipError(
        'App Platform has not reported a hostname for this app yet.',
        'Wait for the first deployment to finish, then run this again. Nothing was changed.'
      )
    }

    const entry: DomainSpec = {
      domain,
      type: effectiveRole(specDomains(spec).length, options.primary),
      minimum_tls_version: options.minimumTls,
    }
    await this.assertIdle(appId)
    await this.api.updateApp(appId, addDomainToSpec(spec, entry))

    return {
      type: 'CNAME',
      name: domain,
      value: target,
      notes: [
        'Some control panels ask only for the part before your registered domain.',
        'If this is your root domain, most providers cannot point it with a CNAME:',
        'use an ALIAS or ANAME record, or move the domain to DigitalOcean DNS.',
      ],
    }
  }

  async detachDomain(appId: string, domain: string): Promise<void> {
    const spec = await this.requireSpec(appId)
    await this.assertIdle(appId)
    await this.api.updateApp(appId, removeDomainFromSpec(spec, domain))
  }

  /**
   * Refused as custom domains before any request is sent. The AWS suffixes are
   * kept from before drivers named their own, so what this refuses is unchanged.
   */
  readonly platformSuffixes = ['.ondigitalocean.app', '.awsapprunner.com', '.amazonaws.com']

  async domainWarnings(): Promise<string[]> {
    return []
  }

  // ---------------------------------------------------------------- images

  async images(repository: string): Promise<ImageRecord[]> {
    const store = await this.requireStore()
    const manifests = await this.api.listManifests(store, repository)
    return manifests.map((entry) => ({
      id: entry.digest,
      tags: entry.tags,
      children: entry.children,
      sizeBytes: entry.sizeBytes,
      updatedAt: entry.updatedAt,
    }))
  }

  async removeImages(repository: string, ids: string[]): Promise<void> {
    const store = await this.requireStore()
    for (const id of ids) await this.api.deleteManifest(store, repository, id)
  }

  /**
   * Deleting a manifest frees nothing on DigitalOcean until collection runs.
   *
   * Measured: deleting and then collecting reported 0 blobs deleted and 0 bytes
   * freed when only a tag had been removed, because the manifest survived
   * untagged and kept referencing its layers. Collection also puts the whole
   * registry into read-only mode, which is why it is never implicit in a deploy.
   */
  async reclaim(): Promise<ReclaimOutcome> {
    const store = await this.requireStore()
    const active = await this.api.activeGarbageCollection(store)
    if (active) return { kind: 'already-running', detail: active.status }

    await this.api.startGarbageCollection(store)
    return {
      kind: 'started',
      detail: [
        'It can take several minutes to begin, because the registry waits for existing',
        'write authorisations to expire first. Storage is reclaimed when it finishes.',
      ],
    }
  }

  readonly storage: StorageWording = {
    reclaimWarning:
      'Garbage collection puts the registry into read-only mode while it runs, so a deploy during it will fail to push.',
    heldUntilReclaimed: 'layers are not freed until garbage collection runs; add --gc to start it',
    usage: 'used in the registry, across every repository',
  }

  async storageBytes(): Promise<number | null> {
    const usage = await this.api.registryUsage()
    return usage?.storageBytes ?? null
  }

  // ------------------------------------------------------------------ logs

  async readLogs(appId: string): Promise<string> {
    return this.api.runLogs(appId)
  }

  readonly emptyLogs = [
    'The running container has no buffered output.',
    'The platform keeps only the current container recent logs, so output from a',
    'replaced deployment is already gone.',
  ]

  async deploymentLogs(): Promise<string> {
    throw new NextshipError(
      'App Platform keeps logs only for the container running now, so there is no history to read by deployment.',
      'Use `nextship logs` for the running deployment. Keeping history needs log forwarding, which nextship does not configure.'
    )
  }

  /**
   * Follows App Platform's log websocket.
   *
   * The stream URL carries its own access token, so it is treated as a secret
   * throughout: never printed, never logged, never put in an error message.
   * The server ends the stream on its own because these URLs expire, and that
   * is reported rather than left to look like the app went quiet.
   */
  async followLogs(appId: string, write: (text: string) => void, signal: AbortSignal): Promise<string | null> {
    const url = await this.api.runLogStreamUrl(appId)
    if (!url) {
      throw new NextshipError(
        'The target returned no log stream for this app.',
        'It may have no running container yet. Try `nextship logs` without --follow.'
      )
    }

    const socket = new WebSocket(url.replace(/^http/, 'ws'))

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve()
      }

      const stop = (): void => {
        // 1000 is a normal closure, which tells the server this was deliberate
        // rather than a dropped connection.
        try {
          socket.close(1000)
        } catch {
          // Already closing or closed, so there is nothing left to ask for.
        }
        // Registering a SIGINT handler stops Node exiting on Ctrl+C, so if the
        // server never completes the close handshake the command would hang
        // with no way out but killing it. Measured: a close request that was
        // never answered left the process running indefinitely. The timer is
        // unref'd so it never keeps the process alive on its own.
        setTimeout(finish, CLOSE_GRACE_MS).unref()
      }
      if (signal.aborted) stop()
      else signal.addEventListener('abort', stop, { once: true })

      socket.onmessage = (event) => write(frameText(event.data))
      socket.onclose = finish
      socket.onerror = () => {
        if (settled) return
        // The event carries no useful detail, and anything it did carry could
        // include the tokenised URL, so the message is written here instead.
        if (signal.aborted) finish()
        else {
          settled = true
          reject(
            new NextshipError(
              'The log stream closed unexpectedly.',
              'The stream URL is short-lived. Run the command again to reconnect.'
            )
          )
        }
      }
    })

    return signal.aborted ? null : 'The stream ended. These URLs are short-lived; run the command again to reconnect.'
  }

  // --------------------------------------------------------------- destroy

  async destroyApp(appId: string): Promise<void> {
    await this.api.deleteApp(appId)
  }

  async destroyPlan(appId: string, options: { images: boolean; imageCount: number }): Promise<DestroyPlan> {
    const address = await this.address(appId)
    const domains = address?.domains ?? []
    const repository = `${this.placement.registry}/${this.placement.name}`
    return {
      lines: [
        `address    ${address?.platformHost ?? 'not yet assigned'} stops serving and is not reissued`,
        ...domains.map((domain) => `domain     ${domain.domain} stops serving this app`),
        options.images && options.imageCount > 0
          ? `images     remove all ${options.imageCount} image(s) from ${repository}, then collect`
          : options.images
            ? `images     none in ${repository}, nothing to remove`
            : `images     kept in ${this.placement.registry}; run \`nextship images prune --gc --yes\` first if you want them gone`,
        'registry   kept, it is shared by every project on this account',
        'DNS        untouched, nextship did not create your records',
      ],
      warnings: [
        ...(options.images && options.imageCount > 0
          ? [
              'Garbage collection runs afterwards and puts the whole registry into read-only mode, ' +
                'so a deploy of any other project during it will fail to push.',
            ]
          : []),
        ...(domains.length > 0
          ? [
              'A replacement app gets a new generated hostname, so the DNS record for ' +
                `${domains.map((domain) => domain.domain).join(', ')} will point at nothing until you update it.`,
            ]
          : []),
      ],
    }
  }

  // ----------------------------------------------------------------- inner

  /** The spec, refusing to continue when the recorded app is gone. */
  private async requireSpec(appId: string): Promise<RawAppSpec> {
    const spec = await this.api.getAppSpec(appId)
    if (!spec) {
      throw new NextshipError(
        `nextship.json records app ${appId}, which no longer exists in this account.`,
        'Remove the appId from nextship.json to create a new app, after confirming the old one is really gone.'
      )
    }
    return spec
  }

  private async requireStore(): Promise<string> {
    const store = await this.api.getRegistry()
    if (!store) {
      throw new NextshipError(
        'This account has no container registry.',
        'Run `nextship deploy` first, which creates one after showing you the cost.'
      )
    }
    return store
  }

  /** Polls a deployment to a terminal phase, reporting each change once. */
  private async poll(
    appId: string,
    deploymentId: string,
    onPhase: PhaseReporter,
    timeoutMs: number,
    messages: { failed: string; timedOut: string }
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let lastPhase = ''

    for (;;) {
      const status = await this.api.deploymentStatus(appId, deploymentId)
      if (status.phase !== lastPhase) {
        onPhase(status.phase.toLowerCase().replace(/_/g, ' '))
        lastPhase = status.phase
      }

      if (status.done) {
        if (status.ok) return
        throw new NextshipError(`The deployment finished in phase ${status.phase}.`, messages.failed)
      }

      if (Date.now() > deadline) {
        throw new NextshipError(
          `The deployment did not finish within ${timeoutMs / 60000} minutes; it is still ${status.phase}.`,
          messages.timedOut
        )
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }
}

/** One frame of the log stream. Anything else is ignored rather than printed raw. */
interface LogFrame {
  op?: string
  data?: string
}

/**
 * Turns one frame into text.
 *
 * Frames are JSON objects carrying the line in `data`. A frame that is not JSON
 * is printed as it arrived rather than dropped, because losing output is worse
 * than printing something unexpected, but it is never parsed for meaning.
 */
export function frameText(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : String(raw)

  let frame: LogFrame
  try {
    frame = JSON.parse(text) as LogFrame
  } catch {
    return text.endsWith('\n') ? text : `${text}\n`
  }

  if (typeof frame.data !== 'string') return ''
  return frame.data.endsWith('\n') ? frame.data : `${frame.data}\n`
}

/** App Platform's phases, reduced to what a command needs to decide anything. */
function domainState(phase: string | undefined): DomainState {
  if (phase === 'ACTIVE') return 'live'
  if (phase === 'ERROR') return 'failed'
  if (phase === undefined) return 'unknown'
  return 'pending'
}

/**
 * Turns a phase into something that says what to do about it.
 *
 * `CONFIGURING` is reached immediately on attaching, before DNS exists, so it
 * must not claim the record was found. Verified against a hostname with no
 * record at all: the phase was `CONFIGURING` while the name did not resolve.
 */
function describePhase(phase: string | undefined): string {
  switch (phase) {
    case 'ACTIVE':
      return 'live, certificate issued'
    case 'PENDING':
      return 'waiting to be set up'
    case 'CONFIGURING':
      return 'being set up; serves once DNS points here and a certificate is issued'
    case 'ERROR':
      return 'failed, check the control panel'
    case undefined:
      return 'not reported yet'
    default:
      return phase.toLowerCase()
  }
}
