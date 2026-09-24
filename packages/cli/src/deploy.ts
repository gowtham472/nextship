/**
 * @nextship/cli: deploy
 *
 * Builds, delivers and releases an image to the project's target.
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
import { buildWithReconnect } from './build-attempts.js'
import { buildProject, storedEncryptionKey } from './build.js'
import { packageImage } from './packaging.js'
import { readConfig, writeConfig, TARGET_IDS, type BuildMode, type ProjectConfig, type TargetId } from './config.js'
import { CONTAINER_PORT } from './image/dockerfile.js'
import { client as apiClient } from './owned-app.js'
import { DEFAULT_REGION } from './targets/digitalocean-target.js'
import type { EnvRecord, Target } from './targets/target.js'
import { detail, ok, step, warn } from './util/log.js'

export interface DeployOptions {
  /** Without this nothing is created or changed. The plan is printed and the command stops. */
  confirmed: boolean
  /** `--target`, which chooses only for a project with no nextship.json yet. */
  target?: string
  /** DigitalOcean only: the region for a project that has none recorded. */
  region?: string
  /** DigitalOcean only: the App Platform instance size. */
  instanceSize?: string
  /** DigitalOcean only: the registry name, which must be unique across all of DigitalOcean. */
  registry?: string
  /** vm only: where the image is built. Recorded in nextship.json. */
  build?: BuildMode
  /** vm only: the container memory limit, such as `512m`. */
  memory?: string
}

/**
 * What this deploy will record, before anything exists: the file as it stands,
 * or for a first deploy the choices the flags made.
 */
export function settingsFor(
  projectName: string,
  existing: ProjectConfig | null,
  options: DeployOptions
): ProjectConfig {
  const target = existing?.target ?? options.target ?? 'digitalocean'
  const doOnly = [
    options.region !== undefined ? '--region' : null,
    options.instanceSize !== undefined ? '--size' : null,
    options.registry !== undefined ? '--registry' : null,
  ].filter((flag): flag is string => flag !== null)
  if (target !== 'digitalocean' && doOnly.length > 0) {
    throw new NextshipError(
      `${doOnly.join(', ')} only ${doOnly.length === 1 ? 'applies' : 'apply'} to the digitalocean target, and this project deploys to ${target}.`,
      'Drop them and run the command again.'
    )
  }
  const vmOnly = [options.build !== undefined ? '--build' : null, options.memory !== undefined ? '--memory' : null].filter(
    (flag): flag is string => flag !== null
  )
  if (target !== 'vm' && vmOnly.length > 0) {
    throw new NextshipError(
      `${vmOnly.join(', ')} only ${vmOnly.length === 1 ? 'applies' : 'apply'} to the vm target, and this project deploys to ${target}.`,
      'Drop them and run the command again.'
    )
  }
  if (options.build !== undefined && options.build !== 'remote' && options.build !== 'local') {
    throw new NextshipError(`--build "${options.build}" is not a build mode.`, 'Use `--build remote` or `--build local`.')
  }

  if (existing) {
    // The recorded region wins: an app cannot move region by redeploying. A build
    // mode is recorded, so a later deploy from anywhere builds the same way.
    if (options.registry) return { ...existing, registry: options.registry }
    if (options.build) return { ...existing, build: options.build }
    return existing
  }
  if (target !== 'digitalocean') {
    throw new NextshipError(
      TARGET_IDS.includes(target as TargetId)
        ? `The ${target} target needs a server on record, and this project has none.`
        : `Unknown target "${target}".`,
      TARGET_IDS.includes(target as TargetId)
        ? 'Run `nextship server add user@host` first, which records the server in nextship.json.'
        : `nextship deploys to: ${TARGET_IDS.join(', ')}.`
    )
  }
  return {
    version: 1,
    target: 'digitalocean',
    name: projectName,
    region: options.region ?? DEFAULT_REGION,
    registry: options.registry ?? projectName,
  }
}

