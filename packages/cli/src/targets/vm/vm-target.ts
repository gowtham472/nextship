/**
 * @nextship/cli: the VM driver
 *
 * Implements `Target` for any Ubuntu or Debian server that `nextship server add`
 * prepared, reached over SSH as the `nextship` user.
 *
 * A server has none of the machinery App Platform provides, so this driver owns
 * all of it: where state lives (`/etc/nextship/apps/<name>/`), how a deployment
 * replaces another without dropping a request, how history is kept for rollback,
 * and how Caddy is told where to send traffic. Each of those has its own module;
 * this one is the orchestration, and the order of that orchestration is the
 * guarantee a deployment makes:
 *
 *   1. take the app's lock
 *   2. create or verify the app's ownership record
 *   3. start the new container, with no published port
 *   4. wait for Docker to report it healthy; on failure remove it, record the
 *      failure, and leave the previous container serving
 *   5. point Caddy at it, validated first and restored if the reload fails
 *   6. stop the previous container, record the new one as live, prune old images
 *
 * Nothing before step 5 changes what visitors see, which is why a failure at any
 * earlier step leaves the previous deployment serving.
 *
 * Only containers labelled `sh.nextship.managed=true` and `sh.nextship.app=<name>`
 * are ever stopped or removed, so other workloads on the server are untouchable.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import { connect as tlsConnect } from 'node:tls'
import { lookup } from 'node:dns/promises'
import { connect as netConnect, createServer } from 'node:net'
import { NextshipError } from '../../errors.js'
import type { ProjectConfig, ServerRecord } from '../../config.js'
import { DEFAULT_KEEP } from '../../images.js'
import { pipeline } from '../../util/exec.js'
import type {
  AppAddress,
  AppRef,
  DeployPlanContext,
  DeploymentRecord,
  DnsInstruction,
  DomainRecord,
  EnvRecord,
  EnvStorageWording,
  ImageBuilder,
  ImageRecord,
  PhaseReporter,
  ReclaimOutcome,
  ReleaseRequest,
  StorageWording,
  Target,
} from '../target.js'
import { decideKey, KEY_ENV } from './actions-key.js'
import { renderSite, type SiteDomain } from './caddy.js'
import {
  imagesToKeep,
  newReleaseId,
  parseDeployments,
  recordFailed,
  recordLive,
  recordStarted,
  serializeDeployments,
  type VmDeployment,
} from './deployments.js'
import { parseEnvFile, renderEnvFile } from './env-file.js'
import { heldLockError, parseOwner } from './lock.js'
import { Ssh, assertAppName, assertDeploymentId, assertDomain, shellQuote } from './ssh.js'

const ETC = '/etc/nextship'
const CADDY_DIR = `${ETC}/caddy`
const DEFAULT_APP_FILE = `${ETC}/default-app`

/** How long a new container has to report healthy before the deployment fails. */
const HEALTH_TIMEOUT_MS = 5 * 60 * 1000
const HEALTH_POLL_MS = 2000

/** Remote builds need room for the Next.js compiler beside what the server already runs. */
const REMOTE_BUILD_MIN_MIB = 1800

/** Below this a build or an image load can fill the disk part way through. */
const MIN_FREE_DISK_MIB = 3 * 1024

/** The share of RAM app containers may use between them, leaving the rest to Docker, Caddy and the OS. */
const APP_MEMORY_SHARE = 0.8

/** What the app's ownership record holds on the server. */
export interface AppRecord {
  id: string
  name: string
  createdAt: string
  domains: SiteDomain[]
}

/** What a server reports in one round trip, for plans and guards. */
export interface ServerFacts {
  memMib: number
  diskFreeMib: number
  dockerVersion: string
  defaultApp: string | null
  ipv6: boolean
}

// ------------------------------------------------------------------- pure

/** Reads the one-shot facts script's output. */
export function parseFacts(output: string): ServerFacts {
  const [mem, disk, docker, defaultApp, ipv6] = output.split('\n')
  const memMib = Number.parseInt(mem, 10)
  const diskFreeMib = Number.parseInt(disk, 10)
  if (!Number.isFinite(memMib) || !Number.isFinite(diskFreeMib) || !docker) {
    throw new NextshipError(
      'The server did not report its memory, disk and Docker version.',
      'Run `nextship server add` again to check the server is set up.'
    )
  }
  return { memMib, diskFreeMib, dockerVersion: docker.trim(), defaultApp: defaultApp?.trim() || null, ipv6: ipv6?.trim() === 'yes' }
}

/** Refuses a deployment the server has no room for, before anything is built. */
export function assertRoom(facts: ServerFacts, build: 'remote' | 'local'): void {
  if (facts.diskFreeMib < MIN_FREE_DISK_MIB) {
    throw new NextshipError(
      `The server has ${(facts.diskFreeMib / 1024).toFixed(1)} GB free, below the 3 GB a deployment needs.`,
      'Free space first: `nextship images prune --yes` removes old images, and `nextship server status` shows what is using the disk.'
    )
  }
  if (build === 'remote' && facts.memMib < REMOTE_BUILD_MIN_MIB) {
    throw new NextshipError(
      `The server has ${facts.memMib} MiB of RAM, too little to build Next.js on it.`,
      'Build on this machine instead with `nextship deploy --build local`, which sends the finished image to the server.'
    )
  }
}

/**
 * The memory limit for a container: an even share of most of the server's RAM
 * across its apps, so one app cannot starve the others or the server itself.
 */
export function memoryLimit(memMib: number, appCount: number, requested: string | null): string {
  if (requested !== null) {
    if (!/^\d+[mg]$/i.test(requested)) {
      throw new NextshipError(`--memory "${requested}" is not a size.`, 'Use megabytes or gigabytes, for example 512m or 2g.')
    }
    return requested.toLowerCase()
  }
  return `${Math.max(256, Math.floor((memMib * APP_MEMORY_SHARE) / Math.max(appCount, 1)))}m`
}

