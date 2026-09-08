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
 * Design: ../../../../docs/00-design.md §9
 * Roadmap: ../../../../docs/01-roadmap.md v0.5
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
  region: string
  repository: string
  tag: string
  port: number
  instanceSize: string
  /** A prerendered route the health check can poll without rendering. */
  healthPath?: string | null
}

/** Progress reporting, so a driver can narrate a wait without importing the logger. */
export type PhaseReporter = (phase: string) => void

/** The result of asking a driver to reclaim storage, since not every platform needs to. */
export type ReclaimOutcome =
  | { kind: 'started' }
  | { kind: 'already-running'; detail: string }
  /** ECR frees space on delete, so there is nothing to run and nothing to warn about. */
  | { kind: 'not-needed' }

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

  // ------------------------------------------------------------- ownership

  /** Every app on the account, used to refuse name clashes and to count what is untouched. */
  listApps(): Promise<AppRef[]>

  /** Fails rather than returning empty when the recorded app is gone. */
  requireApp(appId: string): Promise<AppRef>

  // ----------------------------------------------------------- image store

  /**
   * Makes sure there is somewhere to push images, creating it if there is not.
   *
   * Deliberately allowed to be billable, which is why it reports whether it
   * created anything: the caller shows that in a plan before it happens. The
   * shape differs per cloud (DigitalOcean has one registry per account, ECR has
   * a repository per application) and the caller does not need to know which.
   */
  prepareImageStore(
    name: string,
    region: string,
    options: { dryRun: boolean }
  ): Promise<{ store: string; willCreate: boolean }>

  /** Pushes a local image, returning the reference the platform will pull. */
  pushImage(options: { localTag: string; repository: string; tag: string; cwd: string }): Promise<string>

  // --------------------------------------------------------------- release

  /**
   * Creates or updates the app so it runs `request.tag`, returning the
   * deployment to follow.
   *
   * Whether that means merging a whole spec or patching fields is the driver's
   * problem. `appId` is null for an app that does not exist yet.
   */
  release(appId: string | null, request: ReleaseRequest): Promise<{ appId: string; deploymentId: string | null }>

  /** Waits for a deployment to finish, reporting each phase change as it goes. */
  awaitRelease(appId: string, deploymentId: string, onPhase: PhaseReporter): Promise<void>

  /** Where the app can be reached, or null if it no longer exists. */
  address(appId: string): Promise<AppAddress | null>

  /** Names the parts of an existing app this driver will preserve rather than overwrite. */
  preservedSettings(appId: string): Promise<string[]>

  // -------------------------------------------------------------- rollback

  /** Past deployments, newest first. */
  deployments(appId: string): Promise<DeploymentRecord[]>

  /**
   * Returns the app to a previous deployment.
   *
   * The driver owns how: App Platform validates, pins, then commits or reverts,
   * and a failure anywhere in that sequence must clear the pin or the app
   * refuses every later deployment. AWS redeploys a previous image tag. A
   * command should not have to know which of those it is talking to.
   */
  rollback(appId: string, deploymentId: string, onPhase: PhaseReporter): Promise<void>

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

  // ---------------------------------------------------------------- images

  /** Images in this project's repository, newest first. */
  images(repository: string): Promise<ImageRecord[]>

  /** Removes images by id. The caller has already worked out which are unreachable. */
  removeImages(repository: string, ids: string[]): Promise<void>

  /** Frees the storage removed images were holding, where the platform needs asking. */
  reclaim(): Promise<ReclaimOutcome>

  /** Storage the registry is billed for, or null when the platform does not report it. */
  storageBytes(): Promise<number | null>

  // ------------------------------------------------------------------ logs

  /** What the running container has buffered. */
  readLogs(appId: string): Promise<string>

  /** A URL that streams new output. It carries a token, so it is a secret. */
  logStreamUrl(appId: string): Promise<string | null>

  // --------------------------------------------------------------- destroy

  /** Removes the app and everything the platform runs for it. */
  destroyApp(appId: string): Promise<void>
}