export async function deploy(project: ProjectInfo, options: DeployOptions): Promise<void> {
  const existing = await readConfig(project.root)
  const settings = settingsFor(project.name, existing, options)
  const client = apiClient(settings, existing ? options.target : undefined)
  const name = settings.name

  // Read-only reconnaissance first, so the plan describes reality.
  const delivery = await client.planDelivery(name)
  const apps = await client.listApps()
  const owned = existing?.appId ? apps.find((app) => app.id === existing.appId) : undefined
  const nameClash = apps.find((app) => app.name === name && app.id !== existing?.appId)

  if (nameClash) {
    throw new NextshipError(
      `An app named "${name}" already exists ${client.appScope}, and nextship did not create it.`,
      'nextship will not modify an app it does not own. Rename this project, or set a different name in nextship.json.'
    )
  }
  if (existing?.appId && !owned) {
    throw new NextshipError(
      `nextship.json records app ${existing.appId}, which no longer exists ${client.appScope}.`,
      'Remove the appId from nextship.json to create a new app, after confirming the old one is really gone.'
    )
  }

  // Read here rather than at write time so the plan can describe what survives
  // and what is missing before anything is built.
  const preserved = owned ? await client.preservedSettings(owned.id) : []
  const existingEnv = owned ? await client.env(owned.id) : []

  // ------------------------------------------------------------------- plan

  step('Plan')
  const lines = await client.planLines({
    name,
    appId: owned?.id ?? null,
    instanceSize: options.instanceSize ?? null,
    memory: options.memory ?? null,
    delivery,
  })
  for (const line of lines) detail(line)
  if (preserved.length > 0) detail(`preserved     ${preserved.join(', ')}, kept as they are`)
  detail(`untouched     ${apps.length} existing app(s) ${client.appScope}`)
  detail(client.deployRemoves ?? 'nothing is ever deleted by this command')

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

  const serverKey = await client.actionsKey(await storedEncryptionKey(project.root), detail)

  const platform = await client.buildPlatform()
  const { build, image } = await buildWithReconnect(
    () => client.builder(),
    async (builder) => {
      if (builder.warning) warn(builder.warning)
      const placement = { platform, dockerHost: builder.dockerHost, cacheScope: builder.cacheScope }
      const build = await buildProject(project, placement, serverKey)
      return { build, image: await packageImage(project, build) }
    },
    warn
  )
  const deploymentId = build.identity.deploymentId

  step('Delivering image')
  const delivered = await client.deliverImage({
    localTag: image.tag,
    name,
    tag: deploymentId,
    cwd: project.root,
    onPhase: detail,
  })
  if (delivered.reference) detail(delivered.reference)

  detail(
    build.manifest.healthPath
      ? `health     ${build.manifest.healthPath}, which this build prerenders`
      : 'health     /, which this build renders on every probe because it prerenders no page to probe'
  )

  // Asked before the release, while the live flag still describes what serves now.
  // An app can exist without ever having served, when its first deployment failed.
  const serving = owned ? (await client.deployments(owned.id)).some((deployment) => deployment.live) : false

  step(owned ? `Updating app "${name}"` : `Creating app "${name}"`)
  const released = await client.release(owned?.id ?? null, {
    name,
    repository: name,
    tag: deploymentId,
    port: CONTAINER_PORT,
    instanceSize: options.instanceSize ?? null,
    memory: options.memory ?? null,
    healthPath: build.manifest.healthPath,
  })
  const appId = released.appId

  // From here to the end of the release, every path out has to reach either
  // awaitRelease or abandonRelease. A driver may be holding something for this
  // release: on a server it is the app's deploy lock, which nothing breaks
  // automatically, so an early return or a thrown error here used to leave a
  // lock a person had to go and remove by hand, with the new container still
  // running beside it.
  //
  // Ctrl+C is the same problem arriving from outside. Handled rather than left
  // to kill the process mid-wait, so the release is given back the same way.
  const stopping = new AbortController()
  const interrupt = (): void => stopping.abort()
  process.on('SIGINT', interrupt)

  let handedOff = false
  try {
    // Written before waiting, so a timeout still leaves the app recorded as ours
    // rather than orphaned and unadoptable on the next run.
    const config: ProjectConfig = {
      ...settings,
      ...(delivered.store ? { registry: delivered.store } : {}),
      appId,
    }
    await writeConfig(project.root, config)
    detail('recorded in nextship.json')

    if (!released.deploymentId) {
      warn(`${client.displayName} reported no deployment to follow. Check its control panel.`)
      return
    }

    step('Waiting for the deployment to go live')
    handedOff = true
    await client.awaitRelease(appId, released.deploymentId, detail, serving, stopping.signal)
  } finally {
    process.off('SIGINT', interrupt)
    // awaitRelease ends the release itself, whether it succeeded or threw, so
    // this only covers the paths that never reached it.
    if (!handedOff) await client.abandonRelease(appId, released.deploymentId)
  }

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
  const platform = address?.platformUrl

  ok(`Deployed: ${platform ?? 'URL not yet assigned'}`)

  for (const domain of address?.domains ?? []) {
    detail(`https://${domain.domain}  ${domain.state === 'live' ? 'live' : domain.detail}`)
  }
}
