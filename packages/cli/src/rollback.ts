/**
 * @nextship/cli: rollback
 *
 * Rollback returns the app to a deployment that already ran. It builds nothing
 * and pushes nothing, so it is fast and cannot introduce a new fault.
 *
 * How a target actually goes back is the driver's problem, and it differs
 * sharply: App Platform validates, pins the app and then commits or reverts,
 * while AWS redeploys a previous image tag. This command asks for the outcome
 * and lets the driver decide, which is what makes it portable.
 *
 * Like deploy, it only ever touches the app recorded in `nextship.json`, and it
 * never deletes anything.
 *
 * Author: Gowtham
 * Design: ../../../docs/00-design.md §10
 */

import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import { ownedApp } from './owned-app.js'
import type { DeploymentRecord } from './targets/target.js'
import { detail, ok, step } from './util/log.js'

export interface RollbackOptions {
  confirmed: boolean
  /** Roll back to this deployment instead of the previous live one. */
  to?: string
}

export async function rollback(project: ProjectInfo, options: RollbackOptions): Promise<void> {
  const app = await ownedApp(project)

  const deployments = await app.target.deployments(app.appId)
  const live = deployments.find((entry) => entry.live)
  const candidates = rollbackCandidates(deployments, live?.id)

  const target = options.to ? deployments.find((entry) => entry.id === options.to) : candidates[0]

  if (options.to && !target) {
    throw new NextshipError(
      `Deployment ${options.to} does not belong to app "${app.name}".`,
      'Run `nextship rollback` with no arguments to see the deployments you can roll back to.'
    )
  }
  if (!target) {
    throw new NextshipError(
      'There is no earlier successful deployment to roll back to.',
      `App "${app.name}" has ${deployments.length} deployment(s) on record, and none of them is an earlier one that served traffic.`
    )
  }

  step('Plan')
  detail(`app        ${app.name} (${app.appId})`)
  detail(`current    ${describe(live)}`)
  detail(`roll back  ${describe(target)}`)
  detail('no build, no push: this reuses an image that already ran')
  detail('nothing is deleted; the current deployment stays in the history')

  if (!options.confirmed) {
    ok('This was a plan only. Nothing changed.')
    detail('Run `nextship rollback --yes` to execute it.')
    if (candidates.length > 1) {
      detail('Other deployments you could target with --to <id>:')
      for (const option of candidates.slice(1, 6)) detail(`  ${describe(option)}`)
    }
    return
  }

  step('Rolling back')
  await app.target.rollback(app.appId, target.id, detail)

  const address = await app.target.address(app.appId)
  ok(
    `Rolled back to ${target.imageTag ?? target.id}: ${
      address?.platformHost ? `https://${address.platformHost}` : 'URL unchanged'
    }`
  )
}

/**
 * Deployments worth rolling back to, newest first.
 *
 * `served` rather than a phase name, because each platform spells the phases
 * differently. App Platform reports `SUPERSEDED` for a deployment that has been
 * replaced, and filtering on `ACTIVE` alone matched only the deployment already
 * live, which made rollback report that there was nothing to roll back to with a
 * perfectly good previous one sitting in the history.
 */
export function rollbackCandidates(
  deployments: DeploymentRecord[],
  liveId: string | undefined
): DeploymentRecord[] {
  return deployments.filter((entry) => entry.served && entry.id !== liveId)
}

const describe = (deployment: DeploymentRecord | undefined): string =>
  deployment
    ? `${deployment.imageTag ?? deployment.id}  ${deployment.createdAt}  (${deployment.cause})`
    : 'none'
