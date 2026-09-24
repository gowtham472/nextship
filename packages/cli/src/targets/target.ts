/**
 * @nextship/cli: the deployment target interface
 *
 * One interface per cloud, expressed as what a command needs rather than as what
 * any one platform offers.
 *
 * That distinction is the whole point. Before this existed, every command called
 * the DigitalOcean client directly, and twenty-four of its operations were
 * reachable from commands. Several were App Platform concepts rather than
 * deployment concepts: rollback pins an app and then commits or reverts,
 * updating replaces the entire spec so it has to be merged first, and reclaiming
 * registry storage is a separate collection pass that makes the whole registry
 * read-only. None of those exist on AWS, where a rollback is redeploying a
 * previous image tag and deleting an image reclaims immediately.
 *
 * An interface built from those twenty-four operations would have been a
 * DigitalOcean interface with a second cloud forced through it, which proves
 * nothing about portability. So the methods here say what the command wants:
 * "go back to this deployment", not "pin, then commit". Each driver owns the
 * orchestration its platform requires, and that orchestration lives with the
 * driver rather than in the command.
 *
 * Author: Gowtham
 * Design: ../../../../docs/design.md §9
 * Roadmap: ../../../../docs/roadmap.md v1.1
 */

/** An app as the target knows it, with only what commands compare against. */
export interface AppRef {
  id: string
  name: string
}

/**
 * A past deployment.
 *
 * `served` rather than a phase string: what a command needs to know is whether
 * this is a safe thing to go back to, and every platform spells that
 * differently. App Platform reports `ACTIVE` for the live one and `SUPERSEDED`
 * for its predecessors, which is the distinction that made rollback report
 * nothing to roll back to when it filtered on `ACTIVE` alone.
 */
export interface DeploymentRecord {
  id: string
  /** True if this deployment ever took traffic, so it is a valid rollback target. */
  served: boolean
  /** True if it is the one serving now. */
  live: boolean
  /** Why it happened, shown in plans so a human can recognise it. */
  cause: string
  createdAt: string
  /** The image it runs, which is the nextship deployment id. */
  imageTag: string | null
}

/** How far along a domain is, normalised because every platform names these differently. */
export type DomainState = 'live' | 'pending' | 'failed' | 'unknown'

export interface DomainRecord {
  domain: string
  /** The primary domain becomes the app's reported address. */
  primary: boolean
  state: DomainState
  /** What the platform said, for the cases the normalised state cannot express. */
  detail: string
}

/**
 * Where an app can be reached.
 *
 * `platformHost` is kept separate from custom domains because it is the one that
 * always resolves. A custom domain answers nothing until its DNS record exists,
 * so a command that reports only the app's headline address can announce a dead
 * link after a successful deploy.
 */
export interface AppAddress {
  platformHost: string | null
  /** The address to open, with its scheme: App Platform serves HTTPS, a server's default app plain HTTP. */
  platformUrl: string | null
  domains: DomainRecord[]
}

/** A variable set on the app. Values are never returned: platforms encrypt them. */
export interface EnvRecord {
  key: string
  secret: boolean
  /** Which part of the app holds it, so a listing can say where it came from. */
  location: string
}

/**
 * An image in the target's registry.
 *
 * `children` exists because a tag points to an index whose platform manifests
 * are reported as untagged. Retention has to delete by reachability from the
 * tags being kept, or it either reclaims nothing or deletes the running image.
 */
export interface ImageRecord {
  id: string
  tags: string[]
  children: string[]
  sizeBytes: number
  updatedAt: string
}

/** What a release asks for. Platform sizing is a slug the driver interprets. */
export interface ReleaseRequest {
  name: string
  repository: string
  tag: string
  port: number
  /** A sizing slug the driver interprets, or null for the target's default. */
  instanceSize: string | null
  /** A container memory limit such as `512m`, or null for the target's default. */
  memory: string | null
  /** A prerendered route the health check can poll without rendering. */
  healthPath?: string | null
}

/** Progress reporting, so a driver can narrate a wait without importing the logger. */
export type PhaseReporter = (phase: string) => void

/**
 * The result of asking a driver to reclaim storage, since not every platform
 * needs to. Each outcome carries the driver's own words for it.
 */
