/**
 * @nextship/cli: server
 *
 * `nextship server add user@host` turns a fresh Ubuntu or Debian server into one
 * the VM target can deploy to, and records it in `nextship.json`.
 *
 * The work itself is `runtime/vm/setup.sh`, sent over SSH and run as root. This
 * module is the part that decides: it pins the host key on first use and shows
 * its fingerprint before trusting it, prints what setup will change before
 * changing anything, applies it in an order that cannot lock the user out, and
 * confirms afterwards that every step reports done.
 *
 * The order is the safety property. The `nextship` user is created and a login
 * as that user is proven from this machine before anything else depends on it,
 * and SSH hardening runs last, only after that login worked. A server where
 * hardening went first and the new user's key was wrong would be a server
 * nobody can reach.
 *
 * Author: Ragul D
 * Design: ../../../docs/design.md §9.3
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import { readConfig, writeConfig, type ProjectConfig, type ServerRecord } from './config.js'
import { MIN_DOCKER_MAJOR } from './docker.js'
import { fingerprint, parseKeyLine, scanHostKey, type HostKey } from './targets/vm/host-key.js'
import { Ssh, assertHost, assertUser, shellQuote } from './targets/vm/ssh.js'
import { client } from './owned-app.js'
import { CONTAINER_PORT } from './image/dockerfile.js'
import { MOVE_STEPS, rebootProgress, statusWarnings, type VmTarget } from './targets/vm/vm-target.js'
import { detail, ok, step, warn } from './util/log.js'

/** The user every later command connects as. Created by the `user` step. */
const SERVICE_USER = 'nextship'

/** Setup steps in the order setup.sh runs them. */
export const SETUP_STEPS = [
  'os',
  'arch',
  'resources',
  'ports',
  'docker',
  'user',
  'dirs',
  'network',
  'caddy',
  'journald',
  'swap',
  'updates',
  'firewall',
  'watchdog',
  'ssh-hardening',
] as const

type SetupStep = (typeof SETUP_STEPS)[number]

/** The steps a user may opt out of, by the flag that does it. */
export const OPT_OUT_FLAGS: Record<string, SetupStep> = {
  'no-firewall': 'firewall',
  'no-auto-updates': 'updates',
  'no-swap': 'swap',
  'no-ssh-hardening': 'ssh-hardening',
}

type StepStatus = 'ok' | 'change' | 'done' | 'skip' | 'refuse'

interface StepLine {
  step: string
  status: StepStatus
  detail: string
}

interface AddServerOptions {
  confirmed: boolean
  /** `user@host` or `user@host:port`. */
  address: string
  /** Flags from `OPT_OUT_FLAGS` that were given. */
  optOut: string[]
}

// ------------------------------------------------------------------- pure

/**
 * Reads `user@host[:port]`. An IPv6 address takes brackets, `user@[2001:db8::1]:22`,
 * because its own colons would otherwise be read as a port.
 */
export function parseServerAddress(address: string): { user: string; host: string; port: number } {
  const match = /^([^@\s]+)@(\[[0-9A-Fa-f:]+\]|[^:\s[\]]+)(?::(\d+))?$/.exec(address)
  if (!match) {
    throw new NextshipError(
      `"${address}" is not a server address.`,
      'Use user@host or user@host:port, for example `nextship server add root@203.0.113.10`.'
    )
  }
  const port = match[3] === undefined ? 22 : Number(match[3])
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new NextshipError(`Port ${match[3]} is out of range.`, 'Use a port between 1 and 65535.')
  }
  return { user: assertUser(match[1]), host: assertHost(match[2].replace(/^\[|\]$/g, '')), port }
}

/** The steps the given opt-out flags remove. */
export function skippedSteps(optOut: string[]): SetupStep[] {
  return optOut.map((flag) => {
    const step = OPT_OUT_FLAGS[flag]
    if (!step) throw new NextshipError(`Unknown option \`--${flag}\`.`, 'Run `nextship --help`.')
    return step
  })
}

/**
 * The `STEP` lines in setup.sh output. Everything else is ignored rather than
 * parsed: during apply the same stream carries apt and docker output.
 */