/** The health check a container runs: the adapter's cheap path, polled the way the image's own check polls `/`. */
export function healthCommand(healthPath: string | null): string {
  const target = healthPath ?? '/'
  // Docker runs the check with `sh -c`, inside double quotes, so a character the
  // shell or the JavaScript string would read specially is refused, not escaped.
  if (!/^\/[A-Za-z0-9._~&()*+,;=:@%/-]*$/.test(target)) {
    throw new NextshipError(`The health path "${target}" is not a URL path.`, 'This is a nextship defect. Please report it.')
  }
  return (
    `node -e "fetch('http://127.0.0.1:'+process.env.PORT+${JSON.stringify(target).replace(/"/g, "'")},{method:'HEAD'})` +
    `.then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"`
  )
}

/**
 * `docker run` for one deployment. No port is published: Caddy reaches the
 * container on the nextship network, so nothing on the server's public address
 * bypasses the proxy. The interval, timeout and retries match the image's own
 * HEALTHCHECK; the start interval makes Docker check every two seconds while the
 * container starts, where Docker supports it, so a healthy deployment switches in
 * seconds rather than after the first 30 second interval.
 */
export function runArguments(options: {
  name: string
  releaseId: string
  imageTag: string
  memory: string
  healthPath: string | null
  dockerMajor: number
  /** The image's working directory, where its `.next` is. */
  workdir: string
}): string[] {
  const { name, releaseId, imageTag } = options
  const volumes = cacheVolumes(name, imageTag)
  return [
    'docker', 'run', '-d',
    '--name', `${name}-${releaseId}`,
    '--network', 'nextship',
    '--restart', 'unless-stopped',
    '--env-file', `${ETC}/apps/${name}/env`,
    '--memory', options.memory,
    '--log-driver', 'journald',
    '--log-opt', `tag=${name}`,
    '--volume', `${volumes.build}:${options.workdir}/.next`,
    '--volume', `${volumes.cache}:${options.workdir}/.next/cache`,
    '--label', 'sh.nextship.managed=true',
    '--label', `sh.nextship.app=${name}`,
    '--label', `sh.nextship.deployment=${releaseId}`,
    '--label', `sh.nextship.image=${imageTag}`,
    '--health-cmd', healthCommand(options.healthPath),
    '--health-interval', '30s',
    '--health-timeout', '5s',
    '--health-start-period', '10s',
    '--health-retries', '3',
    // API 1.44, Docker 25. Setup accepts Docker 23, which would refuse the flag.
    ...(options.dockerMajor >= 25 ? ['--health-start-interval', '2s'] : []),
    `${name}:${imageTag}`,
  ]
}

/**
 * The two volumes that keep what Next.js writes at runtime across restarts.
 *
 * Measured in a nextship image on a server, with `docker diff` after exercising
 * each feature: time-based and on-demand ISR rewrite the prerendered files under
 * `.next/server/app` (`isr.html`, `isr.rsc`, `isr.meta` and the segment files),
 * the image optimizer writes `.next/cache/images`, and `after()` writes nothing.
 * Without volumes all of it is lost on every restart.
 *
 * `build` is per image, mounted over the whole of `.next`: regenerated pages sit
 * beside the build's own files and are only valid for that build, so a new build
 * never serves an old one's pages, while a restart, an env change or a rollback to
 * that image keeps them. `cache` is shared by every deployment of the app, like
 * the `.next/cache` Next.js keeps between builds, and holds optimized images and
 * the fetch cache. Both are named volumes rather than bind mounts because Docker
 * fills an empty named volume from the image, with the image's ownership, and the
 * image's `app` user has no fixed uid a bind mount could be prepared for.
 * `.next/cache/images` is not mounted directly: it does not exist in the image, so
 * its volume would be created owned by root and the app could not write to it.
 */
export function cacheVolumes(name: string, imageTag: string): { build: string; cache: string } {
  return { build: `nextship-${name}-build-${imageTag}`, cache: `nextship-${name}-cache` }
}

/**
 * The containers a deployment stops once its own is live: this app's running
 * containers, by name, except the new one.
 *
 * Measured: an earlier version listed them with `docker ps -q --format
 * '{{.Names}}'`, where `-q` wins and prints ids, so comparing against the new
 * container's name matched nothing and the new container was stopped with the
 * old ones. Names are required here, and anything not named `<app>-r...` is
 * never returned.
 */
