# nextship roadmap

Companion to [`design.md`](./design.md). Shipped version by version, each one
usable on its own.

**The goal of v1.0 is a tool Gowtham uses to deploy his own apps.** Not a product,
not a platform, and not something anyone else has to adopt. That target is what
decides what goes in and what waits. Everything that only matters once other people
depend on it is deferred to v2 and beyond, where it is recorded so the decision is
deliberate rather than forgotten.

Two research findings shape the ordering and are worth restating here, because they
explain why v2 exists at all:

- Self-hosting only saves meaningful money above roughly 1 TB of monthly egress
  ([`costs.md`](./costs.md)). Below that, Vercel Pro is genuinely
  hard to beat.
- That same traffic level is where one container stops being enough, and multiple
  instances is exactly where Next.js correctness breaks down
  (the internal competitive validation §4).

For a single-instance personal tool, neither of those bites. That is why v1 can be
small and still be correct.

---

## v0.1: local artifact (done)

Turn any Next.js project into a runnable container with no configuration.

| Deliverable | Status |
|---|---|
| `detect`: project root, installed Next.js version, adapter API version gate, package manager, build command, Node major, sharp version | Done |
| Adapter: deployment id, anti-buffering header, manifest | Done |
| `build`: adapter injected through `NEXT_ADAPTER_PATH`, stable Server Actions encryption key, manifest version check | Done |
| `package`: generated Dockerfile, deployment id as image tag and label | Done |

## v0.2: run and verify

Prove the artifact actually works before trusting it with anything real. No cloud
account needed, so nothing here is blocked on a target decision.

| Deliverable | Status |
|---|---|
| `run`: start the packaged image locally with the manifest's port and the project's env file | Done |
| Compile and typecheck the workspace | Done, both packages clean under `noUnusedLocals` |
| Verified end to end against a real Next.js 16.3.4 app and a real production project (Next.js 16.2.9, pnpm, 21 routes, heavy `next/image`) | Done |
| Dropped `output: 'standalone'`, which is incompatible with the Adapter API | Done |
| **Build inside Docker.** BuildKit secret mounts for the encryption key and env files, package-manager cache mounts, the adapter copied into the context. Nothing compiles on the host | Done |
| **Trace-based pruning.** Route traces, Next.js's server trace, and a trace of the launcher entries, copied with symlinks preserved. `node_modules` 469 MB to 111 MB, `@next/swc` gone, image 1.13 GB to 660 MB | Done |
| Ship the adapter with the CLI instead of requiring it in the user's project | Done |
| Monorepo support: build from the workspace root, resolve hoisted dependencies, keep sibling package symlinks working. Verified against a pnpm workspace | Done |
| `HEALTHCHECK` in the image; graceful `SIGTERM` verified as Next.js's own shutdown path (exit 143 in 2.5 s) | Done |
| Production error handling: daemon check, Docker version gate, corrupted secrets file refuses to rotate the key, Ctrl+C on `run` is a normal stop, missing binaries name themselves, no `shell: true` (the deprecation warning is gone) | Done |
| `.nextship/` ignores itself in git, so the encryption key cannot be committed | Done |
| 42 unit tests with `node:test`, run by `pnpm test` | Done |
| `--version` | Done |
| Streaming check: a slow Suspense route, confirming the first byte arrives well before the last | Done, TTFB 27 ms against a 2.02 s total |
| ISR, on-demand revalidation, Server Actions and `after()` checked against a purpose-built app | Done |

### Defects found by review and fixed

An adversarial pass over the documents reproduced three defects, all now fixed and covered by tests: an environment variable
change shipped the old value under the same image tag, no target architecture was
pinned, and a one-character source change cost a 150 second rebuild because the
dependency install ran after the source copy. The deployment id is now a content
address, `--platform linux/amd64` is always passed, and manifests are copied before
sources. A project `.dockerignore` can no longer undo nextship's exclusions.

### Added after the review