export type ReclaimOutcome =
  /** `detail` explains what happens next, since a started collection has not freed anything yet. */
  | { kind: 'started'; detail: string[] }
  | { kind: 'already-running'; detail: string }
  /** Removing the images already freed their space; `detail` says what, if anything, was also tidied. */
  | { kind: 'not-needed'; detail: string }

/** What reclaiming storage means on a target, printed by `images prune` and `destroy`. */
export interface StorageWording {
  /** Warned in a plan that reclaims, or null when reclaiming affects nothing else. */
  reclaimWarning: string | null
  /** Printed when images are removed without reclaiming, or null when removal alone frees the space. */
  heldUntilReclaimed: string | null
  /** What `storageBytes` measures, after the figure: "used in the registry, across every repository". */
  usage: string
}

/** How `env push` describes where values end up. */
export interface EnvStorageWording {
  /** Per variable in the plan, by whether the target treats it as a secret. */
  secret: string
  plain: string
  /** Warned once per push. */
  notice: string
  /** How `nextship env` describes a stored variable, by whether it is secret. */
  listedSecret: string
  listedPlain: string
  /** Warned before `env rm`, about getting a removed value back. */
  removal: string
  /** Warned when a push names only keys already set, about whether anything differs. */
  unchanged: string
}

/** What `destroy` plans to remove and leave, in the target's terms. */
export interface DestroyPlan {
  /** Plan lines after the app line: addresses, domains, images, and what is kept. */
  lines: string[]
  /** Warnings after "This cannot be undone". */
  warnings: string[]
}

/** What a deploy plan needs a driver to describe. */
export interface DeployPlanContext {
  name: string
  /** The app being updated, or null when this deploy creates it. */
  appId: string | null
  /** A sizing slug the driver interprets, or null for the target's default. */
  instanceSize: string | null
  /** A container memory limit such as `512m`, or null for the target's default. */
  memory: string | null
  /** What `planDelivery` reported. */
  delivery: string[]
}

/** A Docker daemon to build against. */
export interface ImageBuilder {
  /** A `DOCKER_HOST` value, or null for the local daemon. */
  dockerHost: string | null
  /**
   * Names the Next.js build cache when builds run on a shared daemon, so every
   * machine deploying the app reuses one cache there. Null keeps the local rule.
   */
  cacheScope: string | null
  /** Something the user must know about how this builder is reached, or null. */
  warning: string | null
  /**
   * Whether a build that just failed lost its connection to the daemon rather than
   * failing on its own merits, asked of the daemon itself. Absent where there is no
   * other daemon to ask, which is every local build: see `build-attempts.ts`.
   */
  lostConnection?(): Promise<boolean>
  close(): Promise<void>
}

/** The DNS record an owner has to create for a custom domain. */
export interface DnsInstruction {
  type: string
  name: string
  value: string
  /** Anything the owner needs to know that the three fields above cannot say. */
  notes: string[]
}

export interface Target {
  /** Matches `target` in nextship.json, so a project resolves to the right driver. */
  readonly id: string
  /** How the target is named in output. */
  readonly displayName: string
  /** Where the other apps a plan counts live, as in "3 other app(s) in this account". */
  readonly appScope: string

  // ------------------------------------------------------------- ownership

  /** Every app on the account, used to refuse name clashes and to count what is untouched. */
  listApps(): Promise<AppRef[]>

  /** Fails rather than returning empty when the recorded app is gone. */
  requireApp(appId: string): Promise<AppRef>

  // ------------------------------------------------------------------ plan

  /**
   * How a deploy plan describes this target: where the app runs, what it is
   * billed as, and what will be created. The lines sit between the plan heading
   * and the settings a deploy preserves, so each driver can say what its
   * platform charges for without the command knowing the words.
   */
  planLines(context: DeployPlanContext): Promise<string[]>

  /**
   * Where the values `env push` sets are stored, printed as a warning in its
   * plan. On App Platform they are encrypted in the account; on a server they
   * are a file the server's owner can read.
   */
  readonly envStorage: EnvStorageWording

  /** What a successful deploy removes, for the plan's last line, or null when it removes nothing. */
  readonly deployRemoves: string | null

