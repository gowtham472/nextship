/**
 * @nextship/cli: registry image retention
 *
 * Every deploy pushes an image and nothing ever removed one, so registry storage
 * grew without bound against a billed quota. Rollback is the reason images are
 * kept at all: it re-releases an image that already ran, so pruning too
 * aggressively removes the ability to go back.
 *
 * Two facts shape this, both measured rather than assumed.
 *
 * **Deleting a tag reclaims nothing.** The manifest survives untagged and keeps
 * referencing its layers, so garbage collection finds nothing unreferenced.
 * Measured on a real registry: deleting a tag and running collection to
 * completion freed 0 bytes and deleted 0 blobs.
 *
 * **But deleting untagged manifests destroys running deployments.** A tag points
 * to an OCI index whose platform manifests the registry API also reports as
 * untagged. The live deployment's tag is a 3.9 KB index whose amd64 child is a
 * 181.9 MiB manifest listed as untagged, so the obvious cleanup deletes the
 * image the app is running.
 *
 * So retention works on reachability: the tags being kept are roots, everything
 * they reference is kept with them, and only manifests no retained tag can reach
 * are deleted. Garbage collection then frees the layers.
 *
 * Author: Gowtham
 * Roadmap: ../../../docs/roadmap.md v0.4
 */

import { NextshipError } from './errors.js'
import type { ProjectInfo } from './detect.js'
import { readConfig } from './config.js'
import { ownedApp } from './owned-app.js'
import type { ImageRecord } from './targets/target.js'
import { detail, ok, step, warn } from './util/log.js'

/**
 * How many images to keep by default.
 *
 * Rollback can target any deployment that ran, so this is the number of steps
 * back that stay possible. Five covers a bad afternoon without holding much: on
 * the project this was built against each image is roughly 182 MiB against a
 * 5 GiB tier.
 */
export const DEFAULT_KEEP = 5

export interface PruneOptions {
  confirmed: boolean
  keep: number
  /** Run garbage collection afterwards, which is what actually frees the layers. */
  collect: boolean
}

export interface PrunePlan {
  /** Tags that survive, newest first. */
  keepTags: string[]
  /** Tags that go, because the images they point at are being removed. */
  removeTags: string[]
  /** Manifests no retained tag can reach. */
  remove: ImageRecord[]
  /** Upper bound on what collection can free: layers are shared, so the real figure is lower. */
  reclaimableBytes: number
}

const totalBytes = (manifests: ImageRecord[]): number =>
  manifests.reduce((total, manifest) => total + manifest.sizeBytes, 0)

/**
 * Orders a removal set so every manifest is deleted before the ones it
 * references.
 *
 * The registry refuses to delete a manifest that another manifest still points
 * at: "manifest is referenced by one or more other manifests". An orphaned index
 * and its platform images are removed together, so deleting them in the order
 * the API happened to list them fails on the first child. Indexes have to go
 * first, which frees their children to be deleted next.
 *
 * Only references inside the removal set matter. Anything a retained tag can
 * reach is not in this set at all, so a manifest here is referenced only by
 * others here.
 */
export function orderForDeletion(remove: ImageRecord[]): ImageRecord[] {
  const pending = new Map(remove.map((manifest) => [manifest.id, manifest]))
  const ordered: ImageRecord[] = []

  while (pending.size > 0) {
    const referenced = new Set<string>()
    for (const manifest of pending.values()) {
      for (const child of manifest.children) if (pending.has(child)) referenced.add(child)
    }

    const free = [...pending.values()].filter((manifest) => !referenced.has(manifest.id))
    // A cycle cannot happen in a content-addressed store, since a digest covers
    // its own references. Emitting the remainder rather than looping forever
    // means a malformed graph surfaces as an API error, not a hang.
    const next = free.length > 0 ? free : [...pending.values()]

    for (const manifest of next) {
      ordered.push(manifest)
      pending.delete(manifest.id)
    }
  }

  return ordered
}

/**
 * Decides what goes.
 *
 * The live tag is retained whatever `keep` says. Pruning the image a running
 * deployment was created from leaves an app that runs until something
 * reschedules it and then cannot start, a failure that appears hours later and
 * looks nothing like its cause.
 */
export function planPrune(manifests: ImageRecord[], live: string | null, keep: number): PrunePlan {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new NextshipError(
      `--keep must be a whole number of at least 1, not "${keep}".`,
      'Keeping zero images would leave nothing to roll back to.'
    )
  }

  const tagged = manifests.filter((manifest) => manifest.tags.length > 0)
  const roots: ImageRecord[] = []
  const dropped: ImageRecord[] = []

  for (const manifest of tagged) {
    const isLive = live !== null && manifest.tags.includes(live)
    if (isLive || roots.length < keep) roots.push(manifest)
    else dropped.push(manifest)
  }

  // Everything a retained tag references is retained with it. This is what keeps
  // a live index's platform manifests, which the API reports as untagged, out of
  // the removal set.
  const byDigest = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  const reachable = new Set<string>()
  const queue = roots.map((manifest) => manifest.id)

  while (queue.length > 0) {
    const digest = queue.pop() as string
    if (reachable.has(digest)) continue
    reachable.add(digest)
    for (const child of byDigest.get(digest)?.children ?? []) queue.push(child)
  }

  const remove = manifests.filter((manifest) => !reachable.has(manifest.id))

  return {
    keepTags: roots.flatMap((manifest) => manifest.tags),
    removeTags: dropped.flatMap((manifest) => manifest.tags),
    remove,
    reclaimableBytes: totalBytes(remove),
  }
}