`nextship doctor` reports what changes when an app leaves Vercel, which was the gap
no document covered. The compatibility harness is wired up in `conformance/` but has
not been run. Prune now also copies the two files Next.js adds to standalone output
by hand, which no trace can discover.

### What is verified, and what is not

Verified on a real production project and on a purpose-built feature app: detection,
build, packaging, pruning, boot, every route, image optimization, streaming, ISR
(time-based and on-demand), Server Actions, `after()`, skew protection, health check,
graceful shutdown, monorepo layout, and both npm and pnpm.

Not verified: the official Next.js adapter compatibility suite, PPR, Cache Components
(`use cache`), middleware, and anything involving more than one instance. No support
is claimed for those.

## v0.3: first deployment (Complete, 2026-09-08)

One cloud target, end to end, immutable by construction.

**Target: DigitalOcean.** Chosen, and it is also the stronger economic story by a
wide margin: egress at $0.02 per GiB against CloudFront's $0.085 and Vercel's $0.15
and up, and App Platform needs no load balancer, which was the line item that made
the AWS path cost more than Vercel at small scale
([`costs.md`](./costs.md)).

| Deliverable | Status |
|---|---|
| `deploy`: push image to DOCR, create a new App Platform revision, health gate, flip traffic | Done, verified live |
| `rollback`: previous revision, no rebuild | Done, verified live in both directions |
| `logs`: read the running service's output | Done. A snapshot, not a stream; `--follow` is v0.4 |
| `nextship.json`: target, region, project name, provisioned resource ids, no secrets | Done |
| Idempotent provisioning, so every deploy converges rather than creates | Done. The second deploy updated the app rather than creating one |
| Image retention | **Moved to v0.4.** See below |
| A dedicated health endpoint | **Moved to v0.4.** See below |

**Two deliverables were deliberately not built.** Both turned out to conflict with a
guarantee the rest of v0.3 rests on, so shipping them quickly would have cost more
than it returned:

- **Image retention.** Pruning old registry tags means deleting, and every other
  command in nextship is safe precisely because no delete call exists anywhere in it.
  Introducing one belongs in v0.4 alongside `destroy`, where deletion is designed in
  deliberately and asked for explicitly, rather than smuggled into a deploy. Measured
  cost of waiting: three deploys used 286 MiB of the 5 GiB Basic tier, about 95 MiB of
  new layers each, so roughly fifty deploys of headroom.
- **A dedicated health endpoint.** Serving one means the launcher answering a request
  before Next.js sees it, which is the first crack in "v1 ships no custom router".
  The current `HEALTHCHECK` probes `/` and works: the container reported `healthy`
  during verification. It costs one render per 30 s on a dynamic home page, which is
  a real cost and a smaller one than a router.

Everything else was verified against a live DigitalOcean app rather than a fixture,
including two rollbacks in opposite directions.

## v0.4: day-two operations (Complete, 2026-09-08)

The things that turn a deploy script into something worth relying on.

| Deliverable |
|---|
| **Done, verified live.** Custom domain and automatic TLS: `domain`, `domain add`, `domain rm`. nextship attaches the domain and prints the DNS record; it never edits DNS itself |
| **Done, verified live.** `env`, `env push` and `env rm`: runtime environment variables, uploaded explicitly rather than as a side effect of deploying, read through Next.js's own loader so they match the build |
| **Done.** Preserve app settings nextship does not manage across an update, so a deploy cannot drop a domain, an alert or a hand-added component |
| **Done, verified live.** Registry image retention: `images` and `images prune`. Deletes by reachability from retained tags, parents before children; the deployed image is never pruned; garbage collection is explicit because it makes the registry read-only. Freed 104 MiB on the real registry |
| **Done.** The health check path is chosen from the build's prerendered routes rather than always `/`, so a probe serves a file instead of rendering. A dedicated endpoint was rejected: it would mean owning the HTTP server to save one render every few seconds |
| **Done, verified live.** `logs --follow`, over the websocket App Platform returns. Forwarding is **not** built: it needs an external destination and credentials the user must choose, so there is nothing to verify against |
| **Done, verified live.** `destroy`: removes the app and optionally its images, never the registry or DNS. The app name is a required argument, so `--yes` in the wrong directory cannot destroy the wrong app. Verified against a disposable app rather than a real one |
| **Done.** Exclude dependency source maps and development runtimes at copy time, not only while tracing. Saved 69 MB: image 660 MB to 591 MB. The over-inclusion was larger than the 25 MB estimated, and had a different cause |
| **Done, concluded no.** Alpine is 2.5x slower at image optimization on identical libvips and saves 97 MB, not the 150 to 200 estimated. Distroless keeps glibc and saves 129 MB but removes the shell this project has repeatedly needed to diagnose real problems. Base layers are cached per node anyway, so this optimises a number that does not travel. See `design.md` §7.9 |