export function previousContainers(listing: string, name: string, current: string): string[] {
  return listing
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${name}-r`) && entry !== current)
}

/** Docker's human sizes, as `docker image ls` and `docker system df` print them. */
export function parseDockerSize(text: string): number {
  const match = /^([\d.]+)\s*(B|kB|KB|MB|GB|TB)$/.exec(text.trim())
  if (!match) return 0
  const factor = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[match[2] as 'B'] ?? 1
  return Math.round(Number(match[1]) * factor)
}

/** Adds or replaces a domain, keeping exactly one primary. The first domain is always primary. */
export function withDomain(domains: SiteDomain[], entry: SiteDomain): SiteDomain[] {
  const others = domains.filter((existing) => existing.domain !== entry.domain)
  const primary = entry.primary || others.length === 0
  return [
    ...others.map((existing) => (primary ? { ...existing, primary: false } : existing)),
    { ...entry, primary },
  ]
}

/** Removes a domain. When the primary goes, the oldest remaining one takes its place. */
export function withoutDomain(domains: SiteDomain[], domain: string): SiteDomain[] {
  const remaining = domains.filter((existing) => existing.domain !== domain)
  if (remaining.length > 0 && !remaining.some((existing) => existing.primary)) remaining[0] = { ...remaining[0], primary: true }
  return remaining
}

const q = shellQuote

// ----------------------------------------------------------------- driver

export class VmTarget implements Target {
  readonly id = 'vm'
  readonly displayName: string
  readonly appScope = 'on this server'
  readonly deployRemoves = `removes images older than the newest ${DEFAULT_KEEP} served deployments once this one is live; nothing else is deleted`

  private readonly server: ServerRecord
  private readonly name: string
  private readonly build: 'remote' | 'local'
  private connection: Promise<Ssh> | null = null

  constructor(config: ProjectConfig) {
    if (!config.server) {
      throw new NextshipError('This project has no server on record.', 'Run `nextship server add user@host` first.')
    }
    this.server = config.server
    this.name = assertAppName(config.name)
    this.build = config.build ?? 'remote'
    this.displayName = `your server ${config.server.host}`
  }

  readonly envStorage: EnvStorageWording = {
    secret: 'stored in a 0600 file on the server, readable by its root and nextship users',
    plain: 'stored on the server, and already public in the browser',
    notice: 'These values leave your machine and are stored on your server, in a file only root and the nextship user can read.',
  }

  readonly storage: StorageWording = { reclaimWarning: null, heldUntilReclaimed: null }

  readonly rollbackNotes = [
    'the current env file is used, not the one that deployment ran with: variables changed since then keep their new values',
  ]

  // ------------------------------------------------------------ connection

  private ssh(): Promise<Ssh> {
    this.connection ??= Ssh.open({ host: this.server.host, port: this.server.port, user: this.server.user, hostKey: this.server.hostKey })
    return this.connection
  }

  /** Ends the shared SSH connection. Called once when the command finishes. */
  async close(): Promise<void> {
    if (!this.connection) return
    const ssh = await this.connection
    this.connection = null
    await ssh.close()
  }

  private async run(command: string, what: string, stdin?: string): Promise<string> {
    return (await this.ssh()).run(command, what, { stdin })
  }

  private async exec(command: string, stdin?: string) {
    return (await this.ssh()).exec(command, { stdin })
  }

  private appDir(): string {
    return `${ETC}/apps/${this.name}`
  }

  private async facts(): Promise<ServerFacts> {
    const script = [
      "awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo",
      "df -Pk / | awk 'NR == 2 { print int($4 / 1024) }'",
      "docker version --format '{{.Server.Version}}'",
      `cat ${DEFAULT_APP_FILE} 2> /dev/null || echo`,
      "if ip -6 addr show scope global 2> /dev/null | grep -q inet6; then echo yes; else echo no; fi",
    ].join('; ')
    return parseFacts(await this.run(script, 'read the server\'s memory and disk'))
  }

  // ------------------------------------------------------------- ownership

  async listApps(): Promise<AppRef[]> {
    const output = await this.run(
      `for f in ${ETC}/apps/*/app.json; do [ -f "$f" ] && { cat "$f"; echo; }; done; true`,
      'list the apps on the server'
    )
    return output
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const record = JSON.parse(line) as AppRecord
        return { id: record.id, name: record.name }
      })
  }

  async requireApp(appId: string): Promise<AppRef> {
    const record = await this.appRecord(appId)
    return { id: record.id, name: record.name }
  }

  /** The app's record, refusing one whose id is not the project's. */
  private async appRecord(appId: string): Promise<AppRecord> {
    const result = await this.exec(`cat ${q(`${this.appDir()}/app.json`)}`)
    if (result.code !== 0) {
      throw new NextshipError(
        `nextship.json records app ${appId}, which does not exist on ${this.server.host}.`,
        'Remove the appId from nextship.json to create a new app, after confirming the old one is really gone.'
      )
    }
    const record = JSON.parse(result.stdout) as AppRecord
    if (record.id !== appId) {
      throw new NextshipError(
        `The app named "${this.name}" on ${this.server.host} is ${record.id}, not the ${appId} this project recorded.`,
        'nextship will not act on an app it did not create for this project. Rename this project, or remove the other app on the server.'
      )
    }
    return { ...record, domains: record.domains ?? [] }
  }

  private async writeAppRecord(record: AppRecord): Promise<void> {
    await this.run(`install -m 600 /dev/stdin ${q(`${this.appDir()}/app.json`)}`, 'write the app record', `${JSON.stringify(record)}\n`)
  }

  // ------------------------------------------------------------------ plan

  async planLines(context: DeployPlanContext): Promise<string[]> {
    const facts = await this.facts()
    assertRoom(facts, this.build)
    const apps = await this.listApps()
    const appCount = apps.length + (context.appId ? 0 : 1)
    const others = apps.filter((app) => app.id !== context.appId)
    const isDefault = facts.defaultApp === this.name || (facts.defaultApp === null && others.length === 0)
    const domains = context.appId ? (await this.appRecord(context.appId)).domains : []

    const address = isDefault
      ? `address       http://${this.server.host}${domains.length > 0 ? `, and ${domains.map((entry) => entry.domain).join(', ')}` : ''}`
      : domains.length > 0
        ? `address       ${domains.map((entry) => entry.domain).join(', ')}`
        : `address       none until \`nextship domain add\`: ${facts.defaultApp ?? 'another app'} answers http://${this.server.host}`

    return [
      `target        your server ${this.server.host}, ${this.server.arch}, Docker ${facts.dockerVersion}`,
      ...context.delivery,
      context.appId
        ? `app           UPDATE "${context.name}" (${context.appId}), which nextship created`
        : `app           CREATE "${context.name}" in ${ETC}/apps/${context.name}`,
      `memory        up to ${memoryLimit(facts.memMib, appCount, context.memory)} of ${facts.memMib} MiB`,
      address,
      'switch        Caddy moves traffic only once the new container is healthy; until then the current one serves',
      'caddy         the site is regenerated from the domains recorded for this app',
    ]
  }

  // ----------------------------------------------------------------- build

  async actionsKey(_projectRoot: string, localKey: string | null, onPhase: PhaseReporter): Promise<string | null> {
    const file = `${this.appDir()}/secrets`
    const stored = await this.exec(`cat ${q(file)} 2> /dev/null`)
    let server: string | null = null
    if (stored.code === 0 && stored.stdout.trim() !== '') {
      const parsed = JSON.parse(stored.stdout) as { serverActionsEncryptionKey?: unknown }
      if (typeof parsed.serverActionsEncryptionKey !== 'string') {
        throw new NextshipError(
          `${file} on the server does not hold a Server Actions key.`,
          'Restore the file, or remove it to fall back to the local key. nextship will not replace it.'
        )
      }
      server = parsed.serverActionsEncryptionKey
    }

    const decision = decideKey({ environment: process.env[KEY_ENV], server, local: localKey })
    const store = async (key: string): Promise<void> => {
      await this.run(
        `mkdir -p ${q(this.appDir())} && install -m 600 /dev/stdin ${q(file)}`,
        'store the Server Actions key on the server',
        JSON.stringify({ serverActionsEncryptionKey: key })
      )
    }

    switch (decision.action) {
      case 'use':
        if (decision.warning) onPhase(`WARNING: ${decision.warning}`)
        onPhase(`Server Actions key from ${decision.source === 'server' ? 'the server' : KEY_ENV}`)
        return decision.key
      case 'upload':
        await store(decision.key)
        onPhase('Server Actions key copied from .nextship/secrets.local.json to the server, so every machine uses it')
        return decision.key
      case 'generate': {
        const key = randomBytes(32).toString('base64')
        await store(key)
        onPhase('Server Actions key generated and stored on the server, not on this machine')
        return key
      }
    }
  }

  async buildPlatform(): Promise<string> {
    return `linux/${this.server.arch}`
  }

  /**
   * A remote build reaches the server's Docker daemon through an SSH forward of
   * its socket, with the same pinned host key as every other connection.
   * `DOCKER_HOST=ssh://` would be simpler and would bypass that pinning, because
   * Docker starts its own ssh with the user's ordinary host key checking.
   */
  async builder(): Promise<ImageBuilder> {
    const cacheScope = `${this.name}@${this.server.host}:${this.server.port}`
    if (this.build === 'local') return { dockerHost: null, cacheScope: null, warning: null, close: async () => {} }

    const ssh = await this.ssh()
    // Windows' OpenSSH cannot forward to a local Unix socket, so it forwards a
    // loopback port, which any local process could use while the build runs.
    const windows = process.platform === 'win32'
    const port = windows ? await freePort() : 0
    const local = windows ? `127.0.0.1:${port}` : path.join(ssh.privateDir(), 'docker.sock')
    const args = [
      '-nNT',
      ...ssh.options({ multiplex: false }),
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'StreamLocalBindUnlink=yes',
      '-L', `${local}:/var/run/docker.sock`,
      ...ssh.destination(),
    ]
    const child = spawn('ssh', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    const exited = new Promise<number>((resolve) => child.on('close', (code) => resolve(code ?? 255)))

    const ready = async (): Promise<boolean> => (windows ? canConnect(port) : existsSync(local))
    const deadline = Date.now() + 20_000
    for (;;) {
      if (await ready()) break
      const done = await Promise.race([exited, sleep(250).then(() => null)])
      if (done !== null || Date.now() > deadline) {
        child.kill()
        throw new NextshipError(
          `Could not reach Docker on ${this.server.host} through SSH: ${stderr.trim() || 'the forward did not open'}`,
          'Check `nextship server add` reports the server as set up, or build here with `--build local`.'
        )
      }
    }

    return {
      dockerHost: windows ? `tcp://127.0.0.1:${port}` : `unix://${local}`,
      cacheScope,
      warning: windows
        ? `The server's Docker is reachable on 127.0.0.1:${port} by any process on this machine until the build finishes.`
        : null,
      close: async () => {
        child.kill()
        await exited
      },
    }
  }

  async planDelivery(name: string): Promise<string[]> {
    const facts = await this.facts()
    return [
      this.build === 'remote'
        ? `build         on the server's Docker ${facts.dockerVersion}, for linux/${this.server.arch}, over SSH`
        : `build         on this machine for linux/${this.server.arch}, then streamed to the server over SSH`,
      `image         kept on the server as ${name}:<deployment id>`,
    ]
  }

  async deliverImage(options: {
    localTag: string
    name: string
    tag: string
    cwd: string
    onPhase: PhaseReporter
  }): Promise<{ reference: string | null; store: string | null }> {
    const reference = `${assertAppName(options.name)}:${assertDeploymentId(options.tag)}`
    if (this.build === 'local') {
      const ssh = await this.ssh()
      options.onPhase(`streaming ${options.localTag} to ${this.server.host}`)
      await pipeline(['docker', ['save', options.localTag]], ['ssh', [...ssh.options(), ...ssh.destination(), 'docker load -q']], {
        cwd: options.cwd,
      })
    }
    // The build tags the image with the project's own name, which nextship.json
    // may have renamed. Releases always run `<app name>:<deployment id>`.
    if (options.localTag !== reference) {
      await this.run(`docker tag ${q(options.localTag)} ${q(reference)}`, 'tag the image on the server')
    }
    return { reference, store: null }
  }

  // --------------------------------------------------------------- release

  async release(appId: string | null, request: ReleaseRequest): Promise<{ appId: string; deploymentId: string | null }> {
    const started = await this.startRelease(appId, {
      imageTag: request.tag,
      cause: 'deploy',
      memory: request.memory,
      healthPath: request.healthPath ?? null,
    })
    return { appId: started.appId, deploymentId: started.releaseId }
  }

  async awaitRelease(appId: string, deploymentId: string, onPhase: PhaseReporter, replacing: boolean): Promise<void> {
    try {
      await this.finishRelease(appId, deploymentId, onPhase, replacing)
    } finally {
      await this.unlock()
    }
  }

  async assertIdle(_appId: string): Promise<void> {
    const owner = await this.exec(`cat ${q(`${this.appDir()}/lock/owner`)} 2> /dev/null || test -d ${q(`${this.appDir()}/lock`)}`)
    if (owner.code !== 0) return
    throw heldLockError(this.name, `${this.appDir()}/lock`, parseOwner(owner.stdout), new Date())
  }

  private async lock(): Promise<void> {
    const dir = `${this.appDir()}/lock`
    const owner = JSON.stringify({ host: hostname(), pid: process.pid, since: new Date().toISOString() })
    await this.run(`mkdir -p ${q(this.appDir())}`, 'create the app directory')
    const result = await this.exec(`mkdir ${q(dir)} 2> /dev/null && cat > ${q(`${dir}/owner`)}`, owner)
    if (result.code === 0) return
    const held = await this.exec(`cat ${q(`${dir}/owner`)} 2> /dev/null`)
    throw heldLockError(this.name, dir, parseOwner(held.stdout), new Date())
  }

  private async unlock(): Promise<void> {
    await this.run(`rm -rf ${q(`${this.appDir()}/lock`)}`, 'release the app lock')
  }

  private async readDeployments(): Promise<VmDeployment[]> {
    const result = await this.exec(`cat ${q(`${this.appDir()}/deployments.json`)} 2> /dev/null`)
    return result.code === 0 ? parseDeployments(result.stdout) : []
  }

  private async writeDeployments(deployments: VmDeployment[]): Promise<void> {
    await this.run(
      `install -m 600 /dev/stdin ${q(`${this.appDir()}/deployments.json`)}`,
      'write the deployment history',
      serializeDeployments(deployments)
    )
  }

  /**
   * Steps 1 to 3: lock, ownership, and a new container that serves nothing yet.
   * The lock stays held on success; `finishRelease` releases it. On failure it is
   * released here, since nothing will follow.
   */
  private async startRelease(
    appId: string | null,
    options: { imageTag: string; cause: string; memory: string | null; healthPath: string | null; before?: () => Promise<void> }
  ): Promise<{ appId: string; releaseId: string }> {
    await this.lock()
    try {
      let record: AppRecord
      if (appId) {
        record = await this.appRecord(appId)
      } else {
        const existing = await this.exec(`test -e ${q(`${this.appDir()}/app.json`)}`)
        if (existing.code === 0) {
          throw new NextshipError(
            `An app named "${this.name}" already exists on ${this.server.host}, and this project did not create it.`,
            'nextship will not modify an app it does not own. Rename this project, or set a different name in nextship.json.'
          )
        }
        record = { id: randomUUID(), name: this.name, createdAt: new Date().toISOString(), domains: [] }
        await this.writeAppRecord(record)
      }
      await this.run(`touch ${q(`${this.appDir()}/env`)} && chmod 600 ${q(`${this.appDir()}/env`)}`, 'prepare the env file')
      if (options.before) await options.before()

      const facts = await this.facts()
      const apps = await this.listApps()
      const releaseId = newReleaseId(new Date())
      const reference = `${this.name}:${assertDeploymentId(options.imageTag)}`
      const workdir = (await this.run(`docker image inspect -f '{{.Config.WorkingDir}}' ${q(reference)}`, 'read the image')).trim()
      const volumes = cacheVolumes(this.name, options.imageTag)
      const labels = ['--label', 'sh.nextship.managed=true', '--label', `sh.nextship.app=${this.name}`]
      await this.run(
        [
          ['docker', 'volume', 'create', ...labels, volumes.cache].map(q).join(' '),
          ['docker', 'volume', 'create', ...labels, '--label', `sh.nextship.image=${options.imageTag}`, volumes.build].map(q).join(' '),
        ].join(' > /dev/null && ') + ' > /dev/null',
        'create the cache volumes'
      )
      const args = runArguments({
        workdir,
        name: this.name,
        releaseId,
        imageTag: assertDeploymentId(options.imageTag),
        memory: memoryLimit(facts.memMib, apps.length, options.memory),
        healthPath: options.healthPath,
        dockerMajor: Number.parseInt(facts.dockerVersion, 10),
      })

      const history = recordStarted(await this.readDeployments(), {
        id: releaseId,
        imageTag: options.imageTag,
        cause: options.cause,
        createdAt: new Date().toISOString(),
        healthPath: options.healthPath,
      })
      await this.writeDeployments(history)
      await this.run(args.map(q).join(' '), 'start the new container')
      return { appId: record.id, releaseId }
    } catch (error) {
      await this.unlock()
      throw error
    }
  }

  /** Steps 4 to 6. Expects the lock to be held, and leaves releasing it to the caller. */
  private async finishRelease(appId: string, releaseId: string, onPhase: PhaseReporter, replacing: boolean): Promise<void> {
    const container = `${this.name}-${releaseId}`
    const keeps = replacing ? 'The previous deployment keeps serving.' : 'This was the first deployment, so nothing is serving yet.'

    const healthy = await this.awaitHealthy(container, onPhase)
    if (!healthy.ok) {
      await this.discard(container, releaseId, healthy.reason, onPhase)
      throw new NextshipError(`The new container ${healthy.reason}.`, `${keeps} Its last log lines are above.`)
    }

    const record = await this.appRecord(appId)
    try {
      await this.switchSite(record, container)
    } catch (error) {
      await this.discard(container, releaseId, 'was refused by Caddy', onPhase)
      throw new NextshipError(
        `Caddy refused the site for the new container: ${error instanceof Error ? error.message : String(error)}`,
        `${keeps} The previous site file was restored.`
      )
    }
    onPhase('Caddy now sends traffic to the new container')

    const running = await this.run(
      `docker ps --filter label=sh.nextship.managed=true --filter ${q(`label=sh.nextship.app=${this.name}`)} --filter status=running --format '{{.Names}}'`,
      'list the running containers'
    )
    const previous = previousContainers(running, this.name, container)
    if (previous.length > 0) {
      // 30 s matches the time a request is allowed to finish: Next.js exits on
      // SIGTERM once in-flight responses and after() callbacks complete.
      await this.run(`docker stop -t 30 ${previous.map(q).join(' ')}`, 'stop the previous container')
      onPhase(`stopped ${previous.join(', ')}, kept until its image is pruned`)
    }
    const after = (await this.run(`docker inspect -f '{{.State.Running}}' ${q(container)}`, 'confirm the new container runs')).trim()
    if (after !== 'true') {
      throw new NextshipError(
        `${container} is not running after the previous container was stopped.`,
        'This is a nextship defect. Start it with `docker start` on the server, and please report it with the output above.'
      )
    }

    const history = recordLive(await this.readDeployments(), releaseId)
    await this.writeDeployments(history)
    await this.pruneBeyond(history, onPhase)
  }

  private async awaitHealthy(container: string, onPhase: PhaseReporter): Promise<{ ok: true } | { ok: false; reason: string }> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    let last = ''
    for (;;) {
      const state = (await this.run(
        `docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' ${q(container)}`,
        'read the new container\'s health'
      )).trim()
      if (state !== last) {
        onPhase(state.replace(' ', ', '))
        last = state
      }
      const [status, health] = state.split(' ')
      if (health === 'healthy') return { ok: true }
      // With --restart unless-stopped a container that exits on start is never
      // seen as exited: Docker restarts it in a loop and reports `restarting`.
      if (status === 'exited' || status === 'dead' || status === 'restarting') {
        return { ok: false, reason: 'exited before it became healthy' }
      }
      if (health === 'unhealthy') return { ok: false, reason: 'failed its health check' }
      if (Date.now() > deadline) return { ok: false, reason: `did not become healthy within ${HEALTH_TIMEOUT_MS / 60000} minutes` }
      await sleep(HEALTH_POLL_MS)
    }
  }

  /** Removes a container that never served, printing why, and records it as failed. */
  private async discard(container: string, releaseId: string, reason: string, onPhase: PhaseReporter): Promise<void> {
    const logs = await this.exec(`docker logs --tail 50 ${q(container)} 2>&1`)
    for (const line of logs.stdout.trimEnd().split('\n').filter(Boolean)) onPhase(`  ${line}`)
    await this.exec(`docker rm -f ${q(container)}`)
    await this.writeDeployments(recordFailed(await this.readDeployments(), releaseId, reason))
  }

  /**
   * Points the app's Caddy site at a container. The new file is validated against
   * every other site before it replaces anything, and if the reload still fails,
   * the previous file is put back and Caddy reloaded again, so a bad site never
   * takes the proxy down for every app on the server.
   */
  private async switchSite(record: AppRecord, container: string): Promise<void> {
    const facts = await this.facts()
    let defaultApp = facts.defaultApp
    if (defaultApp === null) {
      await this.run(`printf '%s\\n' ${q(this.name)} > ${DEFAULT_APP_FILE}`, 'record the default app')
      defaultApp = this.name
    }
    const site = renderSite({ name: this.name, container, domains: record.domains, isDefault: defaultApp === this.name })
    await this.applySite(site)
  }

  private async applySite(site: string | null): Promise<void> {
    const sites = `${CADDY_DIR}/sites`
    const current = `${sites}/${this.name}.caddy`
    const script = [
      'set -eu',
      `d=${CADDY_DIR}; cur=${q(current)}; next="$cur.next"; prev="$cur.prev"`,
      site === null ? 'rm -f "$next"' : 'install -m 644 /dev/stdin "$next"',
      'rm -rf "$d/check" && mkdir "$d/check"',
      'for f in "$d"/sites/*.caddy; do [ -e "$f" ] || continue; [ "$f" = "$cur" ] || cp "$f" "$d/check/"; done',
      `[ -e "$next" ] && cp "$next" "$d/check/${this.name}.caddy"`,
      "printf 'import check/*.caddy\\n' > \"$d/Caddyfile.check\"",
      'if ! out=$(docker exec nextship-caddy caddy validate --config /etc/caddy/Caddyfile.check --adapter caddyfile 2>&1); then',
      '  rm -rf "$next" "$d/check" "$d/Caddyfile.check"; printf "%s\\n" "$out" | grep -v "^{" | tail -3 >&2; exit 10',
      'fi',
      'rm -f "$prev"; [ -e "$cur" ] && cp "$cur" "$prev"',
      'if [ -e "$next" ]; then mv "$next" "$cur"; else rm -f "$cur"; fi',
      'if ! out=$(docker exec nextship-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1); then',
      '  if [ -e "$prev" ]; then mv "$prev" "$cur"; else rm -f "$cur"; fi',
      '  docker exec nextship-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null 2>&1 || true',
      '  rm -rf "$d/check" "$d/Caddyfile.check"; printf "%s\\n" "$out" | grep -v "^{" | tail -3 >&2; exit 11',
      'fi',
      'rm -rf "$prev" "$d/check" "$d/Caddyfile.check"',
    ].join('\n')
    await this.run(script, 'update the Caddy site', site ?? '')
  }

  /**
   * Removes images, and the stopped containers made from them, beyond the newest
   * served deployments. On a server this is safe to do on every deployment:
   * removing an image frees its space at once, and nothing else reads it.
   */
  private async pruneBeyond(history: VmDeployment[], onPhase: PhaseReporter): Promise<void> {
    const keep = imagesToKeep(history, DEFAULT_KEEP)
    const images = await this.images(this.name)
    const remove = images.filter((image) => !image.tags.some((tag) => keep.has(tag)))
    if (remove.length === 0) return
    await this.removeImages(this.name, remove.map((image) => image.id))
    onPhase(`removed ${remove.length} image(s) older than the newest ${DEFAULT_KEEP} deployments`)
  }

  async address(appId: string): Promise<AppAddress | null> {
    const exists = await this.exec(`test -f ${q(`${this.appDir()}/app.json`)}`)
    if (exists.code !== 0) return null
    const record = await this.appRecord(appId)
    const facts = await this.facts()
    const isDefault = facts.defaultApp === this.name
    const domains: DomainRecord[] = await Promise.all(
      record.domains.map(async (entry) => {
        const certificate = await certificateState(this.server.host, entry.domain)
        return {
          domain: entry.domain,
          primary: entry.primary,
          state: certificate.live ? ('live' as const) : ('pending' as const),
          detail: certificate.live ? 'live, certificate issued' : `not serving HTTPS yet: ${certificate.detail}`,
        }
      })
    )
    return {
      platformHost: isDefault ? this.server.host : null,
      platformUrl: isDefault ? `http://${this.server.host}` : null,
      domains,
    }
  }

  async preservedSettings(): Promise<string[]> {
    return []
  }

  // -------------------------------------------------------------- rollback

  async deployments(_appId: string): Promise<DeploymentRecord[]> {
    return (await this.readDeployments()).map(({ healthPath: _healthPath, ...entry }) => entry)
  }

  async rollback(appId: string, deploymentId: string, onPhase: PhaseReporter): Promise<void> {
    const target = (await this.readDeployments()).find((entry) => entry.id === deploymentId)
    if (!target?.served || !target.imageTag) {
      throw new NextshipError(`Deployment ${deploymentId} never served, so there is nothing to return to.`, 'Run `nextship rollback` to see the deployments you can roll back to.')
    }
    const image = await this.exec(`docker image inspect ${q(`${this.name}:${target.imageTag}`)} > /dev/null 2>&1`)
    if (image.code !== 0) {
      throw new NextshipError(
        `The image for ${deploymentId}, ${this.name}:${target.imageTag}, is no longer on the server.`,
        'It was pruned. Check out that commit and run `nextship deploy` to build it again. Nothing was changed.'
      )
    }
    const live = (await this.readDeployments()).some((entry) => entry.live)
    const started = await this.startRelease(appId, {
      imageTag: target.imageTag,
      cause: `rollback to ${deploymentId}`,
      memory: null,
      healthPath: target.healthPath ?? null,
    })
    try {
      await this.finishRelease(appId, started.releaseId, onPhase, live)
    } finally {
      await this.unlock()
    }
  }

  /** Starts the live image again, for a change that needs a new container but no new build. */
  private async redeploy(appId: string, cause: string, before: () => Promise<void>): Promise<boolean> {
    const history = await this.readDeployments()
    const live = history.find((entry) => entry.live)
    if (!live?.imageTag) {
      await this.lock()
      try {
        await before()
      } finally {
        await this.unlock()
      }
      return false
    }
    const started = await this.startRelease(appId, { imageTag: live.imageTag, cause, memory: null, healthPath: live.healthPath ?? null, before })
    try {
      await this.finishRelease(appId, started.releaseId, () => {}, true)
    } finally {
      await this.unlock()
    }
    return true
  }

  // ------------------------------------------------------------------- env

  private async readEnv(): Promise<Map<string, string>> {
    const result = await this.exec(`cat ${q(`${this.appDir()}/env`)} 2> /dev/null`)
    return result.code === 0 ? parseEnvFile(result.stdout) : new Map()
  }

  private async writeEnv(values: Map<string, string>): Promise<void> {
    await this.run(`install -m 600 /dev/stdin ${q(`${this.appDir()}/env`)}`, 'write the env file', renderEnvFile(values))
  }

  async env(appId: string): Promise<EnvRecord[]> {
    await this.appRecord(appId)
    return [...(await this.readEnv()).keys()].map((key) => ({
      key,
      secret: !key.startsWith('NEXT_PUBLIC_'),
      location: 'the server env file',
    }))
  }

  async previewEnv(appId: string, values: Map<string, string>) {
    await this.appRecord(appId)
    renderEnvFile(values)
    const existing = await this.readEnv()
    return [...values.keys()].sort().map((key) => ({
      key,
      action: existing.has(key) ? ('update' as const) : ('add' as const),
      secret: !key.startsWith('NEXT_PUBLIC_'),
    }))
  }

  async setEnv(appId: string, values: Map<string, string>): Promise<void> {
    await this.appRecord(appId)
    renderEnvFile(values)
    await this.redeploy(appId, 'env change', async () => {
      const merged = await this.readEnv()
      for (const [key, value] of values) merged.set(key, value)
      await this.writeEnv(merged)
    })
  }

  async unsetEnv(appId: string, keys: string[]): Promise<void> {
    await this.appRecord(appId)
    await this.redeploy(appId, 'env change', async () => {
      const remaining = await this.readEnv()
      for (const key of keys) remaining.delete(key)
      await this.writeEnv(remaining)
    })
  }

  // --------------------------------------------------------------- domains

  async attachDomain(appId: string, domain: string, options: { primary: boolean; minimumTls: string }): Promise<DnsInstruction> {
    assertDomain(domain)
    await this.changeDomains(appId, (domains) => withDomain(domains, { domain, primary: options.primary, minimumTls: options.minimumTls }))
    const facts = await this.facts()
    const address = await serverAddress(this.server.host)
    return {
      type: 'A',
      name: domain,
      value: address,
      notes: [
        `Some control panels ask only for the part before your registered domain.`,
        ...(facts.ipv6 ? ['The server also has an IPv6 address: add an AAAA record for it too, or none at all, never a stale one.'] : []),
        'Caddy requests a certificate from Let\'s Encrypt once the record resolves to this server and port 80 is reachable.',
      ],
    }
  }

  async detachDomain(appId: string, domain: string): Promise<void> {
    await this.changeDomains(appId, (domains) => withoutDomain(domains, domain))
  }

  private async changeDomains(appId: string, change: (domains: SiteDomain[]) => SiteDomain[]): Promise<void> {
    await this.lock()
    try {
      const record = await this.appRecord(appId)
      const updated = { ...record, domains: change(record.domains) }
      const live = (await this.readDeployments()).find((entry) => entry.live)
      if (live) {
        const facts = await this.facts()
        const site = renderSite({
          name: this.name,
          container: `${this.name}-${live.id}`,
          domains: updated.domains,
          isDefault: facts.defaultApp === this.name,
        })
        // The site is validated and live before the record says so, so a domain
        // Caddy refused is never recorded as attached.
        await this.applySite(site)
      }
      await this.writeAppRecord(updated)
    } finally {
      await this.unlock()
    }
  }

  // ---------------------------------------------------------------- images

  async images(repository: string): Promise<ImageRecord[]> {
    const output = await this.run(
      `docker image ls --no-trunc --filter ${q(`reference=${assertAppName(repository)}`)} --format '{{.ID}}\t{{.Tag}}\t{{.CreatedAt}}\t{{.Size}}'`,
      'list the images on the server'
    )
    const byId = new Map<string, ImageRecord>()
    for (const line of output.split('\n').filter(Boolean)) {
      const [id, tag, createdAt, size] = line.split('\t')
      const existing = byId.get(id)
      if (existing) {
        if (tag !== '<none>') existing.tags.push(tag)
        continue
      }
      byId.set(id, {
        id,
        tags: tag === '<none>' ? [] : [tag],
        children: [],
        sizeBytes: parseDockerSize(size ?? ''),
        updatedAt: new Date(createdAt.replace(/ [A-Z]+$/, '')).toISOString(),
      })
    }
    return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** Removes the stopped containers made from each image, then the image. A running container is never touched. */
  async removeImages(repository: string, ids: string[]): Promise<void> {
    const images = await this.images(repository)
    for (const id of ids) {
      const image = images.find((entry) => entry.id === id)
      if (!image) continue
      for (const tag of image.tags) {
        await this.run(
          `docker ps -aq --filter label=sh.nextship.managed=true --filter ${q(`label=sh.nextship.app=${this.name}`)} --filter ${q(`label=sh.nextship.image=${tag}`)} --filter status=exited --filter status=created | xargs -r docker rm`,
          'remove the containers of an old image'
        )
      }
      const refs = image.tags.length > 0 ? image.tags.map((tag) => `${this.name}:${tag}`) : [id]
      await this.run(`docker rmi ${refs.map(q).join(' ')}`, `remove image ${refs.join(', ')}`)
      // The build's regenerated pages are only valid for the image that is gone.
      for (const tag of image.tags) {
        await this.run(`docker volume rm ${q(cacheVolumes(this.name, tag).build)} > /dev/null 2>&1 || true`, 'remove the image\'s cache volume')
      }
    }
  }

  /**
   * Images free their space when removed, so there is nothing to collect. The
   * build cache is what grows without bound on a server that builds, so reclaiming
   * trims that instead.
   */
  async reclaim(): Promise<ReclaimOutcome> {
    // Docker 28 renamed --keep-storage to --reserved-space; setup accepts older Dockers too.
    await this.run(
      'docker builder prune -f --reserved-space 5GB > /dev/null 2>&1 || docker builder prune -f --keep-storage 5GB > /dev/null',
      'trim the build cache'
    )
    return { kind: 'not-needed', detail: 'The build cache on the server was trimmed to 5 GB.' }
  }

  async storageBytes(): Promise<number | null> {
    const output = await this.run("docker system df --format '{{.Type}}\t{{.Size}}'", 'read Docker disk usage')
    return output
      .split('\n')
      .filter(Boolean)
      .reduce((total, line) => total + parseDockerSize(line.split('\t')[1] ?? ''), 0)
  }

  // ------------------------------------------------------------------ logs

  private async liveContainer(): Promise<string> {
    const live = (await this.readDeployments()).find((entry) => entry.live)
    if (!live) {
      throw new NextshipError('This app has no live deployment, so there is no container to read.', 'Run `nextship deploy` first.')
    }
    return `${this.name}-${live.id}`
  }

  async readLogs(appId: string): Promise<string> {
    await this.appRecord(appId)
    return this.run(`docker logs --tail 500 ${q(await this.liveContainer())} 2>&1`, 'read the logs')
  }

  async followLogs(appId: string, write: (text: string) => void, signal: AbortSignal): Promise<string | null> {
    await this.appRecord(appId)
    const container = await this.liveContainer()
    const code = await (await this.ssh()).stream(`docker logs -f --tail 50 ${q(container)} 2>&1`, write, signal)
    if (signal.aborted) return null
    return code === 0
      ? `${container} stopped, which ends its log. A new deployment replaced it or it was restarted; run the command again to follow the live one.`
      : `The log stream ended with exit code ${code}. Run the command again to reconnect.`
  }

  // --------------------------------------------------------------- destroy

  async destroyApp(appId: string): Promise<void> {
    await this.lock()
    try {
      await this.appRecord(appId)
      await this.run(
        `docker ps -aq --filter label=sh.nextship.managed=true --filter ${q(`label=sh.nextship.app=${this.name}`)} | xargs -r docker rm -f > /dev/null`,
        'remove the app\'s containers'
      )
      await this.applySite(null)
      const facts = await this.facts()
      if (facts.defaultApp === this.name) await this.run(`rm -f ${DEFAULT_APP_FILE}`, 'release the default address')
      await this.run(
        `docker volume ls -q --filter label=sh.nextship.managed=true --filter ${q(`label=sh.nextship.app=${this.name}`)} | xargs -r docker volume rm > /dev/null`,
        'remove the app\'s volumes'
      )
    } catch (error) {
      await this.unlock()
      throw error
    }
    // The lock lives inside the directory being removed, so removing it is the release.
    await this.run(`rm -rf ${q(this.appDir())}`, 'remove the app\'s state')
  }
}

// ---------------------------------------------------------------- helpers

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/** The IPv4 address a DNS record should point at, resolving a hostname the server was added by. */
async function serverAddress(host: string): Promise<string> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host
  try {
    return (await lookup(host, { family: 4 })).address
  } catch {
    return host
  }
}

/**
 * Whether the server presents a certificate valid for the domain, checked the
 * way a browser would: TLS to the server with the domain as the server name,
 * verified against the system's trust store.
 */
async function certificateState(host: string, domain: string): Promise<{ live: boolean; detail: string }> {
  return new Promise((resolve) => {
    const socket = tlsConnect({ host, port: 443, servername: domain, rejectUnauthorized: true, timeout: 5000 })
    socket.once('secureConnect', () => {
      socket.destroy()
      resolve({ live: true, detail: 'certificate issued' })
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve({ live: false, detail: 'port 443 did not answer' })
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      resolve({ live: false, detail: error.code === 'ECONNREFUSED' ? 'port 443 refused the connection' : 'no valid certificate yet, which Caddy requests once DNS points here' })
    })
  })
}
