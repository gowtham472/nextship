# nextship design spec v0.3

Companion to [`./private/vercel-nextjs-platform-research.md`](./private/vercel-nextjs-platform-research.md),
which is the source of every technical claim referenced here.

Every section is marked **Implemented** or **Designed**. Designed sections describe
intent and have no code behind them yet. Nothing in this document may describe
behaviour that does not exist, per [`../AGENTS.md`](../AGENTS.md) §2.

---

## 1. The promise

```bash
npx nextship deploy
```

One command. Any Next.js app. Deployed to the developer's own AWS or DigitalOcean
account. No Dockerfile, no `next.config.js` edits, no Terraform, no IAM archaeology.
Every Next.js feature works correctly, including ISR, PPR, Server Actions,
`revalidateTag`, `after()` and `next/image`.

## 2. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| **D1** | **BYO-cloud CLI first.** Runs on the developer's machine or CI, provisions into their cloud account with their credentials. We run zero infrastructure. | No ops burden, no uptime liability, no security surface, no cloud bill. Trust is easy: their code never leaves their account. |
| **D2** | **A hosted control plane comes after the CLI, never before.** Documented and designed for now, not built now. | See [`roadmap.md`](./roadmap.md) v4. The CLI becomes the control plane's build and deploy engine, so nothing is thrown away. |
| **D3** | **Container everywhere.** One Docker image, one Node server, deployed to a Lightsail container service or ECS on AWS, and App Platform or Droplets on DigitalOcean. (Originally App Runner, which AWS has since closed to new customers.) | DigitalOcean has no Lambda, so a serverless-first design cannot port there at all. And `next start` in a single process supports every Next.js feature correctly; serverless complexity exists only to buy scale to zero. |
| **D4** | **Correct-first fidelity for v1.** Single instance, Next.js's own cache, CDN for static assets only. | Ships quickly, is useful for most real apps, and every feature is correct rather than partly working. Scale-out is v2 and is additive. |

### 2.1 The consequence that shrinks the project

**v1 ships no custom router.**

The Next.js standalone server already implements the entire routing pipeline:
middleware matching, filesystem routing, dynamic segments, rewrites, ISR cache
lookup, the `rsc` and `_rsc` cache-key discipline, PPR shell and resume, and
`next/image`. Every one of those is a place competitors have historically broken
(research §2.7, §3).

The v1 request path is:

```
Client → CDN (static assets only) → Container → next server → everything else
```

We do not intercept, so we do not re-implement `Vary` handling and we need no cache
key scheme of our own. What the adapter earns instead is zero-config correctness
plus infrastructure inference. That is the product.

## 3. Non-goals for v1

Out of scope, revisited per the roadmap: multi-instance and horizontal autoscaling
with a shared cache, CDN-cached HTML or RSC payloads, global tag purge propagation,
PPR edge stitching (origin-only PPR is fully supported and correct), request
collapsing, our own edge router, scale to zero, and non-Next.js frameworks.

## 4. Pipeline (Implemented: stages 1 to 3)

```
nextship
  1 detect     project root, workspace root, installed Next.js version,
               package manager, build command, Node major, env files  Implemented
  2 build      docker build --target manifest: install, next build
               with the adapter, prune to /out, export manifest.json  Implemented
  3 package    docker build --target runtime, served from the cached
               builder stage                                          Implemented
  - run        starts the image locally to verify it                  Implemented
  4 provision  idempotent per-target driver                           Designed
  5 release    push image, new revision, health gate, flip alias      Designed
```

Each stage is a separate command, so a failure can be re-run in isolation without
repeating stages that already succeeded. Stages 2 and 3 are two targets of one
Dockerfile with identical inputs, so BuildKit serves the compile from cache and
`package` only does the runtime stage's work.

Run with no arguments, `nextship` draws the wordmark from `brand/nextship.png` in half
block characters and points to `detect` and `--help`. It needs standard output to be a
terminal at least 72 columns wide. "Next" is drawn in the terminal's own text colour so
it reads on any background; "Ship" and the dot of its i take the brand blue and yellow
in truecolor, 256 or 16 colours as the terminal supports, and no colour under
`NO_COLOR`. Anywhere else, including a pipe, it prints the usage, so a script sees the
same text it always has.

**Nothing is compiled on the developer's machine.** The build runs in Docker on the
platform the image runs on, which is what makes native binaries, lockfile
resolution and trace files correct by construction (§7).

## 5. The Ship Output format (Implemented)

```
.nextship/output/
└── manifest.json     exported from the build, versioned
```

The manifest is written by the adapter inside the builder stage and exported to
disk by building the `manifest` target, a scratch image holding only that file.

### 5.1 `manifest.json`

```jsonc
{
  "version": 1,
  "buildId": "Xk3f…",
  "deploymentId": "dpl-8fk2j…",
  "framework": { "name": "next", "version": "16.2.9" },
  "healthPath": "/"
}
```

Every field has a reader ([`../AGENTS.md`](../AGENTS.md) §3.1): `version` is
checked for compatibility and a mismatch is refused; `buildId` and
`framework.version` are reported by `nextship build`; `deploymentId` is compared
with the id the CLI passed in, and a difference means the adapter did not apply the
config it was given, which is reported as a defect rather than shipped; `healthPath`
becomes the path the platform's health check polls (§10.7).