export function parseStepLines(output: string): StepLine[] {
  const lines: StepLine[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^STEP (\S+) (ok|change|done|skip|refuse) ?(.*)$/.exec(line)
    if (match) lines.push({ step: match[1], status: match[2] as StepStatus, detail: match[3] })
  }
  return lines
}

/**
 * Splits the steps into three applies: everything up to the new user, what
 * needs that user to exist, and SSH hardening, which waits for a proven login.
 */
export function applyPhases(skip: SetupStep[]): SetupStep[][] {
  const chosen = SETUP_STEPS.filter((name) => !skip.includes(name))
  const userIndex = chosen.indexOf('user') + 1
  return [
    chosen.slice(0, userIndex),
    chosen.slice(userIndex).filter((name) => name !== 'ssh-hardening'),
    chosen.filter((name) => name === 'ssh-hardening'),
  ].filter((phase) => phase.length > 0)
}

/** The architecture setup reported, or a refusal when it reported none. */
export function reportedArch(lines: StepLine[]): ServerRecord['arch'] {
  const arch = lines.find((line) => line.step === 'arch')
  if (arch?.status === 'ok' && (arch.detail === 'amd64' || arch.detail === 'arm64')) return arch.detail
  throw new NextshipError(
    'Setup did not report a supported architecture for this server.',
    'nextship runs on amd64 and arm64 servers. Check the plan output above.'
  )
}

/**
 * Refuses a server that would silently take a project away from where its app
 * runs, or whose key no longer matches the one pinned for it.
 */
export function assertCanRecord(existing: ProjectConfig | null, host: string, port: number, scanned: HostKey): void {
  if (!existing) return
  if (existing.target === 'digitalocean') {
    throw new NextshipError(
      'This project deploys to DigitalOcean, according to nextship.json.',
      'nextship does not move a project between targets in place. Destroy the DigitalOcean app first, then delete nextship.json and run `nextship server add` again.'
    )
  }
  const recorded = existing.server
  if (!recorded) return
  const sameServer = recorded.host === host && recorded.port === port
  if (!sameServer && existing.appId) {
    throw new NextshipError(
      `This project's app runs on ${recorded.host}:${recorded.port}, and recording ${host}:${port} instead would leave it there unmanaged.`,
      'Keep the recorded server, or destroy the app there before adding another one.'
    )
  }
  const pinned = parseKeyLine(recorded.hostKey)
  if (sameServer && pinned && (pinned.type !== scanned.type || pinned.key !== scanned.key)) {
    throw new NextshipError(
      `The host key of ${host} is not the one recorded in nextship.json (recorded ${fingerprint(pinned)}, offered ${fingerprint(scanned)}).`,
      "Confirm the new fingerprint through your provider's console. Only if it matches, remove \"server\" from nextship.json and run this again."
    )
  }
}

// ---------------------------------------------------------------- runtime

function runtimeFile(name: string): string {
  const require = createRequire(import.meta.url)
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const candidate of [path.join(here, '..', 'runtime', 'vm', name), path.join(here, '..', '..', 'runtime', 'vm', name)]) {
    try {
      return require.resolve(candidate)
    } catch {
      continue
    }
  }
  throw new NextshipError(
    `runtime/vm/${name} is missing from this nextship installation.`,
    'Reinstall nextship. If you are running from a checkout, run `pnpm build` first.'
  )
}

/** The setup script with the watchdog it installs, ready to send on stdin. */
async function setupInput(): Promise<string> {
  const [script, watchdog] = await Promise.all([
    readFile(runtimeFile('setup.sh'), 'utf8'),
    readFile(runtimeFile('watchdog.sh'), 'utf8'),
  ])
  // An assignment ahead of the script rather than an argument, so the command
  // line stays short. Base64 has no characters a shell treats specially.
  return `export NEXTSHIP_WATCHDOG_B64=${Buffer.from(watchdog).toString('base64')}\n${script}`
}

