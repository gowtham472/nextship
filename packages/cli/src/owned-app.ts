/**
 * @nextship/cli: the app nextship owns
 *
 * Every command that talks to a target needs the same two things: an
 * authenticated client, and the one app this project is allowed to touch. That
 * had been written three times, twice byte for byte and once with a different
 * instruction for the same failure, so the advice a user got depended on which
 * command they happened to run first.
 *
 * The rule this encodes is the one the whole safety posture rests on: the app is
 * resolved from the id recorded in `nextship.json`, never by name. On an account
 * running other services, matching by name is exactly where a tool does damage.
 *
 * Author: Gowtham
 * Rules: ../../../AGENTS.md §4
 */

import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import { readConfig, TARGET_IDS, type ProjectConfig } from './config.js'
import { DigitalOcean } from './targets/digitalocean.js'
import { DigitalOceanTarget } from './targets/digitalocean-target.js'
import type { Target } from './targets/target.js'
import { VmTarget } from './targets/vm/vm-target.js'
import { docsUrl } from './links.js'

export interface OwnedApp {
  target: Target
  appId: string
  name: string
  config: ProjectConfig
}

/**
 * The driver for a project's target, authenticated.
 *
 * Commands are handed a `Target` rather than a cloud's client, so that adding a
 * second target is a new driver rather than an edit to every command. Which
 * driver is chosen comes from `nextship.json`, which is why that file records a
 * target at all. `requested` is `deploy --target`, which only chooses when there
 * is no file yet, and is refused when it disagrees with one.
 */
export function client(config: ProjectConfig | null, requested?: string): Target {
  const target = config?.target ?? requested ?? 'digitalocean'

  if (config && requested && requested !== config.target) {
    throw new NextshipError(
      `This project deploys to ${config.target}, according to nextship.json, not to ${requested}.`,
      'Drop --target. Moving a project to another target is not something nextship does in place.'
    )
  }

  if (target === 'vm') {
    if (!config) {
      throw new NextshipError(
        'The vm target needs a server on record, and this project has none.',
        'Run `nextship server add user@host` first, which records the server in nextship.json.'
      )
    }
    const driver = new VmTarget(config)
    opened.push(driver)
    return driver
  }

  if (target !== 'digitalocean') {
    throw new NextshipError(
      `Unknown target "${target}".`,
      `nextship deploys to: ${TARGET_IDS.join(', ')}.`
    )
  }

  const token = process.env.DIGITALOCEAN_TOKEN
  if (!token) {
    throw new NextshipError(
      'DIGITALOCEAN_TOKEN is not set.',
      `Create a token with Registry and Apps scopes, export it, then run the command again. See ${docsUrl('digitalocean.md')}.`
    )
  }
  if (!config?.region || !config.registry) {
    throw new NextshipError(
      'This DigitalOcean project has no region or registry on record.',
      'Run `nextship deploy`, which records both.'
    )
  }
  return new DigitalOceanTarget(new DigitalOcean(token), { region: config.region, registry: config.registry })
}

/**
 * Drivers holding a connection, closed once when the command ends. A server's
 * SSH connection is shared by every step of a command, so it outlives any one
 * call and nothing but the command's end knows when it is finished.
 */
const opened: VmTarget[] = []

export async function closeTargets(): Promise<void> {
  await Promise.all(opened.splice(0).map((driver) => driver.close()))
}

/** The app recorded for this project, refusing to guess when there is none. */
export async function ownedApp(project: ProjectInfo): Promise<OwnedApp> {
  const config = await readConfig(project.root)
  if (!config?.appId) {
    throw new NextshipError(
      'This project has no deployed app on record.',
      'Run `nextship deploy` first. nextship only acts on apps listed in nextship.json.'
    )
  }
  return { target: client(config), appId: config.appId, name: config.name, config }
}