  /**
   * What a successful rollback removes, for the same line in a rollback plan,
   * or null when it removes nothing.
   *
   * Separate from `deployRemoves` rather than reusing it. The two happen to
   * describe the same housekeeping on a server today, but they are different
   * sentences in different plans: a rollback reads as returning to something
   * that already ran, and "once this one is live" is deploy wording inside it.
   * A target whose rollback removes something else, or nothing, would otherwise
   * print a false line with no change here at all.
   */
  readonly rollbackRemoves: string | null

  // ----------------------------------------------------------------- build

  /**
   * The Server Actions encryption key a build must use, or null when the key is
   * the project's own local file (`build.ts`). A target that can hold the key
   * where every deploying machine reaches it returns that one, so a second
   * machine does not build with a different key.
   */
  actionsKey(localKey: string | null, onPhase: PhaseReporter): Promise<string | null>

  /** The `--platform` an image for this target has to be built for. */
  buildPlatform(): Promise<string>

  /**
   * The Docker daemon a build runs against. `dockerHost` is null for the local
   * daemon, and `close` releases whatever was opened to reach another one.
   */
  builder(): Promise<ImageBuilder>

  /**
   * How delivering an image will go, for the deploy plan. Nothing is created:
   * a registry the account does not have yet is reported here, because creating
   * one can be billable and the plan has to say so first.
   */
  planDelivery(name: string): Promise<string[]>

  /**
   * Puts a built image where the target will run it, returning the reference
   * the target pulls (null when it runs the image where it was built) and the
   * image store that was used, recorded in `nextship.json` so later commands
   * find the images, or null for a target with none.
   */
  deliverImage(options: {
    localTag: string
    name: string
    tag: string
    cwd: string
    onPhase: PhaseReporter
  }): Promise<{ reference: string | null; store: string | null }>

  // --------------------------------------------------------------- release

  /**
   * Creates or updates the app so it runs `request.tag`, returning the
   * deployment to follow.
   *
   * Whether that means merging a whole spec or patching fields is the driver's
   * problem. `appId` is null for an app that does not exist yet.
   *
   * A driver may hold a resource from here until `awaitRelease` or
   * `abandonRelease` ends the release. Every caller has to reach exactly one of
   * those two on every path out.
   */
  release(appId: string | null, request: ReleaseRequest): Promise<{ appId: string; deploymentId: string | null }>

  /**
   * Waits for a deployment to finish, reporting each phase change as it goes.
   *
   * `replacing` says whether a deployment of this app is serving now, so a failure can
   * say truthfully whether anything still is. An aborted `signal` stops the wait
   * and leaves the release undone: the deployment does not go live, and whatever
   * `release` held is given back before this returns.
   */
  awaitRelease(
    appId: string,
    deploymentId: string,
    onPhase: PhaseReporter,
    replacing: boolean,
    signal?: AbortSignal
  ): Promise<void>

  /**
   * Ends a release that will never be waited on, giving back anything `release`
   * held and removing what it started.
   *
   * Only for the paths where `awaitRelease` is not reached at all: a driver that
   * reported no deployment to follow, or a failure between the two calls. It
   * never throws, because it runs while another failure is already being
   * reported and replacing that error with this one would hide the real cause.
   */
  abandonRelease(appId: string, deploymentId: string | null): Promise<void>

  /**
   * Refuses when the app has a deployment the platform has not finished, since a
   * change written now would replace it part way through. Every command that
   * changes the app calls it except rollback: rollback is how you get away from a
   * bad deployment, so whether it is possible is left to the platform's own
   * rollback validation. Two changes written in the same instant can still both be
   * accepted, and the platform then keeps the later one.
   */
  assertIdle(appId: string): Promise<void>

  /** Where the app can be reached, or null if it no longer exists. */
  address(appId: string): Promise<AppAddress | null>

  /** Names the parts of an existing app this driver will preserve rather than overwrite. */
  preservedSettings(appId: string): Promise<string[]>

  // -------------------------------------------------------------- rollback

  /** Past deployments, newest first. */
  deployments(appId: string): Promise<DeploymentRecord[]>

  /** What a rollback plan must say about this target's rollback that the generic plan does not. */
  readonly rollbackNotes: string[]