`healthPath` is chosen from `.next/prerender-manifest.json` so the check is served
from disk rather than rendered every few seconds for the life of the app: `/` when it
is prerendered, because that is the path users take, otherwise the first prerendered
route in sorted order, so the same build always picks the same route. It is `null`
when nothing is prerendered, and `deploy` then falls back to `/` and says the probe
renders on every request. The CLI reads the field as optional, so a manifest from an
adapter that predates it still reads.

The manifest is versioned, so later versions add fields in the change that starts
reading them.

## 6. The adapter (Implemented)

Injected with zero user configuration through the `NEXT_ADAPTER_PATH` environment
variable, so the user never edits `next.config.js`. This is a documented Next.js
mechanism intended for deployment platforms.

### 6.1 `modifyConfig`

| Setting injected | Prevents |
|---|---|
| `deploymentId` (supplied by the CLI) | Version skew: missing chunks, unknown Server Action ids, broken prefetches. Note it overrides `generateBuildId`. |
| `X-Accel-Buffering: no` header rule | A buffering reverse proxy silently collapsing streaming, so Suspense and PPR arrive as one response at the end |

The Server Actions encryption key is owned by the CLI rather than the adapter, so
there is one source of truth for it (§8.2).

**The key is per project, and per machine unless you make it otherwise.** It is
stored in `.nextship/secrets.local.json`, which is deliberately not committed, so a
second machine or a CI runner generates a different one and every client on a build
made elsewhere loses Server Actions. The CLI says so when it generates a key, and
warns when `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` disagrees with the stored value. The
environment variable is the supported path for CI and takes precedence. Once a
deployment target exists, the provider's secret manager becomes the source of truth.

**Deliberately not injected:**

- `output: 'standalone'`, because it is incompatible with the Adapter API (§12).
- A custom `cacheHandler`. Next.js ships a correct filesystem cache handler, which is
  the right choice for a single instance. A shared cache handler is v2.

### 6.2 `onBuildComplete`

Writes `manifest.json` inside the builder stage. Nothing else: the runtime tree is
assembled by the prune step from Next.js's own trace files (§7), not by the adapter.

The adapter is a single ESM file with no imports beyond node builtins. The CLI copies
it into `.nextship/build/adapter.mjs` and points `NEXT_ADAPTER_PATH` at it inside the
container, so it is never a dependency of the user's project.

**Correctness gate (Designed).** The adapter must run against the official Next.js
adapter compatibility test suite in CI, the same suite Vercel's own adapter runs
against. It has not been run yet, so no support claims are made.

## 7. The runtime image (Implemented)

Generated in code, never hand-written by the user and never stored as a template
file, so there is one source of truth. One Dockerfile, three stages.

### 7.1 Builder stage

- **Copies manifests before sources.** The lockfile, every `package.json` (collected
  with `COPY --parents` so a workspace's nested manifests land in their own
  directories) and the package manager's own configuration, and nothing else. The
  application is copied only after the install. Measured on a real project: the
  install is 97 seconds and the compile is 6, so copying sources first made every
  one-character edit pay for the install again. Reordering took a source-change
  rebuild from 150 seconds to 56.
- **Installs every dependency**, devDependencies included, because the build needs
  them. A frozen install where a lockfile exists. The package manager's store is a
  BuildKit cache mount, so repeat builds only download what changed.
- **Keeps Next.js's own build cache** across builds as a second cache mount on
  `.next/cache`. It is a mount rather than a copied directory, so it never enters a
  layer, and the prune step runs in a later instruction where the mount is gone.
- **Runs the project's own build command** with the adapter injected through
  `NEXT_ADAPTER_PATH`. `next.config.js` is never touched.
- **Mounts secrets for the build step only.** The Server Actions encryption key is
  read from the CLI's environment and mounted at `/run/secrets`; each env file the
  project has (`.env.production.local`, `.env.local`, `.env.production`, `.env`, the
  order Next.js loads them in) is mounted at its own path. Neither enters an image
  layer. Next.js reads the env files from disk exactly as it would on the
  developer's machine, so `NEXT_PUBLIC_*` values are inlined the same way.
- **Excludes the rest of the context** through a generated
  `.nextship/Dockerfile.dockerignore`. BuildKit reads ignore rules from a file named
  after the Dockerfile, so the project's own `.dockerignore` is left untouched. The
  project's rules are merged in **first** and ours last, because Docker resolves
  conflicts by last match: ordered the other way, a project rule such as `!.env`
  would re-include files that are supposed to reach the build only as secret mounts.