const megabytes = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MiB`

/** Which repository holds this project's images, which the config recorded at deploy time. */
async function repository(project: ProjectInfo): Promise<string> {
  const config = await readConfig(project.root)
  if (!config?.registry) {
    throw new NextshipError(
      'This project has no registry on record.',
      'Run `nextship deploy` first. nextship only acts on resources listed in nextship.json.'
    )
  }
  return config.name
}

/**
 * The tag the app is deployed from, read from the deployment the target reports
 * as live rather than from any one platform's spec.
 */
async function liveTag(app: { target: { deployments: (id: string) => Promise<Array<{ live: boolean; imageTag: string | null }>> }; appId: string }): Promise<string | null> {
  const deployments = await app.target.deployments(app.appId)
  return deployments.find((entry) => entry.live)?.imageTag ?? null
}

/** Lists the images in this project's repository and what each one is for. */
export async function listImages(project: ProjectInfo): Promise<void> {
  const app = await ownedApp(project)
  const repo = await repository(project)
  const live = await liveTag(app)
  const manifests = await app.target.images(repo)
  const tagged = manifests.filter((manifest) => manifest.tags.length > 0)

  step(`Images for ${repo}`)
  if (tagged.length === 0) detail('No tagged images. Run `nextship deploy` to push one.')

  for (const manifest of tagged) {
    const role = live !== null && manifest.tags.includes(live) ? 'deployed now' : 'kept for rollback'
    detail(`${manifest.tags.join(', ')}  ${manifest.updatedAt}  ${role}`)
  }

  // Untagged manifests are normal: they are the platform images a tagged index
  // points at. Only those no tag can reach are waste, so they are counted rather
  // than listed, and identifying them is what `prune` does.
  const orphans = planPrune(manifests, live, Number.MAX_SAFE_INTEGER).remove
  if (orphans.length > 0) {
    detail(`orphaned   ${orphans.length} image(s) no tag points to, up to ${megabytes(totalBytes(orphans))}`)
  }

  const bytes = await app.target.storageBytes()
  if (bytes !== null) detail(`storage    ${megabytes(bytes)} used in the registry, across every repository`)
  ok(`${tagged.length} image(s).`)
}

/** Removes images no retained tag can reach, then optionally frees their layers. */
export async function pruneImages(project: ProjectInfo, options: PruneOptions): Promise<void> {
  const app = await ownedApp(project)
  const repo = await repository(project)
  const live = await liveTag(app)
  const manifests = await app.target.images(repo)
  const plan = planPrune(manifests, live, options.keep)

  step('Plan')
  detail(`repository ${repo}`)
  detail(`keep       ${plan.keepTags.join(', ') || 'nothing tagged'}`)

  const nothingToRemove = plan.remove.length === 0
  if (nothingToRemove && !options.collect) {
    ok('Nothing to prune: every image is reachable from a tag being kept.')
    return
  }

  if (nothingToRemove) {
    detail('remove     nothing; every image is reachable from a tag being kept')
  } else {
    if (plan.removeTags.length > 0) detail(`remove     ${plan.removeTags.join(', ')}`)
    detail(`remove     ${plan.remove.length} image(s), up to ${megabytes(plan.reclaimableBytes)}`)
    detail(`deployed   ${live ?? 'unknown'}, never removed`)
    // Only when a tagged deployment is going. Removing orphans costs nothing
    // that could be rolled back to, and warning about it either way trains
    // people to ignore the warning that matters.
    if (plan.removeTags.length > 0) {
      warn(`Rolling back to ${plan.removeTags.join(', ')} will no longer be possible.`)
    } else {
      detail('no tagged deployment is affected; these images are already unreachable')
    }
  }

  // `--gc` has to work on its own. Deleting manifests frees nothing until
  // collection runs, so the command tells the user to come back with `--gc`, and
  // returning early here would make that instruction a dead end.
  if (options.collect) {
    warn('Garbage collection puts the registry into read-only mode while it runs, so a deploy during it will fail to push.')
  } else {
    detail('layers are not freed until garbage collection runs; add --gc to start it')
  }

  if (!options.confirmed) {
    ok('This was a plan only. Nothing was removed.')
    detail('Run the same command with --yes to execute it.')
    return
  }

  if (!nothingToRemove) {
    step('Removing images')
    for (const manifest of orderForDeletion(plan.remove)) {
      await app.target.removeImages(repo, [manifest.id])
      detail(`removed ${manifest.id.slice(7, 19)}  ${megabytes(manifest.sizeBytes)}`)
    }
    ok(`${plan.remove.length} image(s) removed.`)
  }

  if (!options.collect) {
    detail('Layers are still held until garbage collection runs. Start it with `nextship images prune --gc`.')
    return
  }

  step('Reclaiming storage')
  const outcome = await app.target.reclaim()
  if (outcome.kind === 'already-running') {
    detail(`collection is already running (${outcome.detail}), so another was not started`)
    return
  }
  if (outcome.kind === 'not-needed') {
    ok('Storage was already freed when the images were removed.')
    return
  }

  ok('Garbage collection started.')
  detail('It can take several minutes to begin, because the registry waits for existing')
  detail('write authorisations to expire first. Storage is reclaimed when it finishes.')
}
