# Critical review of nextship, v0.2

An adversarial pass over the design and differentiation documents. Three defects
were found and reproduced during this review; they are listed first because they are
live bugs, not opinions. Everything else is organised by area, and every gap says
what to check, why it matters, and how to verify it rather than assume.

Author: Gowtham
Date: 2026-09-06
Reviews: [`00-design.md`](./00-design.md), [`04-how-we-differ.md`](./04-how-we-differ.md),
[`01-roadmap.md`](./01-roadmap.md)

**Priority key:** **P0** blocks v0.3 · **P1** blocks v1.0 · **P2** future · **P3** nice to have

---

## 1. Verdict up front

The engineering is sound and better verified than most projects at this stage. Three
things are genuinely wrong with the current build, one of which silently ships stale
content. The differentiation document overstates the moat: what nextship does that
others do not is mostly **correct defaults applied together**, and every individual
default is copyable in days. The one durable differentiator is unbuilt (v2). The
zero-config promise has a hole nobody has noticed because no deploy exists yet
(Vercel migration). And the headline correctness claim, the adapter compatibility
suite, has still never been run.

None of that means stop. It means the honest pitch today is narrower than the
document implies, and three bugs need fixing before a single deploy.

---

## 1a. Resolution status, 2026-09-07

Everything marked P0 is fixed and verified. The two cheapest P1 items are fixed too,
because both were single-instruction changes with measurable effects.

| Item | Status |
|---|---|
| §2.1 env change ships the old value | **Fixed.** The id is now a content address. Re-ran the original experiment: same commit and a changed env value now produce `dpl-d1cacea426a6-72f4c3d4` then `dpl-d1cacea426a6-461ad4c3`, and the second image contains `value-TWO`. Seven unit tests pin it |
| §2.2 no platform pinned | **Fixed.** `--platform linux/amd64` on every build; `docker image inspect` reports `amd64`. Six unit tests on the argument list |
| §2.3 145 s cold rebuilds | **Fixed, and the cause was not what this document said.** See below |
| §2.4 `.dockerignore` precedence | **Fixed.** Project rules are merged in first, ours last, with a test asserting a project `!.env` cannot win |
| §4.2 ISR cache is ephemeral | **Decided and documented** as a v1 limitation in `00-design.md` §12, with the App Platform volume question raised for v0.3 |
| §7.1 key does not survive a machine change | **Mitigated.** The CLI now warns on generation, and warns when the environment variable disagrees with the stored key. The environment variable is documented as the CI path. A provider secret store is the real fix and needs a target to exist |
| §6.1 rollback unsound | **Fixed** as a consequence of §2.1 |

**§2.3 was diagnosed wrongly in this document.** The claim was that `.next/cache` not
persisting caused the 145 second rebuilds. Adding a cache mount for it changed almost
nothing. Measuring the individual steps showed the real cause: `COPY . .` preceded the
install, so any source change re-ran `pnpm install`, which is **97.6 seconds**, while
the Next.js compile is only **6.3 seconds**. Copying manifests before sources and the
application after took a source-change rebuild from **150 s to 56 s**. The cache mount
was kept because it is correct, but it was not the fix. Recorded here because the
original reasoning was plausible and wrong, which is exactly the failure mode this
document exists to catch.

## 2. Defects found and reproduced during this review

### 2.1 P0. Changing an environment variable silently ships the old value

**Reproduced.** With `NEXT_PUBLIC_GREETING=value-ONE`, built, then changed the file
to `value-TWO` and rebuilt with no other change:

```
build 1: 168s → featureapp:dpl-149dc4378d55   image contains value-ONE
build 2:  19s → featureapp:dpl-149dc4378d55   image STILL contains value-ONE
```

Same tag, cached layers, wrong content. Two causes compound:

1. BuildKit deliberately excludes `--mount=type=secret` content from the cache key,
   so changing a mounted env file does not invalidate the build step.
2. The image tag is derived from the git commit, and the commit did not change.

**Why it matters:** rotate an API key, redeploy, and the old key is still live with
no signal. It also poisons rollback: two different images can share a tag, so
"roll back to `dpl-abc`" is ambiguous.

**Fix:** hash the contents of every env file plus the encryption key into a
`--build-arg` consumed before the build step, so it participates in the cache key,
and fold the same hash into the deployment id suffix.