/** The version setup.sh records on the server, read from the script this CLI ships. */
export async function setupVersion(): Promise<number> {
  const match = /^SETUP_VERSION=(\d+)$/m.exec(await readFile(runtimeFile('setup.sh'), 'utf8'))
  if (!match) throw new NextshipError('runtime/vm/setup.sh has no SETUP_VERSION.', 'This is a nextship defect. Please report it.')
  return Number(match[1])
}

/** The remote command that runs setup.sh as root. */
export function setupCommand(user: string, port: number, args: string[]): string {
  const environment = [`NEXTSHIP_ADMIN=${user}`, `NEXTSHIP_SSH_PORT=${port}`, `NEXTSHIP_MIN_DOCKER=${MIN_DOCKER_MAJOR}`]
  const run = ['env', ...environment, 'bash', '-s', '--', ...args].map(shellQuote).join(' ')
  // As root there may be no sudo at all, and nothing to gain from it.
  return user === 'root' ? run : `sudo -n ${run}`
}

// --------------------------------------------------------------- status

/** `nextship server status`: the server, and every app on it, with what needs attention. */
export async function serverStatus(project: ProjectInfo): Promise<void> {
  const config = await readConfig(project.root)
  if (config?.target !== 'vm') {
    throw new NextshipError(
      'This project does not deploy to a server.',
      'Run `nextship server add user@host` first. `server status` reads the server recorded in nextship.json.'
    )
  }
  const target = client(config) as VmTarget
  const status = await target.status()
  const gib = (mib: number): string => `${(mib / 1024).toFixed(1)} GB`

  step(`Server ${config.server?.host}`)
  detail(`os         ${status.os}, ${status.arch}, ${status.uptime}`)
  detail(`reboot     ${status.rebootRequired ? 'REQUIRED to finish installing updates' : 'not required'}`)
  detail(`load       ${status.load}`)
  detail(`memory     ${status.memAvailableMib} MiB available of ${status.memTotalMib} MiB`)
  detail(`disk       ${gib(status.diskFreeMib)} free of ${gib(status.diskTotalMib)}`)
  detail(`docker     ${status.docker}`)
  detail(`caddy      ${status.caddy || 'not running'}`)
  detail(`setup      version ${status.setupVersion ?? 'unknown'}`)

  step(`Apps on ${config.server?.host}`)
  if (status.apps.length === 0) detail('none yet')
  for (const app of status.apps) {
    detail(`${app.name}${app.name === config.name ? '  (this project)' : ''}`)
    detail(`  live       ${app.live ?? 'none'}`)
    detail(`  container  ${app.state}, ${app.restarts} restart(s), memory ${app.memory}`)
    detail(`  domains    ${app.domains.length > 0 ? app.domains.join(', ') : 'none'}`)
  }

  const warnings = statusWarnings(status, await setupVersion())
  for (const warning of warnings) warn(warning)
  if (warnings.length === 0) ok('Nothing needs attention.')
}

// --------------------------------------------------------------- reboot

/** How long a reboot may take, from asking to every container healthy again. */
const REBOOT_TIMEOUT_MS = 10 * 60 * 1000

async function vmProject(project: ProjectInfo): Promise<ProjectConfig & { server: ServerRecord }> {
  const config = await readConfig(project.root)
  if (config?.target !== 'vm' || !config.server) {
    throw new NextshipError(
      'This project does not deploy to a server.',
      'Run `nextship server add user@host` first. This command acts on the server recorded in nextship.json.'
    )
  }
  return config as ProjectConfig & { server: ServerRecord }
}

/**
 * `nextship server reboot`: reboots the server and waits until every container
 * that was running is back and healthy, which is the proof that a reboot, such as
 * the one security updates eventually need, brings every app back on its own.
 */
