/**
 * @nextship/cli: destroy
 *
 * Removes what nextship created for a project, and nothing else. It is the only
 * command that deletes infrastructure, so it is the one place where being
 * careful matters more than being convenient.
 *
 * Every other command is safe because it cannot delete. This one cannot borrow
 * that property, so it gets two gates instead of one: the app's name has to be
 * typed out, and `--yes` still has to follow. The name matters because every
 * other command acts on whatever directory you happen to be in, and `--yes`
 * alone in the wrong directory would destroy the wrong app. Naming it means the
 * mistake has to be made twice, in agreement with itself.
 *
 * What it refuses to touch is as deliberate as what it removes: the container
 * registry is shared by every project on the account, and DNS records were
 * created by the domain's owner, not by nextship.
 *
 * Author: Gowtham
 * Roadmap: ../../../docs/roadmap.md v0.4
 */

import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import { readConfig, writeConfig } from './config.js'
import { ownedApp } from './owned-app.js'
import { orderForDeletion } from './images.js'
import { detail, ok, step, warn } from './util/log.js'

export interface DestroyOptions {
  confirmed: boolean
  /** The app name, which must match the one on record. */
  name: string
  /** Also remove the project's images from the registry. */
  images: boolean
}

/**
 * Refuses unless the name given matches the app on record.
 *
 * Every other command acts on whatever directory it is run from, which is fine
 * when nothing can be destroyed. Here it is not: `--yes` typed in the wrong
 * project would remove the wrong app. Requiring the name means the mistake has
 * to be made twice and agree with itself.
 */
export function nameMatches(given: string, recorded: string): void {
  if (given === recorded) return
  throw new NextshipError(
    `This project's app is "${recorded}", not "${given}".`,
    `Run \`nextship destroy ${recorded}\` if that is really the app you mean. Nothing was changed.`
  )
}

export async function destroy(project: ProjectInfo, options: DestroyOptions): Promise<void> {
  const app = await ownedApp(project)
  const config = await readConfig(project.root)

  nameMatches(options.name, app.name)

  // Read before deleting, so the plan can say what stops working rather than
  // only what is removed.
  await app.target.requireApp(app.appId)
  const address = await app.target.address(app.appId)
  const domains = address?.domains ?? []
  const manifests = options.images && config?.registry ? await app.target.images(config.name) : []
  // `--images` with nothing to remove is not an image removal. Treating it as
  // one would warn about a read-only registry and then start a collection with
  // nothing to collect.
  const removingImages = options.images && manifests.length > 0

  step('Plan')
  detail(`app        DESTROY "${app.name}" (${app.appId})`)
  detail(`address    ${address?.platformHost ?? 'not yet assigned'} stops serving and is not reissued`)
  for (const domain of domains) detail(`domain     ${domain.domain} stops serving this app`)
  if (removingImages) {
    detail(`images     remove all ${manifests.length} image(s) from ${config?.registry}/${config?.name}, then collect`)
  } else if (options.images) {
    detail(`images     none in ${config?.registry ?? 'the registry'}/${config?.name}, nothing to remove`)
  } else {
    detail(
      `images     kept in ${config?.registry ?? 'the registry'}; run \`nextship images prune --gc --yes\` first if you want them gone`
    )
  }
  detail(`registry   kept, it is shared by every project on this account`)
  detail(`DNS        untouched, nextship did not create your records`)

  const others = (await app.target.listApps()).filter((entry) => entry.id !== app.appId)
  detail(`untouched  ${others.length} other app(s) in this account`)

  warn('This cannot be undone. The app, its deployments and its history are removed.')
  if (removingImages) {
    warn(
      'Garbage collection runs afterwards and puts the whole registry into read-only mode, ' +
        'so a deploy of any other project during it will fail to push.'
    )
  }
  if (domains.length > 0) {
    warn(
      'A replacement app gets a new generated hostname, so the DNS record for ' +
        `${domains.map((domain) => domain.domain).join(', ')} will point at nothing until you update it.`
    )
  }

  if (!options.confirmed) {
    ok('This was a plan only. Nothing was destroyed.')
    detail(`Run \`nextship destroy ${app.name} --yes\` to execute it.`)
    return
  }

  step('Destroying')
  await app.target.destroyApp(app.appId)
  ok(`App "${app.name}" destroyed.`)

  // Written before anything else can fail, so a later error cannot leave the
  // project pointing at an app that is already gone, which every command would
  // then refuse to act on.
  if (config) {
    await writeConfig(project.root, { ...config, appId: undefined })
    detail('nextship.json no longer records an app, so `nextship deploy` will create a new one')
  }

  if (!removingImages || !config?.registry) return

  step('Removing images')
  await app.target.removeImages(config.name, orderForDeletion(manifests).map((manifest) => manifest.id))
  ok(`${manifests.length} image(s) removed.`)

  // Collection is started here rather than left to the user. Every other command
  // resolves the registry through the app, and the app is gone, so
  // `nextship images prune --gc` would now refuse: telling them to run it would
  // be an instruction that cannot be followed.
  step('Reclaiming storage')
  const outcome = await app.target.reclaim()
  if (outcome.kind === 'already-running') detail(`collection is already running (${outcome.detail})`)
  else if (outcome.kind === 'not-needed') ok('Storage was freed when the images were removed.')
  else ok('Garbage collection started, which is what frees the storage.')
}