**How to verify the fix:** repeat the experiment above and assert both that the tag
changes and that `grep -r value-TWO .next/server` inside the image finds it.

### 2.2 P0. No target platform is pinned

`grep -n "platform" packages/cli/src/image/dockerfile.ts packages/cli/src/docker.ts`
returns only comments. `docker build` produces an image for the **builder's**
architecture. On Apple Silicon that is `linux/arm64`, which will not run on a
DigitalOcean App Platform or ECS `amd64` host, and the failure appears at deploy
time, not build time.

**Why it matters:** any contributor or CI runner on ARM produces a broken artefact.
This is a silent, environment-dependent failure, the worst kind.

**Fix:** pass `--platform linux/amd64` by default, expose an override, and record the
architecture in the manifest so a mismatch is caught before push.

**How to verify:** `docker image inspect <tag> --format '{{.Architecture}}'` must
report `amd64` regardless of the machine that built it. Best tested on an ARM
machine, or with `docker buildx build --platform linux/arm64` to simulate.

### 2.3 P1. Every source change costs a full cold Next.js build

**Measured.** A one-character edit to a component:

```
no change:            19s   (fully cached)
one-character change: 145s  (COPY . . invalidates, next build runs cold)
```

`.next/cache`, which is Next.js's own incremental build cache, is not persisted
between Docker builds. Only the package manager store is a cache mount.

**Why it matters:** 145 seconds per iteration is a bad inner loop and will push
people back to `next build` locally, which defeats the point of building in Docker.
Vercel and Coolify both persist this cache.

**Fix:** add `--mount=type=cache,target=<appPath>/.next/cache` to the build step. It
must be a cache mount rather than a copied directory so it never enters a layer, and
`prune.cjs` already excludes `.next/cache` from the output.

**How to verify:** repeat the one-character-change build and compare wall time before
and after. Also confirm the cache is not in the image:
`docker run --rm --entrypoint sh <tag> -c 'ls .next/cache'` should be empty.

### 2.4 P1. A user `.dockerignore` is appended last and can override our exclusions

The generated ignore file puts our rules first and the project's rules after. Docker
applies last-match-wins, so a project rule such as `!node_modules` or `!.env` would
re-include files we deliberately excluded, including env files that are supposed to
arrive only as secret mounts.

**Why it matters:** a security-relevant exclusion can be silently undone by a file
the user already had.

**Fix:** put the user's rules **first** and our exclusions last, or refuse to run when
a user rule re-includes a protected path, naming the rule.

**How to verify:** add `!.env` to a project `.dockerignore`, build, then
`docker history` or extract the builder stage and check whether `.env` reached the
context: `docker build --target builder -o type=local,dest=./probe .` and look for it.

---

## 3. Architecture and the build pipeline

### 3.1 P1. `prune.cjs` is the single largest technical risk and has no upstream contract

It reimplements what `output: 'standalone'` does, from trace files, because
standalone is incompatible with the Adapter API. That reasoning is verified, but the
consequence is that nextship now owns a reimplementation of a moving part of Next.js
with **no upstream guarantee**. Nothing in the Adapter API promises that
`.next/server/**/*.nft.json`, `required-server-files.json` or the launcher's entry
points remain stable.

**Why it matters:** a Next.js minor release can break every image with a
`Cannot find module` at boot, exactly as happened during development on 16.2.9.

**What to check:**
- Does the Adapter API document a supported way to obtain the runtime file set? The
  `outputs[*].assets` maps expose traced dependencies per route and may be the
  sanctioned replacement for reading `.nft.json` from disk. Read
  `nextjs.org/docs/app/api-reference/adapters/output-types` and compare `assets`
  against the trace files for the same build.
- Does `required-server-files.json` have an `ignore` field we should honour? It does,
  and prune currently reads only `files`.
- Are `outputFileTracingIncludes` and `outputFileTracingExcludes` honoured? They are
  applied by Next.js when generating the traces, so they should be inherited, but this
  is assumed, not tested.

**How to verify:** build a project that sets `outputFileTracingIncludes` for a file
that nothing imports (a template, a `.node` binary), then assert the file is present
in the image. Same for `outputFileTracingExcludes` and absence.

### 3.2 P1. No test proves the pruned tree equals what standalone would produce