export async function rebootServer(project: ProjectInfo, options: { confirmed: boolean }): Promise<void> {
  const config = await vmProject(project)
  const target = client(config) as VmTarget
  const running = await target.runningContainers()

  step('Plan')
  detail(`server     REBOOT ${config.server.host}`)
  detail(`apps       ${running.length} container(s) stop, and come back on their own: ${running.join(', ') || 'none'}`)
  detail('downtime   every app on this server is down until the server is back, usually a minute or two')
  detail(`waits      up to ${REBOOT_TIMEOUT_MS / 60000} minutes for SSH, then for each of those containers to be healthy`)
  warn('This reboots the whole server, including anything nextship did not deploy.')

  if (!options.confirmed) {
    ok('This was a plan only. Nothing changed.')
    detail('Run `nextship server reboot --yes` to execute it.')
    return
  }

  const before = await target.bootMarker()
  step(`Rebooting ${config.server.host}`)
  await target.reboot()

  const deadline = Date.now() + REBOOT_TIMEOUT_MS
  let back = false
  while (!back) {
    if (Date.now() > deadline) {
      throw new NextshipError(
        `${config.server.host} did not come back within ${REBOOT_TIMEOUT_MS / 60000} minutes.`,
        "Check the server in your provider's console. nextship has not changed anything since asking it to reboot."
      )
    }
    await sleep(5000)
    try {
      back = (await target.bootMarker()) !== before
    } catch {
      // Unreachable while it restarts, which is expected. The connection is
      // reopened on the next attempt.
      await target.close()
    }
  }
  detail('SSH is back, and the server has booted again')

  let last = ''
  for (;;) {
    const progress = rebootProgress(running, await target.inspectContainers(running))
    const summary = `${progress.ready.length} of ${running.length} container(s) healthy`
    if (summary !== last) {
      detail(summary)
      last = summary
    }
    if (progress.waiting.length === 0) break
    if (Date.now() > deadline) {
      throw new NextshipError(
        `After the reboot, ${progress.waiting.join(', ')} did not come back healthy.`,
        'Check them with `nextship server status`, and their logs with `nextship logs`.'
      )
    }
    await sleep(3000)
  }
  ok(`${config.server.host} rebooted, and every app came back healthy.`)
}

// ------------------------------------------------------------------ move

/**
 * `nextship server move user@newhost`: moves this project's app to another server.
 *
 * The old server is only ever read. The new one is set up as `server add` would,
 * receives the app's record, env and key in memory and the live image straight
 * from the old server, and serves the app before nextship.json names it. Until
 * then every command still acts on the old server, so a move that fails part way
 * leaves the project exactly where it was.
 */