  /**
   * Returns the app to a previous deployment.
   *
   * The driver owns how: App Platform validates, pins, then commits or reverts,
   * and a failure anywhere in that sequence must clear the pin or the app
   * refuses every later deployment. AWS redeploys a previous image tag. A
   * command should not have to know which of those it is talking to.
   *
   * A rollback waits for the same health check a deploy does, so it takes the
   * same `signal`: an aborted one stops the wait and gives back whatever the
   * driver took, rather than leaving it held by a process that is gone.
   */
  rollback(appId: string, deploymentId: string, onPhase: PhaseReporter, signal?: AbortSignal): Promise<void>

  // ------------------------------------------------------------------- env

  /** Every variable set on the app, wherever the platform keeps it. */
  env(appId: string): Promise<EnvRecord[]>

  /**
   * What `setEnv` would do, so a plan can describe it accurately.
   *
   * How a value is stored is the platform's decision: App Platform encrypts
   * anything that is not already public, and cannot return it afterwards. A
   * command should be able to say that in its plan without knowing the words
   * `SECRET` or `GENERAL`.
   */
  previewEnv(
    appId: string,
    values: Map<string, string>
  ): Promise<Array<{ key: string; action: 'add' | 'update'; secret: boolean }>>

  /** Adds or updates the given variables, leaving every other one alone. */
  setEnv(appId: string, values: Map<string, string>): Promise<void>

  /** Removes exactly the named variables. */
  unsetEnv(appId: string, keys: string[]): Promise<void>

  // --------------------------------------------------------------- domains

  /** Attaches a domain and returns the DNS record its owner has to create. */
  attachDomain(
    appId: string,
    domain: string,
    options: { primary: boolean; minimumTls: string }
  ): Promise<DnsInstruction>

  /** Detaches a domain. DNS records are the owner's and are never touched. */
  detachDomain(appId: string, domain: string): Promise<void>

  /** Hostnames the target manages itself, which cannot be attached as custom domains. */
  readonly platformSuffixes: string[]

  /**
   * The `platform` line `domain` prints when the app exists but `address`
   * reports no platform host.
   *
   * It is the driver's because the same fact means opposite things: on App
   * Platform an app without an ingress yet is one that has not deployed, and it
   * will get one, so the honest word is that nextship does not know it. On a
   * server only the default app answers on the server's address, so an app
   * without one really does answer on its custom domains alone.
   */
  readonly noPlatformHost: string

  /** Anything a `domain add` plan should warn about for this domain before it is attached. */
  domainWarnings(appId: string, domain: string): Promise<string[]>

  // ---------------------------------------------------------------- images

  /** Images in this project's repository, newest first. */
  images(repository: string): Promise<ImageRecord[]>

  /** Removes images by id. The caller has already worked out which are unreachable. */
  removeImages(repository: string, ids: string[]): Promise<void>

  /** Frees the storage removed images were holding, where the platform needs asking. */
  reclaim(): Promise<ReclaimOutcome>

  /** What reclaiming costs and what removing images alone leaves held, in the target's words. */
  readonly storage: StorageWording

  /** Storage the registry is billed for, or null when the platform does not report it. */
  storageBytes(): Promise<number | null>

  // ------------------------------------------------------------------ logs

  /** What the running container has buffered. */
  readLogs(appId: string): Promise<string>

  /** Printed when `readLogs` returns nothing, saying what that does and does not mean on this target. */
  readonly emptyLogs: string[]

  /**
   * The logs one deployment wrote, including a deployment that has been
   * replaced. Refused where the target keeps no history.
   */
  deploymentLogs(appId: string, deploymentId: string): Promise<string>

  /**
   * Streams new output to `write` until `signal` aborts or the target ends the
   * stream. Resolves with a note to print when the target ended it, so a stream
   * that expired is not mistaken for an app that went quiet, or null when it
   * stopped because `signal` aborted.
   *
   * `onReady` is called once the stream is actually established and never if
   * opening it fails, so the command does not announce that it is following
   * something and then report that there was nothing to follow.
   */
  followLogs(
    appId: string,
    write: (text: string) => void,
    signal: AbortSignal,
    onReady: () => void
  ): Promise<string | null>

  // --------------------------------------------------------------- destroy

  /** Removes the app and everything the platform runs for it. */
  destroyApp(appId: string): Promise<void>

  /** What destroying the app removes and keeps, for the plan. `imageCount` is how many images `--images` would remove. */
  destroyPlan(appId: string, options: { images: boolean; imageCount: number }): Promise<DestroyPlan>
}