The prune tests use a synthetic `.next` fixture. There is no test that takes a real
build and asserts the runtime tree is a superset of what Next.js's own standalone
output contains.

**Why it matters:** the fixture cannot catch "Next.js started requiring a new file".

**How to verify:** for a project where the Adapter API is disabled, run
`next build` with `output: 'standalone'`, then run nextship's prune on the same
build, and diff the two file lists. Anything in standalone and missing from ours is a
latent boot failure. This is a cheap, high-value regression test and should run in CI
against each supported Next.js minor.

### 3.3 P2. Dynamic requires are untraced, the same as for everyone

`nodeFileTrace` cannot follow `require(variable)`. Standalone has the same limitation,
so this is not a competitive disadvantage, but it should be a documented limitation
rather than an unknown.

**How to verify:** an app that does `require(process.env.PLUGIN_PATH)` will fail. Add
it to §12 of the design as a known limitation with the workaround
(`outputFileTracingIncludes`).

### 3.4 P2. `--platform`, image signing, SBOM and provenance are all absent

No supply-chain story: no image signature, no SBOM, no build provenance attestation.
Not needed for a personal tool, mandatory the moment anyone else runs the images.

**How to verify:** `docker buildx build --provenance=true --sbom=true` produces both;
check `docker buildx imagetools inspect <tag>`.

---

## 4. Next.js feature compatibility

### 4.1 P1. Verified, unverified and the honest gap

Verified on real containers: streaming, ISR time-based and on-demand, Server Actions,
`after()`, `next/image` with sharp, skew protection, graceful shutdown, monorepo
layout, npm and pnpm.

**Never tested, and currently claimed nowhere, which is correct but incomplete:**