export async function moveServer(project: ProjectInfo, options: AddServerOptions): Promise<void> {
  const config = await vmProject(project)
  if (!config.appId) {
    throw new NextshipError('This project has no deployed app to move.', 'Run `nextship server add` for the new server instead.')
  }
  const { host, port } = parseServerAddress(options.address)
  if (host === config.server.host && port === config.server.port) {
    throw new NextshipError(`The app already runs on ${host}:${port}.`, 'Name a different server to move to.')
  }

  const source = client(config) as VmTarget
  const exported = await source.exportApp(config.appId)
  const variables = exported.env.split('\n').filter(Boolean).length

  step('Plan')
  detail(`app        MOVE "${config.name}" (${config.appId})`)
  detail(`from       ${config.server.user}@${config.server.host}:${config.server.port}, which is only read`)
  detail(`to         ${options.address}`)
  detail(`copies     ${variables} env variable(s), the Server Actions key, ${exported.record.domains.length} domain(s), and image ${exported.live.imageTag}`)
  detail('not copied deployment history and older images, so rollback starts fresh there; cached pages and optimized images start cold')
  for (const [index, entry] of MOVE_STEPS.entries()) detail(`step ${index + 1}     ${entry}`)
  detail('DNS        untouched; the records to change are printed once the app serves on the new server')

  const record = await setUpServer(options, undefined, () => {})
  if (!record) {
    detail('Run the same command with --yes to move the app.')
    return
  }

  const destination = client({ ...config, server: record }) as VmTarget
  step(`Copying ${config.name} to ${record.host}`)
  await destination.importApp(exported)
  detail('app record, domains, env file and Server Actions key copied')
  await destination.copyImageFrom(source, exported.live.imageTag as string)
  detail(`image ${exported.live.imageTag} copied`)

  step(`Deploying on ${record.host}`)
  const released = await destination.release(config.appId, {
    name: config.name,
    repository: config.name,
    tag: exported.live.imageTag as string,
    port: CONTAINER_PORT,
    instanceSize: null,
    memory: null,
    healthPath: exported.live.healthPath,
  })
  await destination.awaitRelease(config.appId, released.deploymentId as string, detail, false)

  await writeConfig(project.root, { ...config, server: record })
  ok(`"${config.name}" serves on ${record.host}, and nextship.json now records it.`)

  const address = await destination.publicAddress()
  if (exported.record.domains.length > 0) {
    step('Change these DNS records')
    for (const domain of exported.record.domains) detail(`A       ${domain.domain}  ${address}`)
    detail('Caddy on the new server requests certificates once they resolve to it.')
  }
  warn(
    `The app still runs on ${config.server.host}. To remove it there, restore the previous nextship.json ` +
      `(for example with \`git stash\` or \`git checkout HEAD -- nextship.json\`) and run \`nextship destroy ${config.name}\`, ` +
      'then restore this one.'
  )
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// --------------------------------------------------------------- command

export async function addServer(project: ProjectInfo, options: AddServerOptions): Promise<void> {
  const existing = await readConfig(project.root)
  const record = await setUpServer(options, existing?.server, (host, port, scanned) => assertCanRecord(existing, host, port, scanned))
  if (!record) return

  const config: ProjectConfig = {
    version: 2,
    target: 'vm',
    name: existing?.name ?? project.name,
    server: record,
    ...(existing?.build ? { build: existing.build } : {}),
    ...(existing?.appId ? { appId: existing.appId } : {}),
  }
  await writeConfig(project.root, config)
  ok(`${record.host} is ready, and recorded in nextship.json.`)
  detail('Run `nextship deploy` to see the deployment plan.')
}

/**
 * Plans server setup and, when confirmed, applies it. Returns the server as it
 * should be recorded, or null when this was a plan only. `recorded` is the server
 * nextship.json already names, whose pinned key `admit` has checked; `admit`
 * refuses a server the caller may not use, before anything connects as an admin.
 */
async function setUpServer(
  options: AddServerOptions,
  recorded: ServerRecord | undefined,
  admit: (host: string, port: number, scanned: HostKey) => void
): Promise<ServerRecord | null> {
  const { user, host, port } = parseServerAddress(options.address)
  const skip = skippedSteps(options.optOut)

  step(`Checking ${host}`)
  const scanned = await scanHostKey(host, port)
  admit(host, port, scanned)
  const pinnedBefore = recorded?.host === host && recorded.port === port
  const hostKey = `${host} ${scanned.type} ${scanned.key}`

  const admin = await Ssh.open({ host, port, user, hostKey })
  try {
    if (user !== 'root') {
      const sudo = await admin.exec('sudo -n true')
      if (sudo.code !== 0) {
        throw new NextshipError(
          `${user} cannot run sudo without a password on ${host}.`,
          `Connect as root, or give ${user} passwordless sudo, then run this again. Setup has to install packages and create a user.`
        )
      }
    }

    const input = await setupInput()
    const skipArgs = skip.length > 0 ? ['--skip', skip.join(',')] : []
    const planned = await admin.exec(setupCommand(user, port, ['plan', ...skipArgs]), { stdin: input })
    const lines = parseStepLines(planned.stdout)
    if (lines.length === 0) {
      throw new NextshipError(
        `Setup could not run on ${host}: ${planned.stderr.trim() || `exit code ${planned.code}`}`,
        'Check that the server runs bash. Nothing was changed.'
      )
    }

    step(`Plan for ${host}`)
    detail(`server        ${user}@${host}:${port}`)
    detail(
      pinnedBefore
        ? `host key      ${scanned.type} ${fingerprint(scanned)}, matches nextship.json`
        : `host key      ${scanned.type} ${fingerprint(scanned)}, trusted from now on if you continue`
    )
    for (const line of lines) {
      const label = { ok: 'ok     ', change: 'CHANGE ', done: 'done   ', skip: 'skip   ', refuse: 'REFUSE ' }[line.status]
      detail(`${line.step.padEnd(13)} ${label}${line.detail}`)
    }
    detail(`afterwards    nextship connects as ${SERVICE_USER}@${host}:${port}`)
    detail('untouched     other containers, the Docker daemon configuration, and DNS')

    const refused = lines.filter((line) => line.status === 'refuse')
    if (refused.length > 0) {
      throw new NextshipError(
        `${host} cannot run nextship as it is: ${refused.map((line) => line.detail).join('; ')}.`,
        'Resolve that on the server, then run this again. Nothing was changed.'
      )
    }

    const changes = lines.filter((line) => line.status === 'change')
    warn(`Membership of the docker group is root-equivalent: whoever can log in as ${SERVICE_USER} controls this server.`)
    if (!pinnedBefore) {
      warn(`Compare ${fingerprint(scanned)} with the host key your provider shows for this server before you continue.`)
    }

    if (!options.confirmed) {
      ok(changes.length === 0 ? `${host} is already set up. Nothing was changed.` : 'This was a plan only. Nothing was changed.')
      detail(
        changes.length === 0
          ? 'Run the same command with --yes to record it in nextship.json.'
          : 'Run the same command with --yes to set it up and record it in nextship.json.'
      )
      return null
    }

    if (changes.length > 0) {
      step(`Setting up ${host}`)
      for (const phase of applyPhases(skip)) {
        await applySteps(admin, user, port, input, skipArgs, phase)
        // The first phase ends with the user step, so hardening is never reached
        // without this having passed.
        if (phase.includes('user')) await proveLogin(host, port, hostKey)
      }

      const confirmed = parseStepLines((await admin.exec(setupCommand(user, port, ['plan', ...skipArgs]), { stdin: input })).stdout)
      const unfinished = confirmed.filter((line) => line.status !== 'ok' && line.status !== 'skip')
      if (unfinished.length > 0) {
        throw new NextshipError(
          `Setup ran, but ${unfinished.map((line) => `${line.step} (${line.detail})`).join(', ')} still ${unfinished.length === 1 ? 'is' : 'are'} not done.`,
          'Run `nextship server add` again to see the plan. Every step that is done stays done.'
        )
      }
    } else {
      await proveLogin(host, port, hostKey)
    }

    return { host, port, user: SERVICE_USER, hostKey, arch: reportedArch(lines) }
  } finally {
    await admin.close()
  }
}

async function applySteps(
  admin: Ssh,
  user: string,
  port: number,
  input: string,
  skipArgs: string[],
  steps: SetupStep[]
): Promise<void> {
  const result = await admin.exec(setupCommand(user, port, ['apply', ...skipArgs, ...steps]), { stdin: input })
  for (const line of parseStepLines(result.stdout)) detail(`${line.step.padEnd(13)} ${line.status.padEnd(6)} ${line.detail}`)
  if (result.code !== 0) {
    const tail = result.stderr.trim().split('\n').slice(-15).join('\n')
    throw new NextshipError(
      `Setup failed on ${admin.endpoint.host}: ${tail || `exit code ${result.code}`}`,
      'Steps reported done above stay done. Fix the cause, then run `nextship server add` again to continue.'
    )
  }
}

/**
 * Logs in as the new user from this machine, and checks it can reach Docker,
 * which is what every later command does. Run before anything that would make
 * a mistake here unrecoverable.
 */
async function proveLogin(hostName: string, port: number, hostKey: string): Promise<void> {
  const service = await Ssh.open({ host: hostName, port, user: SERVICE_USER, hostKey })
  try {
    const result = await service.exec("docker version --format '{{.Server.Version}}'")
    if (result.code !== 0) {
      throw new NextshipError(
        `Logged in as ${SERVICE_USER}, but it cannot reach Docker: ${result.stderr.trim()}`,
        'SSH hardening was not applied. Check the docker group on the server, then run this again.'
      )
    }
    detail(`login         ${SERVICE_USER}@${hostName} works and reaches Docker ${result.stdout.trim()}`)
  } finally {
    await service.close()
  }
}