- **Prunes to `/out`** with `prune.cjs`, shipped with the CLI and copied into the
  context. This is the piece that replaces standalone output, which the Adapter API
  cannot be combined with (§12). It copies:
  - `.next` minus build-only and development artefacts (`cache`, `diagnostics`,
    `trace`, `types`, every `*.nft.json`);
  - the files `.next/required-server-files.json` declares;
  - every file listed by the per-route traces `.next/server/**/*.nft.json`;
  - Next.js's own server trace `.next/next-server.js.nft.json` when it exists;
  - a trace of the launcher's entry points (`next`, `next/dist/server/lib/start-server`),
    made with the node-file-trace that Next.js bundles. This is always done: the
    Next.js server trace for a non-standalone build deliberately omits
    `next/dist/server/next.js` (its `TRACE_IGNORES`), and relying on it alone boots
    to `Cannot find module`. Verified on 16.2.9;
  - `public/` and the app's `package.json`;
  - the two files Next.js adds to standalone output by hand
    (`jest-worker/processChild` and `threadChild`). They are spawned as child
    processes by path, so no trace lists them, and Next.js appends them explicitly
    when `isStandalone` is set. Mirroring that is a few kilobytes.

  Symlinks are reproduced as symlinks and nothing more. A pnpm layout lists
  `node_modules/next` (a link into `.pnpm`) and, separately, every real file that is
  needed. Copying the link's target wholesale pulled the entire `next` package back
  in, measured at 170 MB, which is exactly the bloat the trace exists to avoid.

  It writes `server.cjs`, the same launcher Next.js generates for standalone output,
  with the resolved config inlined. That is what keeps `@next/swc` (125 MB) out of
  the runtime image: without it, a TypeScript config is compiled on every start.

### 7.2 Runtime stage

- `FROM node:<major>-slim`, where the major comes from detection (§8.1).
- **tini as PID 1**, so `SIGTERM` reaches node. **jemalloc preloaded**, the
  allocator Next.js documents for sharp on glibc, where the default one grows
  without bound under sustained image optimization. It is always installed because
  it is 1 MB and image optimization is on by default.
- **npm and corepack removed**: nothing in the runtime uses them.
- **Ownership set by `COPY --chown`**, with the runtime user created first. A
  `chown -R` afterwards rewrites every file and adds a second full-size copy of the
  application, measured at 351 MB.
- `.next/cache` created writable, because Next.js writes ISR entries and optimized
  images there at runtime.
- A non-root user; `NODE_ENV=production`; telemetry off.
- **`HEALTHCHECK`**: a HEAD request to `/` every 30 s using node's own `fetch`, so no
  extra package is needed. Anything below 500 counts as healthy; a 404 at `/` is
  still a running server.
- `CMD ["node", "server.cjs"]`. No package manager, no shell, one process.

**Graceful shutdown, verified.** `docker stop` returns in about 2.5 s with exit code
143. That is Next.js's own path: `start-server.js` closes the HTTP server, closes the
Next.js server, flushes, then exits 143 on SIGTERM by design.

### 7.3 Workspaces

A package inside a monorepo is built from the **workspace root**, because that is
where the lockfile and sibling manifests live. The builder copies the whole source,
installs at the root, and builds in the app directory. Inside the image the app
keeps its position at `/src/<appDir>`, so traces that reach above it
(`../../node_modules/...`) resolve identically. Verified against a pnpm workspace,
including an import of a sibling package.

### 7.4 Image identity

The image tag is the deployment id, and it is a **content address**: two builds that
would produce different bytes must never share a tag, because a rollback to a tag has
to restore what that tag described.

- **Clean git tree:** `dpl-<commit>-<digest>`, where the digest covers the nextship
  version, the generated Dockerfile, the contents of the build helpers copied into
  the context (the adapter and the prune script), the Server Actions encryption key,
  and the name and contents of every env file. The helpers are hashed by content
  rather than covered by the version, because editing one without releasing would
  otherwise produce a different image under an unchanged tag. Reproducible, and an unchanged deploy is a no-op at
  push time.
- **Uncommitted changes, or no git:** a unique id per build, and the CLI says so. A
  working copy cannot be described without hashing all of it, and a unique id is
  always safe; only a reused one is dangerous.

The id is also passed as `ARG NEXTSHIP_DEPLOYMENT_ID`, declared after the dependency
install so a new id invalidates the application build without re-running the install.

**Why the digest exists.** An earlier version used the commit alone. Env files reach
the build as secret mounts, and BuildKit deliberately excludes secret contents from
its cache key, so changing a value invalidated nothing: the build was served from
cache and the resulting image, still containing the old value, was tagged identically
to the previous one. Reproduced, fixed, and covered by a test.

The id is also the `sh.nextship.deployment` image label.

### 7.5 Target platform

Every build passes `--platform linux/amd64`. Without it Docker builds for the machine
that ran the command, so an arm64 laptop produces an image that cannot run on the
amd64 hosts both AWS and DigitalOcean default to, and the failure surfaces at deploy
time rather than build time.

Verified on Apple Silicon: nextship 0.4.4, installed from npm on a MacBook Pro with an
M3 Max, built a Next.js app there and deployed it to App Platform, and its live URL
served.

### 7.6 What the CLI writes into your project

Everything goes in `.nextship/`, which carries its own `.gitignore` containing `*` so
nothing inside can be committed:

```
.nextship/
├── .gitignore               *
├── secrets.local.json       Server Actions encryption key
├── build/                   adapter.mjs, prune.cjs (copied into the image build)
├── Dockerfile               generated
├── Dockerfile.dockerignore  generated; the project's own rules merged in first
└── output/manifest.json     exported from the build
```