| Feature | Risk if broken | How to verify |
|---|---|---|
| **Middleware / `proxy.ts`** | High. Very common. `.next/server/middleware.js` is copied by the tree copy, but nothing proves it executes | Add a middleware that rewrites `/a` to `/b` and sets a header; assert both in the container |
| **PPR** | Medium. Design claims "origin-only PPR is fully supported and correct" with no evidence | Enable `experimental.ppr`, add a route with a static shell and a dynamic hole, assert the shell arrives before the hole |
| **Cache Components / `use cache`** | Medium. New default direction of the framework | Enable `cacheComponents`, use `use cache` plus `cacheTag`, then `revalidateTag`, assert content changes |
| **`revalidateTag`** | Medium. Only `revalidatePath` was tested | A tagged `fetch` plus a route handler calling `revalidateTag` |
| **Route Handlers, all verbs** | Medium. Only GET was tested | POST/PUT/DELETE with bodies, plus streaming responses |
| **`basePath` and `assetPrefix`** | Medium. Changes asset URLs and prune assumptions | Set both, assert assets resolve in the container |
| **i18n routing** | Low-medium | Configure locales, assert redirects |
| **`instrumentation.ts`** | Medium. Runs at boot; a missing traced file is a boot crash | Add one that logs, assert the log appears |
| **`output: 'export'`** | Low. Static-only apps have no server; the pipeline would produce a container with nothing to run | Assert nextship fails with a clear message rather than a broken image |
| **Webpack instead of Turbopack** | Medium. All testing so far used Turbopack | Build with `--webpack` (or the project's config) and repeat the feature matrix |
| **ISR cache surviving a restart** | **High, see 4.2** | Below |

### 4.2 P0. ISR cache is ephemeral and this is not stated anywhere

`.next/cache` is created inside the container. Container restarts, redeploys and
horizontal moves all discard it. Every restart is a cold cache, and on a platform that
recycles containers this can mean near-permanent cold cache.

**Why it matters:** the design says ISR "works" on a single instance, which is true
per-process, but a reader will assume cached pages persist. On App Platform they do
not.

**What to check:** does DigitalOcean App Platform restart containers routinely, and
does it support a persistent volume for a component? App Platform historically does
**not** offer persistent disks for services, which would make this permanent.

**How to verify:** run the container, populate the ISR cache, `docker restart`, then
request the page and check `x-nextjs-cache`. It will be `MISS`. Then check the App
Platform docs for volume support, and decide between accepting cold caches on restart,
mounting a volume where the platform allows one, or bringing the v2 shared cache
handler forward.

### 4.3 P2. `next/image` optimization writes to the same ephemeral cache

Optimized images are cached under `.next/cache/images`. Same lifetime problem: every
restart re-optimizes everything, costing CPU and latency. On an image-heavy site like
the portfolio project this is the dominant cost of a cold start.

**How to verify:** time the first and second request for the same optimized image,
restart, and time it again.

---

## 5. Adapter API assumptions

### 5.1 P1. The adapter is copied as a loose file, which the API may not sanction

The CLI copies `adapter.mjs` into the build context and points `NEXT_ADAPTER_PATH` at
it. This works today. It assumes the adapter needs no `package.json`, no dependencies,
and no resolution context.

**What to check:** the documented contract for `adapterPath` and `NEXT_ADAPTER_PATH`,
and whether adapters are expected to be resolvable packages. Read
`nextjs.org/docs/app/api-reference/adapters/creating-an-adapter` and compare against
how `nextjs/adapter-vercel` is packaged and loaded.

**Why it matters:** if Next.js starts requiring a package identity (for versioning or
for the compatibility suite), the copy approach breaks.

### 5.2 P1. No adapter API version negotiation

The manifest is versioned, but nothing checks which **Adapter API** version Next.js
provides. The version gate is `>= 16.2` and open-ended upward. Next.js has committed
that breaking adapter changes require a major, but 17.x will arrive.

**Fix:** record `nextVersion` and an adapter contract version in the manifest, and
warn on an untested major.

**How to verify:** build against a Next.js canary of the next major and see what breaks.

### 5.3 P1. The compatibility suite has never been run, which is the whole correctness claim

Both the design and the differentiation document lean on "the same suite Vercel's
adapter runs against". Until it runs, that is an aspiration.

**How to verify:** follow
`nextjs.org/docs/app/api-reference/adapters/testing-adapters`, wire it into CI, and
publish the pass/fail matrix. Expect it to fail in places; that is the point. This is
the single highest-value unstarted task in the project.

---

## 6. Cloud provisioning, deployment lifecycle, rollback

All of this is Designed, none Implemented, so the review is of the plan.

### 6.1 P0. Rollback is unsound while defect 2.1 exists

Rollback is described as "flip to the previous image tag". With commit-derived tags
and env content excluded from the tag, two different images can share a tag. Rolling
back may restore different content than expected.

**Fix:** tags must be content-addressed over everything that affects the image,
including env and the encryption key. Then rollback is exact.

### 6.2 P1. `HEALTHCHECK` in the image is not what DigitalOcean uses

The image carries a Docker `HEALTHCHECK`. App Platform performs its own HTTP health
checks configured on the component and generally ignores the image's. The design's
health gate is therefore not yet real for the actual target.

**How to verify:** read the App Platform health check documentation, then deploy and
confirm which mechanism gates traffic.

### 6.3 P1. No deployment concurrency control

Two `nextship` runs in the same project clobber `.nextship/`, and nothing prevents two
deploys racing to the same service.

**Fix:** a lockfile in `.nextship/` with a pid and timestamp, and a remote guard once
deploys exist.

### 6.4 P1. No dry run, no plan output, no confirmation before first provisioning

The design mentions a plan step; it is not specified. Creating cloud resources is
irreversible enough to deserve an explicit preview and a typed confirmation.

### 6.5 P2. No zero-downtime story is specified

App Platform does rolling updates, but nothing states what happens to in-flight
requests, how long the drain is, or how the old revision is retired. The container
drains in about 2.5 seconds; the platform must be told to allow at least that.

**How to verify:** deploy under a load generator and count non-200 responses across
the transition.

---

## 7. Security, secrets, credentials, IAM

### 7.1 P0. The Server Actions key does not survive a change of machine or CI

It lives in `.nextship/secrets.local.json`, which is git-ignored. So CI generates a
**different** key, and a deploy from CI breaks Server Actions for every client still
on a build made locally, which is exactly the failure the key exists to prevent.

**Why it matters:** this is the flagship correctness feature and it has a hole in the
most common real workflow.

**Fix:** document and support `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` as the CI path
(already read from the environment), and once a target exists, store the key in the
provider's secret manager as the source of truth rather than a local file.

**How to verify:** build on machine A, build on machine B without copying the file,
and confirm the keys differ. Then confirm a Server Action from an A-built client fails
against a B-built server.

### 7.2 P1. No credential handling design beyond "ambient chain"

For DigitalOcean, `DIGITALOCEAN_TOKEN` is a full-account token by default. There is no
guidance on scoping, rotation, or what the CLI does if the token is over-privileged.
For AWS, no least-privilege policy has been written.

**What to check:** whether DigitalOcean supports scoped tokens with only registry and
App Platform permissions, and what the minimum IAM policy for the AWS path is.

**How to verify:** create a deliberately minimal token or policy, run the deploy, and
add permissions only where it fails. Publish the resulting policy.

### 7.3 P1. Nothing prevents secrets reaching logs

`run` streams container output; `build` streams Docker output. A build that prints an
env value, or an error that dumps `process.env`, goes straight to the terminal and to
CI logs.

**How to verify:** put a sentinel value in an env file, run a build that logs it, and
grep the CLI output.

### 7.4 P2. The runtime image is not scanned

No vulnerability scanning of the base image or dependencies.

**How to verify:** `docker scout cves <tag>` or `trivy image <tag>` in CI, with a
policy on what fails a build.

### 7.5 Adequately covered

Secrets as BuildKit mounts rather than layers, `.nextship/` self-ignoring, non-root
user, and refusing to rotate a corrupted key are all genuinely well handled and better
than most self-hosting guides.

---

## 8. Cost control and infrastructure sizing

### 8.1 P1. No sizing guidance anywhere, and the build needs more RAM than the runtime

Coolify's documentation warns that Next.js builds want at least 4 GB. nextship builds
in Docker on the developer's machine or CI, so the same constraint applies and is
undocumented. Separately, nothing states what instance size the app should run on.

**How to verify:** run the build in a memory-limited container
(`docker build --memory 2g`) and find where it OOMs. Publish a minimum.

### 8.2 P1. Cost model has no per-deploy costs

[`03-cost-model.md`](./03-cost-model.md) covers steady-state hosting well but omits:
registry storage for retained images (660 MB each, and retention is unbounded), egress
for pushes, and build minutes in CI. Ten retained revisions of the portfolio project
is 6.6 GB of registry storage.

**Fix:** an image retention policy in `destroy`/`deploy`, and add these lines to the
cost model.

### 8.3 P2. No budget guardrails

No spend alarms, no maximum instance count, nothing preventing an autoscale event from
producing a surprise bill. Flightcontrol markets exactly this.

---

## 9. Observability and failure recovery

### 9.1 P1. Observability is a single planned `logs` command

No metrics, no traces, no error reporting, no uptime checking. Next.js supports
OpenTelemetry through `instrumentation.ts`, and wiring it would be cheap and
differentiating.

**How to verify:** add an OTel exporter via `instrumentation.ts` and confirm spans
appear; check whether the traced file set includes the instrumentation hook.

### 9.2 P1. No failure recovery design

Undefined: what happens when a deploy half-succeeds, when the registry push fails
mid-way, when the health gate times out, when the platform reports the revision as
failed. Idempotent convergence is claimed but unspecified.

**How to verify:** once a driver exists, inject failures at each step (kill the push,
return 500 from the health endpoint) and confirm the CLI leaves the previous revision
serving and reports precisely what happened.

### 9.3 P2. No build reproducibility check

Two builds of the same commit should produce the same image. With cache mounts and
timestamps they almost certainly will not be bit-identical, which is fine, but it
should be stated rather than implied by "identical inputs produce an identical tag".

---

## 10. Developer experience and the zero-config promise

### 10.1 P1. Requiring local Docker is a real regression against the competition

Coolify, Vercel, Netlify and Flightcontrol all deploy from a git push with nothing
installed locally. nextship requires Docker Desktop running, which on Windows and
macOS is a heavyweight dependency and, combined with the 145 second rebuilds, is the
weakest part of the experience today.

**Mitigation:** make CI the primary path early (a GitHub Action), so local Docker is
optional rather than required.

### 10.2 P1. Missing commands that a production tool needs

`doctor` (environment diagnosis), `logs`, `open`, `status`, `--json` output for
scripting, `--verbose`/`--quiet`, and a `--port` override for `run` (3000 is
hard-coded and will collide).

### 10.3 P2. No first-run experience

No `nextship init`, no interactive prompts, no guidance when detection fails in an
unusual layout.

### 10.4 The zero-config promise: mostly true, with two holes

Genuinely inferred: project root, workspace root, package manager, build command, Node
major, env files, app directory. That is a strong claim and it held on a real project.

The holes:
- **Node major is inferred from `engines`, `.nvmrc`, or the host.** The host fallback
  means the same repository builds against a different Node on a different machine.
  It should be recorded in the manifest and pinned per project.
- **The port is fixed at 3000** everywhere.

**How to verify the first:** run `detect` under two Node versions in a project with no
`engines` and no `.nvmrc`, and compare.

---

## 11. Portability across AWS and DigitalOcean

### 11.1 P1. The portability claim is entirely unproven

One driver interface is sketched; zero drivers exist. The claim that the same image
runs on both is plausible but the differences that matter are not in the image: health
check semantics, secret injection, log formats, rollback primitives, registry auth,
and networking all differ.

**How to verify:** write the DigitalOcean driver first, then the AWS one, and count how
much of the interface survived unchanged. If the interface needs reshaping for the
second target, the claim was wrong.

### 11.2 P1. Streaming through the managed proxy remains unverified

The streaming test measured the container directly. The actual risk was always the
platform's proxy buffering. App Platform and App Runner both sit behind managed
proxies of unknown behaviour.

**How to verify:** deploy the slow-Suspense route and measure TTFB against total
through the public URL, not the container. This is a gating test for the target choice
and should run before the driver is finished.

### 11.3 P2. The "DigitalOcean has no Lambda" rationale is imprecise

DigitalOcean does have **Functions**, a serverless product. They are not a viable
Next.js SSR target, which is the real argument, but the document as written is
factually loose and a knowledgeable reader will notice.

**Fix:** restate as "DigitalOcean has no Lambda-equivalent suitable for a Next.js
server", and say why.

---

## 12. Vercel migration: an entire missing section

Nothing in any document addresses moving an existing app **off Vercel**, which is the
actual user journey. The portfolio project proves the point: it depends on
`@vercel/analytics`.

**What breaks or needs a decision on migration, none of it currently handled:**

| Vercel feature | What happens off Vercel |
|---|---|
| `@vercel/analytics`, `@vercel/speed-insights` | Silently no-op. Analytics simply stop, with no warning |
| `VERCEL_URL`, `VERCEL_ENV`, `VERCEL_REGION` | Undefined. Code branching on them takes the wrong path |
| Cron jobs in `vercel.json` | Never run. Nothing reads that file |
| Edge middleware / edge runtime routes | Run as Node, or fail |
| `@vercel/blob`, `@vercel/kv`, `@vercel/postgres` | Need real replacements |
| Image optimization config and remote patterns | Must work through the container instead |
| ISR behaviour | Vercel's durable, purge-capable cache versus an ephemeral container cache (§4.2) |
| Preview deployments | No equivalent until v3 |
| `vercel.json` rewrites, redirects, headers | Ignored; only `next.config` equivalents apply |

**Why it matters:** this is the difference between a tool that builds an image and a
tool someone can actually switch to. It is also cheap: most of it is a preflight check.

**Fix:** a `nextship doctor` that scans for Vercel-specific dependencies, env usage and
`vercel.json`, and reports what will change. Plus a migration guide.

**How to verify:** run the scan against the portfolio project; it should flag
`@vercel/analytics` immediately.

---

## 13. Competitor claims: what is outdated, imprecise, or unfair

### 13.1 Claims to re-verify before publishing

| Claim | Status | How to check |
|---|---|---|
| "Only Vercel and Bun have verified adapters" | Sourced March 2026, re-checked September 2026 and still in development, but this dates fast | Re-read the [Deploying to Platforms](https://nextjs.org/docs/app/getting-started/deploying) adapters list before any public claim |
| "Amplify does not support Next.js 16" | From mid-2026 docs; AWS moves | Check the Amplify SSR supported features page and the `@aws-amplify/adapter-nextjs` peer range |
| "Nixpacks is not actively developed" | True of Railway's stance; Coolify may have moved to Railpack | Check Coolify's current build documentation |
| "DigitalOcean App Platform ISR works out of the box" | Single secondary review, never verified | Deploy a `revalidate` route to App Platform and observe. This also settles §4.2 |
| Cost model figures | Vendor pricing changes quarterly | Re-check before quoting publicly |

### 13.2 Competitors missing from the comparison

**DeployWise** and **HostNextJS** both target this space and are absent. Neither is
large, but a document claiming to cover everything should either include them or say
its scope is the major tools.

### 13.3 The comparison is unfair to Coolify in one place, and generous to nextship

The Coolify table row "Server Actions key: not handled" is accurate but framed as a
product failing. Coolify is framework-agnostic by design; it is not that they handle it
badly, it is that they are not in that business. The honest framing is that nextship
trades generality for depth, and that trade only pays if you deploy Next.js and
nothing else.

Conversely, "Prunes using Next.js trace data: nextship yes / Coolify no" invites a
comparison Coolify never entered.

---

## 14. How strong is the moat, honestly

The differentiation document lists five things. Assessed adversarially:

| Claimed differentiator | Real durability |
|---|---|
| Builds through the official Adapter API | **Weak as a moat, strong as timing.** Anyone can use it. The advantage is being early, and it evaporates when OpenNext ships verified adapters, expected end of 2026 |
| Trace-based pruning without standalone | **Medium.** Genuinely novel because nobody else uses the Adapter API yet, but it is a workaround for an upstream incompatibility. If Next.js fixes that, the work becomes redundant |
| Applies the self-hosting footguns automatically | **Weak individually, real in aggregate.** Each item is a day of work for a competitor. The value is that they are all correct at once, which is a quality position, not a defensible one |
| Touches nothing in your project | **Weak.** A design choice others could adopt |
| Secrets as BuildKit mounts | **None.** Standard practice; SST, Flightcontrol and every managed host already do this |

**The only durable moat in the plan is v2**: shared cache, distributed tag
coordination, atomic HTML and RSC invalidation. That is the thing OpenNext documents as
broken, Netlify names as unsolved, and Coolify's volume advice gets wrong. It is also
the thing not yet started.

**Therefore the honest positioning today is not "differentiated product" but "correct
defaults, applied together, for one framework, on infrastructure you own".** That is a
real and useful thing. It is not a moat.

---

## 15. What is already adequately covered

Not everything needs work. These are genuinely done and should not be reopened:

- The decision to build in Docker, and the reasoning behind it, now backed by the
  Windows `node_modules` failure that forced it
- The standalone incompatibility finding, reproduced with a no-op adapter
- The launcher-trace fallback, confirmed necessary on 16.3.4 in production
- Secrets never entering image layers
- `.nextship/` self-ignoring so the key cannot be committed
- Non-root user, tini for signal delivery, jemalloc for sharp
- Graceful shutdown, measured
- Image size work, measured and attributed layer by layer
- The manifest containing only fields with readers
- Error messages carrying a cause and a next action
- The documentation discipline: nothing claimed that has not been run

---

## 16. Prioritised list

**P0, before any deploy exists**

1. Env changes must invalidate the build and change the tag (§2.1)
2. Pin `--platform linux/amd64` (§2.2)
3. Decide and document the ISR cache lifetime story on App Platform (§4.2)
4. Make the Server Actions key survive a change of machine (§7.1)
5. Content-address the image tag so rollback is exact (§6.1)

**P1, before calling it v1.0**

6. Run the adapter compatibility suite and publish the matrix (§5.3)
7. Diff the pruned tree against real standalone output, in CI, per Next.js minor (§3.2)
8. Verify middleware, PPR, `revalidateTag`, `basePath`, `instrumentation`, webpack (§4.1)
9. Persist `.next/cache` as a build cache mount (§2.3)
10. Fix `.dockerignore` precedence (§2.4)
11. Verify streaming through the platform proxy, not just the container (§11.2)
12. `nextship doctor`, including the Vercel migration scan (§12)
13. Least-privilege credentials for the target (§7.2)
14. Deployment locking and a plan/confirm step (§6.3, §6.4)

**P2, future**

15. OpenTelemetry wiring, image scanning, SBOM and provenance
16. Registry retention and per-deploy cost lines in the cost model
17. Sizing guidance for build and runtime
18. Reconsider whether to adopt an OpenNext verified adapter rather than maintain a
    private build path

**P3, nice to have**

19. `--port`, `--json`, `--verbose`, `open`, `status`
20. Add DeployWise and HostNextJS to the comparison, or state its scope
21. Restate the DigitalOcean Functions point precisely (§11.3)