## v1.0: trustworthy for personal use, DigitalOcean only (Complete, 2026-09-11)

The bar is honest reliability, not features. **Scope is DigitalOcean alone**: it is the
target that is built, verified live, and actually used. AWS is v1.1.

| Deliverable | State |
|---|---|
| A license, so the code may legally be used | **Done.** Apache-2.0, copyright Gowtham and Ragul D |
| Adapter compatibility suite **run**, results published as a support matrix | **Done.** 1051 of 1115 suites pass (94.3%), reproduced exactly across two runs, every failure attributed in the README's support matrix |
| The harness scripts proven to work before spending CI hours on them | **Done.** Run against a real app: `e2e-deploy.sh` exits 0 with exactly one URL on stdout that serves 200, `e2e-logs.sh` emits all five markers the harness reads, `e2e-cleanup.sh` removes the container and image |
| Streaming conformance as a repeatable test rather than a one-off measurement | **Done.** `conformance/streaming/` builds a fixture with nextship, runs it and fails unless the shell arrives before the tail; CI runs it on every change, first byte 96 ms against a 2063 ms total. Pointed at a live App Platform app it passed three runs of three, first byte 230 to 448 ms against 2.2 to 2.4 s, sent chunked through DigitalOcean's Cloudflare edge with the cache bypassed. The app and its images were removed afterwards |
| Documented limitations, with nothing claimed that has not been observed working | **Done.** The README states what is not supported and why, and refuses to claim PPR, middleware or Cache Components |
| An install path that needs no prior knowledge | **Done.** `npm install -g nextship-cli`, published with provenance, each release staged and approved with 2FA. Installed that way on a MacBook Pro with an M3 Max, 0.4.4 deployed a Next.js app to App Platform and its live URL served, the first run on Apple Silicon and on macOS |

**Explicitly not in v1.0:** AWS, a second compute option, CDN assets, and anything from
"Beyond v1.0". Shipping one target honestly beats shipping two badly.

## v1.1: AWS (Planned, deferred past v1.0)

The second target. This is where the design's portability claim is either proven or
shown to be more expensive than it looked.

**Deferred past v1.0 deliberately.** v1.0 is defined as trustworthy for personal use, and
the person using it deploys to DigitalOcean. Holding a release for a second cloud nobody
is asking for yet would delay the evidence that actually matters, which is the
compatibility suite. AWS arrives when there is a user who needs it, informed by whatever
the first release teaches.

### The target changed before a line was written

The design named **App Runner**. AWS has since **closed App Runner to new customers**
and says it will add no further features. No new user of nextship could have used it.

That forced a real choice rather than a substitution, because AWS has several ways to
run a container and they are not close in price or shape.

### Choosing the compute, and why cost is not the deciding factor

