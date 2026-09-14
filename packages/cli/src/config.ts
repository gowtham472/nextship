/**
 * @nextship/cli: project configuration
 *
 * `nextship.json` records what nextship provisioned, so later runs act on
 * resources it created rather than resources it guessed at. It is committed and
 * holds no secrets.
 *
 * The recorded app id is the ownership record: nextship updates that app and no
 * other. An app that merely shares a name is refused, because on an account
 * running other services a name collision is exactly where guessing does damage.
 *
 * Author: Gowtham
 * Design: ../../../docs/design.md §8.3
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextshipError } from './errors.js'

const CONFIG_FILE = 'nextship.json'

/**
 * Version 2 added the VM target. A file is written as version 1 whenever it
 * holds nothing version 2 introduced, so a DigitalOcean project is never
 * rewritten into a format an older nextship on another machine refuses to read.
 */
const CONFIG_VERSION = 2

export type TargetId = 'digitalocean' | 'vm'

export const TARGET_IDS: readonly TargetId[] = ['digitalocean', 'vm']

/** Where images are built for a VM: on the server over a tunnel, or here and then copied. */
export type BuildMode = 'remote' | 'local'

/** The server a VM project deploys to, as `nextship server add` recorded it. */
export interface ServerRecord {
  host: string
  port: number
  user: string
  /** The full `ssh-keyscan` line, so every connection checks the key rather than trusting it. */
  hostKey: string
  arch: 'amd64' | 'arm64'
}

export interface ProjectConfig {
  version: number
  target: TargetId
  /** App Platform region. DigitalOcean only. */
  region?: string
  /** App name on the target, and the repository name for its images. */
  name: string
  /** Container registry name. DigitalOcean only. */
  registry?: string
  /** Set once the app exists. Its presence is what authorises updating that app. */
  appId?: string
  /** VM only. */
  server?: ServerRecord
  /** VM only. Absent means `remote`. */
  build?: BuildMode
}

export async function readConfig(root: string): Promise<ProjectConfig | null> {
  let contents: string
  try {
    contents = await readFile(path.join(root, CONFIG_FILE), 'utf8')
  } catch {
    return null
  }

  let parsed: ProjectConfig
  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new NextshipError(
      `${CONFIG_FILE} is not valid JSON.`,
      'Fix or delete it. Deleting it makes nextship forget which app it owns, so it will refuse to touch the existing one.'
    )
  }

  // A missing version is a different problem from a newer one, and the actions
  // are opposites. Telling someone whose file was hand-written or truncated to
  // update nextship sends them to fix the one thing that is not wrong.
  if (typeof parsed.version !== 'number') {
    throw new NextshipError(
      `${CONFIG_FILE} has no version field, so nextship cannot tell what wrote it.`,
      'A file nextship wrote always has one. Delete it and run `nextship deploy` to recreate it. ' +
        'Deleting it makes nextship forget which app it owns, so it will refuse to touch the existing one until you deploy again.'
    )
  }

  if (parsed.version > CONFIG_VERSION) {
    throw new NextshipError(
      `${CONFIG_FILE} is version ${parsed.version}, but this CLI reads version ${CONFIG_VERSION}.`,
      'A newer nextship wrote this file. Update nextship.'
    )
  }

  if (parsed.version < 1) {
    throw new NextshipError(
      `${CONFIG_FILE} is version ${parsed.version}, which this CLI no longer reads.`,
      'It was written by an older nextship. Delete it and run `nextship deploy` to recreate it.'
    )
  }

  validateConfig(parsed)
  return parsed
}

/**
 * Refuses a file whose fields do not describe a target nextship can act on.
 *
 * Every command resolves its driver from this file, so a field that is missing
 * here would otherwise surface as an undefined region in an API call or a
 * connection to a host named `undefined`.
 */
function validateConfig(config: ProjectConfig): void {
  const refuse = (problem: string): never => {
    throw new NextshipError(
      `${CONFIG_FILE} ${problem}.`,
      'Fix the field by hand, or restore the file from version control. nextship will not guess a value for it.'
    )
  }

  if (typeof config.name !== 'string' || config.name.length === 0) refuse('has no app name')
  if (!TARGET_IDS.includes(config.target)) refuse(`names an unknown target "${String(config.target)}"`)

  if (config.target === 'digitalocean') {
    if (typeof config.region !== 'string' || config.region.length === 0) refuse('has no region for DigitalOcean')
    if (typeof config.registry !== 'string' || config.registry.length === 0) {
      refuse('has no registry for DigitalOcean')
    }
    if (config.server !== undefined || config.build !== undefined) {
      refuse('records a server or build mode, which only the vm target uses')
    }
    return
  }

  if (config.version < 2) refuse('is version 1, which cannot describe the vm target')

  const server = config.server
  if (!server || typeof server !== 'object') refuse('has no server for the vm target; run `nextship server add`')
  const record = server as ServerRecord
  if (typeof record.host !== 'string' || record.host.length === 0) refuse('has a server with no host')
  if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535) refuse('has a server with an invalid port')
  if (typeof record.user !== 'string' || record.user.length === 0) refuse('has a server with no user')
  if (typeof record.hostKey !== 'string' || record.hostKey.length === 0) {
    refuse('has a server with no pinned host key')
  }
  if (record.arch !== 'amd64' && record.arch !== 'arm64') refuse('has a server with an unknown architecture')
  if (config.build !== undefined && config.build !== 'remote' && config.build !== 'local') {
    refuse(`has an unknown build mode "${String(config.build)}"`)
  }
  if (config.region !== undefined || config.registry !== undefined) {
    refuse('records a region or registry, which only the digitalocean target uses')
  }
}

/** The lowest version that can hold everything in this config. */
function configVersion(config: Omit<ProjectConfig, 'version'>): number {
  return config.target === 'vm' || config.server !== undefined || config.build !== undefined ? 2 : 1
}

export async function writeConfig(root: string, config: ProjectConfig): Promise<void> {
  const written = { ...config, version: configVersion(config) }
  await writeFile(path.join(root, CONFIG_FILE), `${JSON.stringify(written, null, 2)}\n`, 'utf8')
}