The user's own `.gitignore` and `.dockerignore` are never edited.

### 7.7 Running it locally

`nextship run` starts the image attached, publishing port 3000 and loading the
highest-precedence env file the project has. Ctrl+C stops and removes the container;
the CLI treats that exit as a normal stop, not a failure.

### 7.8 Measured on a real project

`company_portfolio`, Next.js 16.2.9, pnpm, 21 routes, `next/image` in 21 files:

| | Before | After |
|---|---|---|
| Image | 1.13 GB | 591 MB |
| `node_modules` in image | 469 MB | 58 MB |
| `@next/swc` in image | 125 MB | absent |
| Boot | 223 ms | "Ready in 0ms" (config inlined) |

Of the 591 MB, 332 MB is `node:24-slim` itself and 78 MB is the project's `public/`
media. The application code and dependencies are about 58 MB.

### 7.9 Base image, evaluated and kept (Implemented)

`node:24-slim` is 332 MB of the 591 MB image, so it looked like the largest remaining
saving. Both alternatives were measured rather than assumed, and neither is worth
taking.

| Base | Size | sharp resize, median of 15 |
|---|---|---|
| `node:24-slim` (glibc, current) | 332 MB | **37.1 ms** |
| `node:24-alpine` (musl) | 235 MB | 91.8 ms |
| `gcr.io/distroless/nodejs24-debian12` (glibc) | 203 MB | not benchmarked |

**Alpine is rejected on measurement.** Identical libvips 8.18.6, 2.5 times slower for
the same resize. Image optimization is the most expensive thing this server does, so
paying 2.5 times for it to save 97 MB is the wrong trade. The roadmap's estimate of
"150 to 200 MB" was also wrong: Alpine saves 97 MB, not 150.

**Distroless is rejected on judgement**, and that is worth naming as a different kind of
reason. It keeps glibc, so sharp would stay fast, and it saves 129 MB. But it has no
shell, and diagnosing this system has repeatedly meant opening one: confirming sharp was
present when `detect` claimed otherwise, reading how Next.js selects a runtime variant,
proving which manifest a tag resolves to. It would also mean copying tini and jemalloc
out of a builder stage by hand rather than installing them.

**The deciding argument is that base size mostly does not travel.** The base is a shared
layer, pulled once per node and cached. What moves on every deploy is the application
layers, which pruning already took from 469 MB to 58 MB. Optimising the part that is
cached, at the cost of speed or debuggability, optimises the wrong number.

**Trigger to revisit:** a target that does not cache layers between deploys, or a
platform billing on image size rather than transfer.

## 8. Zero-config: what is inferred and what is asked

### 8.1 Inferred (Implemented)