| Option | Price per month | Load balancer | TLS and custom domain | Verdict |
|---|---|---|---|---|
| Lambda + Function URL | ~$0 to $2 | n/a | included | **Rejected.** See "Deliberately not built" |
| App Runner | ~$8 | included | included | Closed to new customers |
| **Lightsail container service** | **$7 nano, $10 micro, $15 small** | **built in, not billed separately** | included, free, auto HTTP to HTTPS redirect | **Default** |
| ECS Express Mode (Fargate + ALB) | ~$35 | ~$16 to $18, unavoidable | ACM, manual listener wiring | `--compute ecs`, for VPC and scale |
| EC2 or a Lightsail instance | $5 to $10 | you build it | you build it | Not worth the operational surface |

Lambda is rejected on correctness, not price: it would be the cheapest by a wide margin.
The reason is in `design.md` §2.1 and is recorded under "Deliberately not built".

**Lightsail is the default because it is the only AWS option that is both cheap and the
right shape.** Verified against the Lightsail container services FAQ: the service
provides a load balanced TLS endpoint with no separately billed load balancer, HTTP
redirects to HTTPS automatically, custom domains take a domain-validated
certificate created in Lightsail, deployment history is retained and a previous
deployment version can be redeployed, and 500 GB of transfer is included per service. Billing is hourly and
prorated, so a deleted service stops costing immediately.

That maps onto `Target` almost one to one, including the part expected to be hardest.
Rollback really is "deploy a previous version": `GetContainerServiceDeployments` returns
every retained version with its full `containers` and `publicEndpoint` spec, and
`CreateContainerServiceDeployment` accepts that same shape back. Read version N, resubmit
it. AWS documents the workflow only as a console procedure, which is a documentation gap
rather than a capability gap, and it is exactly what `rollback(appId, deploymentId)`
asks for.

### The catch that shapes the driver

**Lightsail container services cannot pull from a private registry.** The FAQ is
explicit: only public registries are supported. The private path is
`aws lightsail push-container-image`, which uploads into Lightsail's own per-service
image store and requires the **lightsailctl** plugin alongside the AWS CLI.

Three consequences, none fatal but all real:

1. `prepareImageStore` has nothing to create. The store is the service itself.
2. `pushImage` is not `docker push`. It shells out to the AWS CLI with a plugin the user
   must have, which is the first dependency beyond Docker this tool would require. The
   plan has to say so before it fails.
3. Image retention is per service rather than per registry, through
   `get-container-images` and `delete-container-image`, and there is no garbage
   collection step. `reclaim()` returns `not-needed`, which is exactly why that outcome
   exists in the interface.

### The honest reason to build AWS at all

Even at Lightsail's $7 to $10, DigitalOcean at $5 to $12 is comparable, and at
`--compute ecs` AWS is the most expensive of the three at small and medium scale
(`costs.md`). So the reason to support AWS is not savings. It is that people are
already on AWS, with their database and compliance boundary there, and moving the web
tier out is not an option.

**That reason splits the two compute options, which is why both exist.** Lightsail has
private networking *within Lightsail*: container services get a `<service>.service.local`
private domain, and a Lightsail managed database is reachable only by resources in the
same account with public mode off by default. So a Lightsail-native stack is fine. What
Lightsail does not give you is a normal AWS VPC, so an app that has to reach an RDS
instance, a private subnet or a VPC endpoint is the `--compute ecs` case, not the default
one. Choosing Lightsail as the default is a bet that most people deploying a Next.js
front end do not need that, and the flag is there for when the bet is wrong.

### Two open risks to settle before building

**Does a Lightsail container service endpoint buffer responses?** If it does, React
Server Component streaming and Partial Prerendering arrive as one response at the end,
which is the failure `design.md` §11 exists to catch.

An adversarial research pass could not settle this from any AWS source, and it also
knocked down the two comfortable inferences: there is no published evidence that the
endpoint is an Application Load Balancer, and ALB's documented WebSocket support would
not establish that it streams ordinary HTTP responses even if it were one. So this is
genuinely unknown, not merely undocumented. It is a one-container experiment and must be
run before the driver is written, not after.

