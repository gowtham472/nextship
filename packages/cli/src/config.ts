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
const CONFIG_VERSION = 1

export interface ProjectConfig {
  version: number
  /** Only DigitalOcean today. AWS is v1.1. */
  target: 'digitalocean'
  region: string
  /** App Platform app name, and the repository name inside the registry. */
  name: string
  registry: string
  /** Set once the app exists. Its presence is what authorises updating that app. */
  appId?: string
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

  if (parsed.version < CONFIG_VERSION) {
    throw new NextshipError(
      `${CONFIG_FILE} is version ${parsed.version}, which this CLI no longer reads.`,
      'It was written by an older nextship. Delete it and run `nextship deploy` to recreate it.'
    )
  }
  return parsed
}

export async function writeConfig(root: string, config: ProjectConfig): Promise<void> {
  await writeFile(path.join(root, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}