Project root (walking up to the first `package.json` that depends on Next.js), the
**installed** Next.js version read from `node_modules` rather than the declared
range, the package manager from lockfiles, the build command (preferring the
project's own `build` script so custom flags survive), the Node major from
`engines.node` then `.nvmrc` then the running Node, the installed sharp version, and
an image-safe project name.

Detection fails with a cause and a next action when Next.js is not installed, or
when the installed version predates 16.2, which is the release that made the
Deployment Adapter API stable.

### 8.2 Held per project (Implemented)

`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is read from the environment, or generated once
into `.nextship/secrets.local.json` and reused. Generating a new key per build would
break Server Actions for any client still running the previous build.

The deployment id is `dpl-<commit>-<digest>` for a clean tree, where the commit is 12
characters and the digest the first 8 of the build digest. With uncommitted changes
the digest is replaced by a random suffix, and outside git the id is
`dpl-local-<random>`. `NEXTSHIP_DEPLOYMENT_ID` in the environment overrides all three
(§7.4).

Build-time environment comes only from the project's env files, mounted as build
secrets. Variables set in the developer's shell are not forwarded, which matches how
hosted platforms behave and keeps builds reproducible.

### 8.3 Asked once, then persisted (Designed)

Cloud target, region, project name and optional custom domain, written to a
committed `nextship.json` that contains no secrets. Credentials come from the
ambient chain the developer already has, such as an AWS profile or
`DIGITALOCEAN_TOKEN`. We never ask for or store cloud keys.

## 9. Provisioning drivers (Designed)

One interface, two implementations, idempotent so every deploy converges rather than
creates.

```ts
interface Driver {
  detectCredentials(): Promise<Identity | null>
  plan(manifest, config): Promise<ChangeSet>       // shown before first apply
  provision(changeSet): Promise<Resources>          // idempotent, tagged, resumable
  pushImage(image): Promise<ImageRef>
  release(imageRef, env): Promise<Revision>         // new immutable revision
  healthGate(revision): Promise<boolean>
  promote(revision): Promise<void>
  rollback(toRevision): Promise<void>
  syncStatic(manifest, dir): Promise<void>
  destroy(): Promise<void>
  logs(opts): AsyncIterable<LogLine>
}
```

| Concern | AWS | DigitalOcean |
|---|---|---|
| Image registry | ECR | DOCR |
| Compute | Lightsail container service (default: load balanced TLS endpoint included, $7 to $10), ECS Express Mode via `--compute ecs` | App Platform (default), Droplet and Compose via `--compute droplet` |
| Static and CDN | S3 and CloudFront | Spaces and Spaces CDN |
| Secrets | Secrets Manager | App-level encrypted environment |
| TLS and DNS | ACM and Route 53 | DO certificates and DO DNS |
| Cron | EventBridge Scheduler to HTTPS | Scheduled job hitting the route |
| Logs | CloudWatch | App Platform logs |

**Open risk, half settled.** App Platform streams: the streaming conformance test (§11)
passed against a live app. Whether a Lightsail container service does is still
unverified. Streaming end to end is non-negotiable: without it, PPR and Suspense degrade
silently while appearing to work. The same test, pointed at a Lightsail endpoint,
decides the default AWS compute before a driver is written around the wrong assumption.

### 9.1 The driver interface (Implemented)

Commands talk to a `Target`, never to a cloud's client. `packages/cli/src/targets/target.ts`
defines it, `digitalocean-target.ts` implements it, and `owned-app.ts` is the single place
that chooses which driver a project gets.

**The interface is expressed as intent, not as any one platform's API.** Before it
existed, twenty-four DigitalOcean operations were reachable from commands, and several
were App Platform concepts rather than deployment concepts:

| App Platform | On AWS |
|---|---|
| Rollback pins the app, then commits or reverts | Redeploy a previous image tag |
| Update replaces the whole spec, so it must be merged first | Update takes the fields you pass |
| Reclaiming storage is a separate pass that makes the registry read-only | ECR frees space on delete |
| One registry per account | One repository per application |

An interface built from those would have been a DigitalOcean interface with a second
cloud forced through it. So the methods say what the command wants: `rollback(appId, to)`
rather than validate-pin-commit, and `reclaim()` returns `not-needed` for a platform that
has nothing to run.

Two consequences worth naming. Platform orchestration moved out of the commands and into
the driver, which is where it belongs and where a second driver can differ. And a few
decisions that only a driver can make are asked of it rather than assumed: `previewEnv`
reports how each value would be stored, because App Platform encrypts anything not
already public and cannot return it afterwards, and a command should be able to say that
in a plan without knowing the words `SECRET` or `GENERAL`.

**Proven only against one cloud so far.** Every command and every test passes through the
interface, and the live commands behave identically, but an interface with one
implementation is a hypothesis. The second driver is what tests it.

### 9.2 Testing against AWS (Designed; the emulator harness is Implemented)

No single tool covers the AWS driver, so it is tested in three layers, each answering
what the others cannot:

| Layer | Covers | Cannot answer |
|---|---|---|
| Unit tests with recorded API responses | Every Lightsail call the driver makes, its error paths, and image retention | Whether AWS actually behaves as recorded |
| Floci, a local AWS emulator (`conformance/aws/probe.sh`) | ECR repositories and pushes, ECS tasks run as real containers, CloudWatch Logs, STS | Lightsail container services, which it does not emulate; any real endpoint's behaviour |
| A real AWS account | Streaming through a Lightsail endpoint (§11), TLS, IAM permissions, the final live check | Nothing, but it costs money and needs the account holder's approval per run |

The probe builds the streaming fixture with nextship, pushes it to Floci's registry,
runs it as an ECS task, runs the streaming check against it and confirms its output
reaches CloudWatch Logs. Against Floci 2.0.1 it passes in about five minutes: first byte
192 ms against a 2141 ms total, five log events. Two gaps were found running it, and are
recorded in its header: ECR `ListImages` and `DescribeImages` fail, so image retention
stays with the unit tests, and the registry host Floci returns does not resolve on Docker
Desktop for Windows, so images are pushed through `localhost:5100`.

The probe is not in CI yet. Until a driver exists it exercises the emulator rather than
nextship, and a failure would say nothing about this code.

## 10. Deploy lifecycle

Immutable by construction, which is where rollback and skew protection come from.

### 10.1 The general shape (Designed)

1. Build, then hash the output into an image tag.
2. Static assets uploaded: hashed ones as `public, max-age=31536000, immutable`,
   files from `public/` re-uploaded and CDN-invalidated.
3. New service revision created; the old revision keeps running.
4. Health gate polls until green or timeout.
5. Traffic flipped to the new revision.
6. Previous revisions retained, so rollback is an alias flip with no rebuild.

### 10.2 Rollback on App Platform (Implemented)

App Platform imposes a three-step shape, and it is not optional: creating a
rollback **pins** the app, and a pinned app refuses every further deployment until
the rollback is committed or reverted. Leaving an app pinned is the one way this
command could cause lasting trouble, so the sequence is validate, roll back, then
commit the moment the deployment reports active, with a revert on every failure
path in between. A failed revert cannot throw, because it must not mask the error
that caused it, so it warns that the app is still pinned and says where to clear
it.

Nothing is built and nothing is pushed. The rollback re-releases an image that
already ran, so it cannot introduce a new fault, and the deployment it replaces
stays in the history rather than being removed.

**Rollback targets are `ACTIVE` or `SUPERSEDED`.** A deployment that once served
traffic reports `SUPERSEDED` after a newer one takes over, so accepting only
`ACTIVE` selects nothing but the deployment already live. Phases that never served
(`ERROR`, `CANCELED`, and anything still in progress) are excluded.

**Verified end to end** against the live app, twice: back to the initial build,
then forward again with `--to`. Each time the site served the expected deployment
id, the app was left unpinned, and all deployments remained in the history.

### 10.3 Runtime environment (Implemented)

A deployed container starts with an empty environment. Env files are mounted as
build secrets and never enter an image layer, which is what keeps them out of the
registry, and it also means nothing survives to runtime. Values Next.js inlines at
build time keep working, so the failure is quiet: the app boots, most pages render,
and only request-time reads are undefined.

`env push` writes them to the platform as `RUN_TIME` variables. It is a separate
command rather than part of `deploy` because a local `.env` usually holds development
values, and shipping those to production as a side effect of deploying looks like a
successful deploy. `deploy` warns in its plan instead.

**Files are read by `@next/env`, not by a parser of ours.** A hand-written one agreed
with Next.js on simple lines and disagreed on the ones that matter: it truncated a
multi-line private key to its header, mangled a quoted value followed by a comment
containing a quote, and never expanded `$VAR`. Each produced a value that deployed
cleanly and failed at request time. The loader runs as its own process with a minimal
environment, because expansion resolves against the environment it runs in and would
otherwise let `TOKEN=$DIGITALOCEAN_TOKEN` in a project file resolve to the live API
token and upload it.

**`NEXT_PUBLIC_*` are stored readable, everything else encrypted.** Public values are
compiled into the browser bundle, so encrypting them claims a protection that does not
exist and makes them permanently unreadable. A push never weakens an existing variable:
a stored secret is not downgraded, and a broader existing scope is kept.

**Updates preserve what nextship does not manage.** `PUT /apps/{id}` replaces the
whole spec, so a spec built from scratch drops everything it omits. The current spec
is read first and used as the base, with only nextship's own fields written over it.
Verified against the live app, which carries an `ingress` block nextship never
builds.

### 10.4 Custom domains (Implemented)

Attaching a domain is two halves, and nextship does only one of them. The app has to
accept the hostname, which is a spec change. DNS has to point at the app, which happens
wherever the domain's records live.

**nextship never edits DNS.** It needs a token scope beyond deploying, and a tool
holding it can break every service on a domain rather than only the app it was aimed
at. The deploy token is in fact refused by the DNS API, so the boundary is enforced
rather than merely intended. `zone` is never set in the spec, because that asks App
Platform to manage records it cannot see when the domain is hosted elsewhere.

TLS is the platform's: a certificate is issued and renewed once the record resolves.

Two behaviours are the platform's rather than ours, and both are reported rather than
hidden. The first custom domain becomes `PRIMARY` whatever the spec requests. And a
primary domain becomes the app's `live_url`, which is why `deploy` and `rollback`
report the platform hostname: it always answers, while a custom domain does not until
its record exists.

### 10.5 Image retention (Implemented)

Rollback re-releases an image that already ran, so images have to be kept, and keeping
every image forever fills a billed quota. Retention is the trade between those two.

Two measurements define the shape, and they pull in opposite directions.

**Deleting a tag reclaims nothing.** The manifest survives untagged and still references
its layers, so collection finds nothing unreferenced: freed 0 bytes, deleted 0 blobs.

**Deleting untagged manifests destroys running deployments.** A tag points to an OCI
index whose platform manifests the API also reports as untagged. The live tag here is a
3.9 KB index whose amd64 child is a 181.9 MiB manifest listed as untagged.

So retention is reachability. Retained tags are roots, everything they reference is
retained, and only manifests no retained tag can reach are deleted. They are deleted
parents first, because the registry refuses to remove a manifest that another manifest
still references.

The deployed image is never pruned, whatever the limit says. Losing it leaves an app
that keeps running and then cannot start once anything reschedules it.

Garbage collection is what reclaims storage, and it is never implicit: it puts the
registry into read-only mode while it runs, which fails any overlapping push, and
DigitalOcean waits for existing write authorisations to expire before starting, so it
can be several minutes before anything happens.

### 10.6 Destroy (Implemented)

The only command that removes infrastructure, so it does not inherit the safety the
others get for free. It takes two gates rather than one: the app name is a required
argument that must match what the project recorded, and `--yes` still has to follow.
The name is what makes it safe, because every other command acts on the current
directory and `--yes` alone in the wrong one would remove the wrong app.

It removes the app and, with `--images`, that project's images followed by garbage
collection. Collection is started here rather than suggested, because every other
command resolves the registry through the app and the app is gone by then, so telling
the user to run `images prune --gc` would be an instruction that cannot be followed.

Never removed: the container registry, which every project on the account shares, and
DNS records, which the domain's owner created. The generated hostname is not reissued,
so a custom domain pointing at it needs its record updated, which the plan warns about
by name.

### 10.7 Health checks (Implemented)

A health check polls for as long as the app exists, so the route it polls is a standing
cost. The build already knows which routes are prerendered, so the adapter reads the
prerender manifest and reports one: `/` when it is static, otherwise any prerendered
route, and nothing when the build prerenders none.

Serving a dedicated endpoint was considered and rejected. The launcher hands the HTTP
server to Next.js, so answering a path of our own means replacing `startServer` and
owning keep-alive, upgrades and error handling on the most critical path in the system.
That is a large risk to save one render every few seconds, and only for apps that
prerender nothing at all.

### 10.8 Runtime logs (Implemented)

Two shapes, because the platform offers two and they answer different questions. A
snapshot prints what is buffered and exits. `--follow` streams over the websocket the
same endpoint returns, and Ctrl+C closes the socket rather than killing the process, so
a stop is reported as a stop.

Registering a signal handler stops Node exiting on Ctrl+C by itself, so a close the
server never answers would hang the command with no way out. The close is raced against
a short timer that finishes anyway.

App Platform returns no log text. It returns short-lived proxy URLs that carry
their own access token, so those URLs are treated as secrets and never appear in a
log line or an error message. `historic_urls` holds archived chunks and is empty
unless log forwarding is configured; the live `url` is a websocket endpoint that
also answers a plain GET with everything currently buffered, and that is what makes
a one-shot `logs` command possible. Both are read, each under its own timeout, so
one unreachable chunk cannot discard the rest.

## 11. Conformance

**Unit tests (Implemented).** The `node:test` suite under `packages/cli/src`, run with
`pnpm test` and by CI on Linux and Windows: detection against on-disk fixtures (standalone, workspace, hoisted
dependencies, version gate, missing install, build command fallback, node major
resolution), Dockerfile and ignore file rendering for both layouts, build identity,
the `docker build` argument list, DigitalOcean registry region matching, rollback
target selection and deployment summarizing, and the prune script as a process
against a fixture shaped like a real `.next`, including symlink reproduction, the
no-server-trace path, and its failure modes. One skips where the OS does not permit
creating symlinks, which is the default on Windows without developer mode.

**Feature verification (Implemented).** Measured against a purpose-built Next.js
16.3.4 app, because the real production project uses none of these:

| Feature | Result |
|---|---|
| Streaming | TTFB 27 ms against a 2.02 s total; shell before the slow boundary, nothing buffered |
| ISR, time-based | Three consecutive requests in-window identical, `x-nextjs-cache: HIT`; regenerates past the window |
| ISR, on-demand | `revalidatePath` purges; the next request re-renders |
| Server Actions | Plain form POST executed three times and incremented state, which is the path that decrypts the action closure |
| `after()` | Callback ran after the response and wrote to disk |
| Skew protection | `dpl=` present on asset URLs |
| Graceful shutdown | `docker stop` returns in 2.5 s, exit 143 |

That app is 16.3.4, where Next.js writes no server trace at all while an adapter is
configured, so it also confirms the launcher-trace fallback (§7.1) in production.

**Compatibility suite (Run).** `conformance/` holds the three scripts the official
suite requires, and `.github/workflows/conformance.yml` clones Next.js, builds it and
runs the suite in thirty-two groups. The scripts follow the documented contract:
exactly the deployment URL on stdout, the required markers persisted for the separate
logs process, and cleanup of the container and image after each test. 1051 of 1115
suites pass (94.3%), reproduced exactly across two runs, with every failure attributed
in the README's support matrix.

**Streaming conformance (Implemented).** `conformance/streaming/`
holds a fixture whose `/stream` page renders its shell at once and its tail two seconds
later behind a Suspense boundary, and `measure.mjs`, which fails unless the first byte
arrives well before the last and the shell arrives before the tail. `run.sh` builds the
fixture with nextship, runs the image and measures it, and CI runs that on every push
and pull request. The script was shown to fail against a server that buffers, one that
never answers and one that drops the connection part way. It takes any URL, which is
how a deployed target is checked. App Platform was measured live on 2026-09-11: three
runs of three passed, first byte 230 to 448 ms against a 2.2 to 2.4 s total, the shell
before the tail, sent chunked through DigitalOcean's Cloudflare edge with the cache
bypassed. Each new target is measured the same way before its driver is trusted, which
decides the default compute per cloud (§9).

**Per-target end-to-end acceptance (Designed, not a v1.0 gate)** on real clouds per
pull request: static page, SSR page, ISR page (time-based and `revalidateTag`), PPR
route, Server Action, `next/image`, middleware redirect, cron fire, rolling deploy with
no 5xx, and rollback, plus the correctness checklist from research §6.6 encoded as
assertions. Live verification is done by hand today; automating it needs cloud
credentials in CI.

## 12. Known limitations

| Limitation | Consequence | Status |
|---|---|---|
| **`output: 'standalone'` is incompatible with the Adapter API.** Verified against Next.js 16.3.4: setting it while any adapter is configured fails the build with `ENOENT` on `.next/next-server.js.nft.json`. Reproduces with a no-op adapter. | The CLI assembles the equivalent tree itself from the same trace files (§7.1). | Open upstream. Worth reporting to Next.js. |
| **Only production runtimes ship.** Development runtime variants and dependency source maps are never copied, because `NODE_ENV=production` makes the development ones unreachable. | Setting `NODE_ENV=development` on a deployed app would stop it starting. `env push` warns about exactly that. | Deliberate: it removed 53 MB |
| **The base image is 332 MB.** `node:24-slim`, kept deliberately after measuring the alternatives (§7.9). | Over half the image is the base, but it is a shared layer pulled once per node rather than per deploy. | Revisit if the base ever has to travel per deploy |
| **`public/` ships inside the image.** 78 MB on the real project. | Media is served by the container rather than a CDN. | v0.4 |
| **The ISR cache does not survive a restart.** `.next/cache` lives inside the container, so every restart, redeploy and rescheduling starts cold. Optimized images share the same directory and are re-generated too. Single-instance ISR is correct per process, which is not the same as durable. | The first request to each cached route after any restart renders instead of reading cache. On an image-heavy site the cold-start cost is dominated by re-optimizing images. | **Decided: accepted for v1.** Verify whether App Platform offers a persistent volume for a service before v0.3; if not, this is inherent until the v2 shared cache handler |
| **Dependencies referenced by `file:` paths outside the build context fail.** The context is the project or workspace root, and nothing outside it exists in the builder. | The install step fails. | Accepted |
| **A fully dynamic app is probed on a rendered route.** The health path is chosen from the build's prerendered routes; when a build prerenders nothing, `/` is the only option. | A render every few seconds, forever, for apps with no static route at all. | Inherent without owning the HTTP server, which is a far larger cost than the one it would save |
| **Retention is manual.** `images prune` exists but nothing runs it, so storage still grows until someone does. | An unattended project fills its quota eventually. | Pruning on deploy needs care: garbage collection makes the registry read-only, so it cannot run in the same command that pushes |
| **No build-time cache seeding.** Writing seeded entries requires knowing the internal cache key format, which has not been verified. | The first request to an ISR route after a deploy renders rather than reading cache. | v2 |
| **Windows `pathname` values contain backslashes** in `outputs.staticFiles[].pathname`. | Not consumed today. Separators must be normalised before these become CDN keys. | v0.4 |
| **A pushed `NEXT_PUBLIC_*` value does not reach the browser until the next deploy.** Next.js inlines it at build time, so changing it at runtime cannot affect the bundle already built. | The plan says so, but the value visible to a browser and the value in the app spec can disagree until a rebuild. | Inherent to build-time inlining |
| **A push cannot tell whether a value actually changed.** App Platform never returns a stored secret, so nextship compares keys, not values. | Every `env push --yes` starts a deployment, even when nothing differs. When no key is being added, the plan says so before you confirm. | Inherent to the platform |
| **`env pull` cannot return secret values.** They are encrypted and never returned. | Reading production values back is possible only for `NEXT_PUBLIC_*`. A pull that returned keys and blanks is the most that can be honest. | Not built; recorded so it is not promised |
| **`nextship logs` is a snapshot of the running container, not history.** App Platform buffers only the current container's output, so a replaced deployment takes its logs with it and there is nothing to fetch after a rollback or a restart. | Logs from the deployment you are investigating may already be gone. Log forwarding to an external sink is the only way to retain them. | v0.4: wire up forwarding, and `--follow` over the websocket the same endpoint returns |
| **First build pulls `docker/dockerfile:1`.** The `# syntax` line fetches BuildKit's frontend image once. | Needs network on the first build. | Accepted |

## 13. Risks

| Risk | Mitigation |
|---|---|
| Managed container platforms buffering responses | §11 test 2 decides the default; fall back to ECS or Droplet where it fails |
| Next.js majors changing the adapter contract | The contract is versioned, breaking changes require a Next.js major, and adapter authors get release-candidate lead time through the Ecosystem Working Group |
| Always-on cost against Vercel's scale to zero | Honest positioning: this is a server, priced like a server. Opt-in scale-to-zero targets can come later. |
| Cloud API drift and partial provisioning failures | Idempotent converge, resumable state in `nextship.json`, and a plan shown before the first apply |
| Name collision | Validate `nextship` on npm and GitHub before any public commit |

## 14. Positioning

**v1.0 is a personal tool, not a product.** The user is its author, the app is his
own, and success is that he deploys with it instead of reaching for something else.
No adoption is required from anyone, so no market position needs defending.

That is a deliberate narrowing, made after two pieces of research:

- Competitive validation, kept internal, found that
  "zero-config deployment to your own cloud" is already served by Flightcontrol,
  Amplify, Coolify, Dokploy and DigitalOcean App Platform. As a product, the v1
  feature set has no reason to be chosen over any of them.
- [`costs.md`](./costs.md) found that self-hosting saves meaningful
  money only above roughly 1 TB of monthly egress, and that below that line Vercel
  Pro at $20 is hard to beat.

Neither finding matters for a single user with a single app, which is precisely why
v1 can stay small. Both matter enormously if this is ever offered to other people,
which is why the honest pitch for that future version is different and is recorded
here rather than lost:

> Next.js that stays correct when you scale it, on infrastructure you own,
> with published test results to prove it.

That claim depends entirely on the v2 correctness work (shared cache, distributed tag
coordination, atomic HTML and RSC invalidation), because that is the one part of this
problem no existing tool solves. Convenience is not a wedge. Correctness is.
