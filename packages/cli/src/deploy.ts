/**
 * @nextship/cli: deploy
 *
 * Builds, pushes and releases to DigitalOcean.
 *
 * The whole command is built around one rule: **it must be impossible for this
 * to damage anything it did not create.** Concretely that means no delete call
 * exists anywhere in the path, the only app it will update is the one recorded
 * in `nextship.json`, an app that merely shares a name is refused rather than
 * adopted, and nothing at all happens without `--yes` after the plan is shown.
 *
 * Author: Gowtham
 * Design: ../../../docs/design.md §9, §10
 */

import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import { buildProject } from './build.js'
import { packageImage } from './packaging.js'
import { readConfig, writeConfig, type ProjectConfig } from './config.js'
import { CONTAINER_PORT } from './image/dockerfile.js'
import { client as apiClient } from './owned-app.js'
import type { EnvRecord, Target } from './targets/target.js'
import { detail, ok, step, warn } from './util/log.js'

export interface DeployOptions {
  /** Without this nothing is created or changed. The plan is printed and the command stops. */
  confirmed: boolean
  region: string
  instanceSize: string
  /** Overrides the registry name, which must be unique across all of DigitalOcean. */
  registry?: string
}

export async function deploy(project: ProjectInfo, options: DeployOptions): Promise<void> {
  const client = apiClient()
  const existing = await readConfig(project.root)
  const name = existing?.name ?? project.name
  const registryName = options.registry ?? existing?.registry ?? name
  const region = existing?.region ?? options.region

  // Read-only reconnaissance first, so the plan describes reality.
  const store = await client.prepareImageStore(registryName, region, { dryRun: true })
  const apps = await client.listApps()
  const owned = existing?.appId ? apps.find((app) => app.id === existing.appId) : undefined
  const nameClash = apps.find((app) => app.name === name && app.id !== existing?.appId)

  if (nameClash) {
    throw new NextshipError(
      `An app named "${name}" already exists in this account, and nextship did not create it.`,
      'nextship will not modify an app it does not own. Rename this project, or set a different name in nextship.json.'
    )
  }
  if (existing?.appId && !owned) {
    throw new NextshipError(
      `nextship.json records app ${existing.appId}, which no longer exists in this account.`,
      'Remove the appId from nextship.json to create a new app, after confirming the old one is really gone.'
    )
  }

  // The spec of the app being updated, read here rather than at write time so
  // the plan can describe what survives and what is missing before anything is
  // built. It is also what the update is merged into.
  const preservedFields = owned ? await client.preservedSettings(owned.id) : []
  const existingEnv = owned ? await client.env(owned.id) : []

  // ------------------------------------------------------------------- plan

  const willCreateRegistry = store.willCreate
  const registryInUse = store.store

  step('Plan')
  detail(`target        DigitalOcean, region ${region}`)
  detail(
    willCreateRegistry
      ? `registry      CREATE "${registryName}" on the Basic tier, 5 GiB, $5/month`
      : `registry      use existing "${registryInUse}", unchanged`
  )
  detail(`repository    ${registryInUse}/${name}`)
  detail(
    owned
      ? `app           UPDATE "${name}" (${owned.id}), which nextship created`
      : `app           CREATE "${name}" on ${options.instanceSize}`
  )
  detail(`instance      ${options.instanceSize}, 1 instance`)
  detail(`project       default (this token cannot assign projects)`)
  const preserved = preservedFields
  if (preserved.length > 0) detail(`preserved     ${preserved.join(', ')}, kept as they are`)
  detail(`untouched     ${apps.length} existing app(s) in this account`)
  detail('nothing is ever deleted by this command')

  warnAboutMissingRuntimeEnv(project, existingEnv, owned !== undefined)

  if (!options.confirmed) {
    ok('This was a plan only. Nothing was created or changed.')
    detail('Run the same command with --yes to execute it.')
    return
  }

  // ---------------------------------------------------------------- execute

  // Checked before building rather than only at the write, so a deploy that would
  // be refused says so now instead of after a full build and push.
  if (owned) await client.assertIdle(owned.id)

  if (willCreateRegistry) {
    step(`Creating an image store named "${registryName}" (Basic, $5/month)`)
    await client.prepareImageStore(registryName, region, { dryRun: false })
  }

  const build = await buildProject(project)
  const image = await packageImage(project, build)
  const tag = build.identity.deploymentId

  step('Pushing image')
  const remoteTag = await client.pushImage({
    localTag: image.tag,
    repository: name,
    tag,
    cwd: project.root,
  })
  detail(remoteTag)

  detail(
    build.manifest.healthPath
      ? `health     ${build.manifest.healthPath}, which this build prerenders`
      : 'health     /, which this build renders on every probe because nothing is prerendered'
  )

  step(owned ? `Updating app "${name}"` : `Creating app "${name}"`)
  const released = await client.release(owned?.id ?? null, {
    name,
    region,
    repository: name,
    tag,
    port: CONTAINER_PORT,
    instanceSize: options.instanceSize,
    healthPath: build.manifest.healthPath,
  })
  const appId = released.appId

  // Written before waiting, so a timeout still leaves the app recorded as ours
  // rather than orphaned and unadoptable on the next run.
  const config: ProjectConfig = {
    version: 1,
    target: client.id as ProjectConfig['target'],
    region,
    name,
    registry: registryInUse,
    appId,
  }
  await writeConfig(project.root, config)
  detail('recorded in nextship.json')

  if (!released.deploymentId) {
    warn(`${client.displayName} reported no deployment to follow. Check its control panel.`)
    return
  }

  step('Waiting for the deployment to go live')
  await client.awaitRelease(appId, released.deploymentId, detail)

  await reportUrls(client, appId)
}



/**
 * Says so when a project keeps env files but the deployed app has no runtime
 * environment at all.
 *
 * This combination is silent and wrong: values Next.js inlines at build time
 * still work, so the app boots and most pages render, while anything read at
 * request time is undefined. Without this warning the first sign is a runtime
 * failure in production, and `deploy` is the moment where it is cheap to say.
 * It is a warning rather than a prompt because uploading development values is
 * often exactly the wrong thing to do, which is why `env push` is explicit.
 */
function warnAboutMissingRuntimeEnv(project: ProjectInfo, existing: EnvRecord[], appExists: boolean): void {
  if (project.envFiles.length === 0) return
  if (appExists && existing.length > 0) return

  warn(
    `This project has ${project.envFiles.join(', ')}, but the app will have no runtime environment. ` +
      'Values Next.js inlines at build time still work; anything read at request time will be undefined. ' +
      'Run `nextship env push` if those values belong in production.'
  )
}

/**
 * Says where the app can actually be reached.
 *
 * A target reports a primary custom domain as the app's address as soon as one
 * is attached, and a domain answers nothing until its DNS record exists, so
 * reporting that alone can announce a dead link after a successful deploy. The
 * platform hostname always works, so it is always given, and custom domains are
 * listed with the state the target reports for each.
 */
async function reportUrls(client: Target, appId: string): Promise<void> {
  const address = await client.address(appId)
  const platform = address?.platformHost

  ok(`Deployed: ${platform ? `https://${platform}` : 'URL not yet assigned'}`)

  for (const domain of address?.domains ?? []) {
    detail(`https://${domain.domain}  ${domain.state === 'live' ? 'live' : domain.detail}`)
  }
}
