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
import { readConfig } from './config.js'
import { DigitalOcean } from './targets/digitalocean.js'
import { DigitalOceanTarget } from './targets/digitalocean-target.js'
import type { Target } from './targets/target.js'

export interface OwnedApp {
  target: Target
  appId: string
  name: string
}

/**
 * The driver for a project's target, authenticated.
 *
 * Commands are handed a `Target` rather than a cloud's client, so that adding a
 * second cloud is a new driver rather than an edit to every command. Which
 * driver is chosen comes from `nextship.json`, which is why that file records a
 * target at all.
 */
export function client(): Target {
  const token = process.env.DIGITALOCEAN_TOKEN
  if (!token) {
    throw new NextshipError(
      'DIGITALOCEAN_TOKEN is not set.',
      'Create a token with Registry and Apps scopes, export it, then run the command again. See docs/06-digitalocean-setup.md.'
    )
  }
  return new DigitalOceanTarget(new DigitalOcean(token))
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
  return { target: client(), appId: config.appId, name: config.name }
}