**Is Lightsail actually being invested in?** As of 2026-09-08 Lightsail appears on
neither the AWS "Services in Maintenance" list nor the "Services in Sunset" list, and
container services are still sold at unchanged prices. But the Lightsail user guide's own
document history shows no entry after 31 October 2025, and App Runner was closed to new
customers with an announcement dated 31 March 2026. Absence from a maintenance list is a
point-in-time fact, not a commitment, and it is a much weaker statement than active
investment. Re-check both lists immediately before committing to the driver, and treat
the ECS path as the hedge that already exists.

### Testing it

`design.md` §9.2 sets out the three layers. Two facts shape the plan:

- **Floci, the local emulator, does not emulate Lightsail container services.** It runs
  the ECS path for real, so `conformance/aws/probe.sh` rehearses a nextship image there,
  but every Lightsail call is tested with recorded responses and a real account.
- **Lightsail is not available on AWS's Free plan.** A Free plan account has to switch to
  the Paid plan, which keeps its credits and unlocks a 90 day trial of the Micro container
  service. A budget alert comes first, because the Paid plan bills anything beyond them.

### What has to happen first

There is no driver interface today. Every command imports the DigitalOcean client
directly, and 24 of its operations are reachable from commands. Several are DigitalOcean
concepts rather than deployment concepts:

| DigitalOcean concept | On AWS |
|---|---|
| Rollback pins the app, then commit or revert | No equivalent: update the service to a previous image tag |
| Whole app spec replaced on update, so it must be merged | Update takes the fields you pass |
| Registry garbage collection, registry-wide and read-only while it runs | ECR reclaims on delete |
| One registry per account | One repository per application |

An interface built from those 24 operations would be a DigitalOcean interface with AWS
forced through it, which would prove nothing. The interface has to be expressed as what
a command needs (deploy this image, go back to that deployment, set these variables)
with each driver deciding how, and the platform-specific orchestration moving into the
driver.

| Deliverable |
|---|
| **Done.** A driver interface expressed as intent (`targets/target.ts`), with the DigitalOcean driver reshaped to implement it. Every command now talks to `Target`, platform orchestration moved into the driver, and all tests plus the live commands behave identically. Proven against one cloud, which makes it a hypothesis until the second exists |
| **Done.** A local rehearsal of the container path against Floci: `conformance/aws/probe.sh` pushes a nextship image to an emulated ECR, runs it as an ECS task, checks it streams and reads its CloudWatch logs. Not in CI until a driver exists for it to test |
| Settle the streaming question with a real container before writing a driver against it |
| Lightsail driver: create the service, deploy, wait, report its URL |
| Image push through `lightsail push-container-image`, with a preflight that names the missing `lightsailctl` plugin rather than failing inside the AWS CLI |
| Rollback by redeploying a previous deployment version |
| Custom domains with a Lightsail certificate, and the DNS record printed the same way DigitalOcean's is |
| Retention over per-service images, with `reclaim()` answering `not-needed` |
| Container logs for `logs` and `logs --follow` |
| Credentials: profile and region resolution, and a plan that names the IAM permissions it will use |
| `--compute ecs` for ECS Express Mode, once Lightsail works, for people who need a VPC or real autoscaling |

---

## Beyond v1.0

Not scheduled. Recorded so that the decision to skip them stays deliberate. Each
becomes relevant only when a specific need appears, and the trigger is written down
next to it.

### v2: correctness at scale

**Trigger:** running more than one instance, whether for traffic or availability.

Everything here is additive, and until the trigger fires, none of it is needed:
Next.js's own filesystem cache handler is correct for a single instance.

- Shared cache handler wired through `cacheHandler` and `cacheHandlers`, backed by
  Redis for tags, timestamps and locks, and object storage for entry bodies.
- Distributed tag coordination. `updateTags()` writes invalidation timestamps to
  shared storage, `refreshTags()` reads them before each request and must never
  throw. An entry is stale when the newest timestamp among its tags is later than
  the entry's own. Note that sharing a filesystem volume does **not** solve this,
  because Next.js keeps an in-memory cache above the filesystem.
- Atomic multi-representation writes, so the HTML and the RSC payload for a path
  commit together and a reader never sees a half-written pair.
- Build-time cache seeding, once the internal cache key format is verified.
- Request collapsing: node-local mutex, then a regional lock with a fencing token,
  double-checked read, hedged fallthrough.
- Horizontal autoscaling and rolling deploys with no 5xx.

This is also the only part of the plan that is not already served by an existing
tool, so it is where the work would go if this ever becomes a product.

### v3: git-driven previews

**Trigger:** wanting a URL per pull request without running the CLI by hand.

A GitHub Action plus `nextship deploy --preview --alias pr-123` that comments the URL
and tears the environment down on merge. Needs no server on our side.

### v4: hosted control plane

**Trigger:** other people wanting to use this without running it themselves.

The CLI becomes the engine; the hosted service calls the same drivers rather than
reimplementing them. Dashboard, teams, build isolation, and cloud connection through
least-privilege delegated access, which needs its own design document before any
code. Apps still run in the customer's own cloud account.

### v5: edge performance

**Trigger:** TTFB mattering more than simplicity, or media delivery costing more than
a CDN would.

- **Static assets from object storage.** `public/` and `_next/static` served from
  Spaces and its CDN rather than the container. On the real project that is 78 MB of a
  591 MB image, so it is the largest single size win left, and it is where the asset
  split and Windows path normalisation return. Moved out of v0.4 deliberately: it is
  performance rather than correctness, the container serves this media correctly today,
  and it adds a second billable service (about $5 per month) to an account currently
  running one app. This is the cheapest step here and the natural first one.
- CDN-cached HTML and RSC (targeting Next.js's forthcoming pathname-based cache keying
  rather than the current header-hash scheme), tag purge propagation across regions,
  and PPR edge stitching. Origin-only PPR is already correct from v0.1 onward, so this
  is purely an optimization.

### v6: beyond Next.js

**Trigger:** wanting to deploy something that is not Next.js.

The Ship Output format is framework-agnostic in shape, so this is an adapter per
framework plus a manifest translation, not a redesign.

---

## Deliberately not built

Recorded so the decision stays visible rather than looking like an oversight.

| Not built | Why |
|---|---|
| Lambda, or any serverless AWS compute | It would be the cheapest option by far, and that is not the deciding factor. Lambda cannot run `next start`, so the app has to be split into functions and the routing pipeline re-implemented: middleware matching, dynamic segments, the `rsc` and `_rsc` cache-key discipline, PPR resume, ISR through object storage and a queue, image optimization as its own function. That is the work `design.md` §2.1 exists to avoid, and the work that cost other projects years. It also cannot port: DigitalOcean has no Lambda, so a serverless-first design would make the driver interface a fiction |
| `env pull` | App Platform never returns a stored secret, so a pull could only ever return `NEXT_PUBLIC_*` values and the names of the rest. `nextship env` already lists the names. A command that returns blanks for everything that matters is worse than no command |
| Log forwarding to an external sink | Needs a destination and credentials that are the user's to choose. There is nothing to verify against, and shipping unverified infrastructure code is how the defects in this project's own history got made |
| A dedicated health endpoint | Would mean replacing Next.js's `startServer` and owning keep-alive, upgrades and error handling on the most critical path in the system, to save one render every few seconds for apps that prerender nothing. The health path is chosen from the build's prerendered routes instead |

---

## Sequencing principles

1. **Correctness before performance.** A correct single instance beats a fast broken
   cluster.
2. **Every version is usable.** No version exists only to enable a later one.
3. **Seams, not stubs.** Where a later version will swap an implementation, the
   interface appears in the change that first consumes it, never before
   ([`../AGENTS.md`](../AGENTS.md) §3.1).
4. **Build for the current user.** Right now that user is one person with one app.
   Features justified only by imagined future users wait until those users exist.
