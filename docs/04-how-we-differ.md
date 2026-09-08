# How nextship differs from everything else

Every tool that deploys Next.js somewhere other than Vercel, what it actually does,
and where nextship sits. Written to be useful rather than flattering: the last
section lists the places where nextship is worse or simply not different.

Author: Gowtham
Date: 2026-09-06
Companions: [`02-competitive-validation.md`](./02-competitive-validation.md) (is this
worth building), [`03-cost-model.md`](./03-cost-model.md) (what it saves)

---

## 1. The one-paragraph answer

Almost every alternative is one of three things: a **build translation layer** that
does not deploy (OpenNext), a **PaaS that runs your container** but knows nothing
about Next.js (Coolify, Dokploy, CapRover, Kamal, Railway, Render, Fly), or a
**managed host** that knows about Next.js but owns the infrastructure (Netlify,
Amplify, Firebase, Azure, Vercel). nextship is the fourth thing: a **build compiler
and deployer that knows Next.js deeply and provisions into infrastructure you own**.
The practical consequence is that the others make you supply the Next.js knowledge
(a Dockerfile, `output: 'standalone'`, a cache handler, an encryption key) or take
your infrastructure. nextship supplies the knowledge and leaves the infrastructure
with you.

## 2. The layers, and who occupies them

```
  your source
       │
  ┌────▼─────────────────────┐
  │ 1  BUILD TRANSLATION      │  OpenNext · official Adapter API · nextship
  │    framework output into  │  Vercel's adapter · Bun's adapter
  │    deployable artefacts   │
  └────┬─────────────────────┘
  ┌────▼─────────────────────┐
  │ 2  PACKAGING              │  nextship · OpenNext (partial) · you, by hand
  │    image, deps, pruning   │  Nixpacks/Railpack/buildpacks (framework-blind)
  └────┬─────────────────────┘
  ┌────▼─────────────────────┐
  │ 3  PROVISIONING           │  SST · CDK · Terraform · Pulumi · nextship (v0.3)
  │    create the infra       │
  └────┬─────────────────────┘
  ┌────▼─────────────────────┐
  │ 4  LIFECYCLE              │  Coolify · Dokploy · CapRover · Dokku · Kamal
  │    deploy, rollback,      │  Flightcontrol · Railway · Render · Fly
  │    domains, logs, teams   │  Vercel · Netlify · Amplify · Firebase · Azure
  └────┬─────────────────────┘
  ┌────▼─────────────────────┐
  │ 5  RUNTIME CORRECTNESS    │  Vercel. Everyone else: partial or absent.
  │    shared cache, tag      │  (nextship: v2, deliberately not yet)
  │    coordination, atomic   │
  │    HTML+RSC invalidation  │
  └──────────────────────────┘
```

**Nobody else spans 1 and 2 together.** That gap is why self-hosting Next.js means
hand-writing a Dockerfile, and it is the gap nextship fills.

## 3. Every competitor, in detail

### 3.1 Vercel

The reference implementation and the only complete one. Anycast PoPs, a
framework-aware routing layer, request collapsing, roughly 300 ms global tag purge,
atomic HTML and RSC invalidation, PPR edge stitching. Its adapter uses the same
public Adapter API as everyone else, with no private hooks.

**How nextship differs:** it does not compete. Below roughly 1 TB of monthly egress
Vercel Pro at $20 is genuinely hard to beat, and the honest advice at that scale is
to stay ([`03-cost-model.md`](./03-cost-model.md)). nextship exists for people who
must own the infrastructure, or whose bill is dominated by egress and seats.

### 3.2 OpenNext (`@opennextjs/aws`, `@opennextjs/cloudflare`)

The most important project in this space, and **not a competitor**. Its own
documentation is explicit: *"OpenNext does not actually deploy the app. It only
bundles everything for your IAC to deploy it."* No dashboard, no provisioning, no
managed service. Primary targets are AWS Lambda and Cloudflare Workers. It
decomposes an app into a server Lambda, an image optimization Lambda, a revalidation
queue and poller, a warmer, and a tag cache.

Documented limitations: partial Edge Runtime support; with ISR, the data payload
(JSON or RSC) and the HTML *"might be out of sync"*; on-demand revalidation requires
manual CDN invalidation.

**How nextship differs:**
- **It deploys.** OpenNext hands you artefacts and you bring SST, CDK or Terraform.
- **Container-first, not serverless-first.** OpenNext's shape is Lambda and Workers.
  That shape cannot port to DigitalOcean, which has no Lambda.
- **It uses the official Adapter API today.** OpenNext's adapters for AWS, Cloudflare
  and Netlify are in active development, expected late 2026. Until then it reads
  build output directly.
- **No HTML/RSC desync by construction.** nextship does not put HTML on a CDN at all
  in v1, so the class of bug OpenNext documents cannot occur. That is a consequence
  of doing less, not of being cleverer.

If OpenNext's verified adapters land and are good, adopting one is a reasonable
future for nextship's build layer. The defensible work was never the translation.

### 3.3 SST

An IaC framework, and the recommended way to deploy OpenNext output to AWS. Also
supports Next.js in a container on ECS Fargate. Excellent, free, and mature.

**How nextship differs:** SST is infrastructure as code. You own an `sst.config.ts`,
you learn its component model, and you think in AWS primitives. nextship asks for no
configuration file at all and infers everything from the repository. The trade is
control against zero-config: SST does far more, and asks far more.

### 3.4 Netlify

A managed host with its own Next.js runtime, built over years of reverse
engineering. Their engineers documented the cost publicly: reading *"Vercel-tailored,
partly-undocumented build output"*, a cache handler of roughly 500 lines plus 500
lines of tests, Next.js emitting RFC-5861-noncompliant `Cache-Control`, a bot
(`nextjs-sentinel`) watching canary because there was no release calendar, and 1700+
e2e tests run against Next.js itself. Their adapter on the official API is in
development.

Their own list of what remains hard even after the Adapter API: PPR edge stitching,
atomic revalidation of coupled cache entries, and the fact that any path can be
revalidated at any time, which prevents relying on CDN immutability.

**How nextship differs:** Netlify owns the infrastructure and the bill. nextship
provisions into your account. Netlify solves problems nextship deliberately avoids in
v1 by not caching HTML at the edge. Netlify is the better choice if you want someone
else to run it.

### 3.5 Cloudflare (`@opennextjs/cloudflare`)

Next.js on Workers, via OpenNext. An official adapter is in development. Workers is
an excellent runtime with genuinely cheap egress, but it is not Node.js, and the
compatibility surface for a Node-shaped Next.js app is the ongoing work.

**How nextship differs:** nextship targets a plain Node process in a container, which
is the configuration Next.js itself calls fully supported. No runtime compatibility
questions, and no Workers-specific limits. In exchange, no edge distribution.

### 3.6 AWS Amplify Hosting

First-party AWS managed hosting from git.

Documented limits worth knowing: **Next.js 16 is not listed as supported** as of
mid-2026 (the docs state support through 15, and `@aws-amplify/adapter-nextjs` pins
its peer dependency below 16); SSR build output capped at 220 MB; maximum SSR
response 5.72 MB; Edge middleware unsupported; `unstable_after` unsupported.

**How nextship differs:** nextship requires Next.js 16.2 or newer and refuses older
versions with a reason, because the Adapter API is what it is built on. So the two
barely overlap on version support today. nextship also has no build output cap or
response size cap beyond what your own infrastructure imposes.

### 3.7 Firebase App Hosting

GA, preconfigured for Next.js: Cloud Build for assets, Cloud Run for dynamic content,
Cloud CDN in front. Genuinely good, genuinely managed, Google-owned.

**How nextship differs:** same axis as Netlify and Amplify. Their infrastructure and
their opinions, versus your account and your choices. Firebase is the better choice
if you are already on GCP and want it handled.

### 3.8 Azure Static Web Apps

Supports hybrid Next.js including App Router and Server Components. Notable
restriction: linked APIs via Azure Functions, App Service, Container Apps or API
Management are unsupported when using hybrid rendering.

**How nextship differs:** nextship produces an ordinary container, so nothing about
your app's backend integration is constrained by the host.

### 3.9 Flightcontrol

The closest competitor to nextship's stated positioning: a dashboard that deploys
into **your own AWS account**, git-driven, with previews. $49/month starter, $249 for
preview environments, RBAC and multi-region.

**How nextship differs:**
- **Free and open**, versus $49 to $249 a month.
- **CLI-first with no server on our side.** Flightcontrol runs a control plane;
  nextship runs on your machine or CI.
- **Next.js-specific build knowledge.** Flightcontrol is a general AWS deployer that
  supports many frameworks; nextship goes deep on one.
- **Flightcontrol is a real product with real support.** nextship is one person's
  pre-alpha tool. For a business today, Flightcontrol is the safer answer.

### 3.10 Coolify

The leader of the self-hosted PaaS category, and the most likely thing a Next.js
developer actually reaches for. Open source, runs on your VPS, git push to deploy,
automatic HTTPS through Traefik or Caddy, a dashboard, one-click services. Builds
with Nixpacks by default or a Dockerfile you supply.

Three things worth knowing, all from its own docs and community guides: Nixpacks is
**no longer actively developed** (Railway, its origin, moved to Railpack); Next.js
production builds want **at least 4 GB RAM** on the build server; and its ISR guidance
is to **mount `.next/cache` as a volume**, which is correct for exactly one replica
and silently wrong for two, because Next.js keeps an in-memory cache above the
filesystem.

**How nextship differs, concretely:**

| | Coolify | nextship |
|---|---|---|
| Where it runs | A daemon on your VPS, plus a dashboard and a Postgres | Nothing. A CLI on your machine or CI |
| Build knowledge | Nixpacks (framework-blind) or your Dockerfile | The official Next.js Adapter API |
| `output: 'standalone'` | You add it to `next.config` for the small-image path | Never needed, and never touched. It is incompatible with the Adapter API anyway |
| Dockerfile | Yours to write and maintain for anything non-trivial | Generated, never edited by you |
| Image contents | Whatever the buildpack decides | Only files Next.js's own trace data lists |
| Server Actions key | Not handled. Rotates on rebuild, breaking older clients | Persisted per project, refuses to rotate silently |
| Skew protection | Not handled | `deploymentId` set automatically |
| Env at build | Build args or baked in | BuildKit secret mounts; never in a layer |
| Where your app lives | The VPS you administer | Managed cloud services (v0.3), or anywhere a container runs |

Coolify is more product than nextship in every dimension that is not Next.js
knowledge: dashboard, databases, backups, multi-app, community. If you want a
self-hosted Heroku, use Coolify. nextship is the deeper answer to one narrower
question.

### 3.11 Dokploy

Coolify's main rival. Docker Swarm rather than plain Docker, Traefik router, cleaner
UI, better built-in monitoring. Same category, same relationship to nextship: a
framework-blind platform that runs your container.

### 3.12 CapRover

Older, Docker Swarm based, UI plus a one-click app catalogue, lighter on resources
than Coolify. Same category.

### 3.13 Dokku

The original self-hosted Heroku. Git push, buildpacks, plugins, very small. Framework
knowledge comes from a buildpack, which for Next.js means it knows how to run
`next build` and nothing about ISR, skew or Server Actions.

### 3.14 Kamal

37signals' deployer: **no dashboard, no daemon on the server**, a YAML file in your
repo, containers rolled out over SSH behind `kamal-proxy`. Philosophically the
closest to nextship's "no infrastructure of our own" stance, and admirably small.

**How nextship differs:** Kamal deploys a container **you** built. You write the
Dockerfile, you decide what goes in it, you handle `output: 'standalone'`, the cache
handler, the encryption key and the deployment id. Its documentation and conventions
are also Rails-centric. Kamal is the deployer; nextship is the part that knows what
to deploy. They are arguably complementary: nextship's generated image would deploy
fine with Kamal.

### 3.15 Railway, Render, Fly.io

Managed PaaS with their own build systems (Railpack, buildpacks, Dockerfiles). Very
good developer experience, priced between a VPS and Vercel, and they own the
infrastructure.

**How nextship differs:** their infrastructure, their build system, their bill. Same
axis as the managed hosts, with less Next.js-specific knowledge than Netlify or
Vercel.

### 3.16 DigitalOcean App Platform

The v0.3 target, and a competitor at the same time. Its Node buildpack detects
Next.js and builds from git with no configuration, and a 2026 review reports ISR and
image optimization working out of the box. Containers from $5/month and egress at
**$0.02 per GiB**, which is seven to seventeen times cheaper than Vercel's.

**How nextship differs:** App Platform's buildpack path is framework-blind in the same
way Nixpacks is. nextship pushes an image whose contents it controls, with the
Next.js-specific handling above, onto the same platform. Worth stating plainly: for a
simple app, App Platform's own buildpack may be entirely sufficient, and the honest
comparison is nextship's correctness handling against the convenience of doing
nothing at all.

### 3.17 Plain Docker plus `next start`

What most teams actually do. A hand-written Dockerfile, usually copied from a blog
post, usually using `output: 'standalone'`.

**How nextship differs:** this is the real baseline, and the comparison is the honest
argument for the whole project. A hand-written Dockerfile typically misses: the
Server Actions encryption key (breaks Server Actions for clients on the previous
deploy), `deploymentId` (breaks old clients after any deploy), jemalloc with sharp
(unbounded memory growth under image optimization, documented by Next.js), tini as
PID 1 (SIGTERM never reaches node, so in-flight requests and `after()` callbacks are
lost), env files as build secrets rather than layers, and `.next/cache` being
writable by the runtime user.

nextship applies all of them, every time, without being asked.

## 4. Feature matrix

Verified marks are things measured in this repository. Others come from vendor
documentation and are marked where uncertain.

| | nextship | Coolify / Dokploy | Kamal / Dokku | OpenNext + SST | Flightcontrol | Netlify / Amplify / Firebase | Vercel |
|---|---|---|---|---|---|---|---|
| Runs on infrastructure you own | Yes | Yes (your VPS) | Yes | Yes | Yes (your AWS) | No | No |
| Requires no server of its own | Yes | No (daemon + DB) | Yes | Yes | No | No | No |
| You write a Dockerfile | No | Sometimes | Yes | No | No | No | No |
| You edit `next.config` | No | Often (`standalone`) | Yes | No | No | No | No |
| Uses the official Adapter API | Yes | No | No | In development | No | In development | Yes |
| Prunes using Next.js trace data | Yes (verified) | No | No | Yes | Unknown | Yes | Yes |
| Server Actions key persisted | Yes (verified) | No | No | Unknown | Unknown | Unknown | Yes |
| Skew protection (`deploymentId`) | Yes (verified) | No | No | Unknown | Unknown | Partial | Yes |
| Secrets never in image layers | Yes (verified) | Varies | Your choice | Yes | Yes | Yes | Yes |
| Streaming verified end to end | Yes (verified) | Untested | Untested | Partial | Unknown | Yes | Yes |
| Graceful SIGTERM drain | Yes (verified) | Depends on image | Depends on image | Yes | Yes | Yes | Yes |
| Multi-instance cache correctness | **No** (v2) | **No** | **No** | Partial | Unknown | Partial | Yes |
| CDN-cached HTML and RSC | **No** (v5) | No | No | Yes, with documented desync | Unknown | Yes | Yes |
| PPR edge stitching | **No** | No | No | No | No | No | Yes |
| Dashboard, teams, git push | **No** (v3, v4) | Yes | No | No | Yes | Yes | Yes |
| Price | Free, open | Free, open | Free, open | Free, open | $49 to $249/mo | Usage | Usage plus seats |
| Maturity | **Pre-alpha, one person** | Mature | Mature | Mature | Mature | Mature | Mature |

## 5. What is genuinely different, in one list

Five things nextship does that no other tool in this table does today:

1. **Builds through the official Next.js Adapter API.** Only Vercel's and Bun's
   adapters are verified today. Every self-hosting tool listed here either reads
   build output directly or ignores the framework entirely.
2. **Assembles the runtime tree from Next.js's own trace files, without
   `output: 'standalone'`.** This was forced rather than chosen: standalone output is
   **incompatible with the Adapter API**, verified against 16.3.4, reproducible with
   a no-op adapter. Everyone else's small-image path depends on standalone, so
   nobody else has hit this. On a real project it produced a 660 MB image where a
   naive one was 1.13 GB, with `node_modules` down from 469 MB to 111 MB and the
   125 MB SWC compiler gone entirely.
3. **Applies the Next.js self-hosting footguns automatically**: Server Actions
   encryption key persisted and never silently rotated, `deploymentId` for skew
   protection, jemalloc for sharp, tini for signal delivery, anti-buffering header,
   writable cache directory.
4. **Touches nothing in your project.** No Dockerfile, no `next.config` edit, no
   dependency added, no `.gitignore` or `.dockerignore` modified. Everything lives in
   `.nextship/`, which ignores itself in git so the encryption key cannot be
   committed.
5. **Secrets are BuildKit mounts, never layers.** Env files and the encryption key
   exist only for the build step.

## 6. Where nextship is worse, or not different at all

Stated plainly, because a comparison that only flatters is useless.

- **It cannot deploy anywhere yet.** v0.3. Every tool in this document can.
- **It is pre-alpha, written by one person.** Coolify, Kamal, SST and Flightcontrol
  are mature with real communities. For anything with a deadline, use one of those.
- **It is not multi-instance correct.** Neither is Coolify, Dokploy, Kamal or Dokku,
  and OpenNext documents desync in this area. But Vercel is, and nextship is not
  claiming otherwise. That work is v2, and it is the only part of this problem that
  is genuinely unsolved anywhere outside Vercel.
- **No dashboard, no git push, no previews, no teams.** v3 and v4 at the earliest.
- **One framework.** Every PaaS in this document deploys anything.
- **The official compatibility suite has not been run.** Until it has, no support
  matrix is published and no completeness is claimed.
- **Images are 516 MB to 660 MB.** Half of that is `node:24-slim` itself. A
  hand-tuned Alpine image would be smaller.
- **On simple apps, DigitalOcean App Platform's own buildpack may be enough**, and
  the marginal value of nextship is the correctness handling rather than the deploy.

## 7. When to use what

- **Use Vercel** if you are under about 1 TB of egress and a small team. It is hard
  to beat on price and impossible to beat on correctness.
- **Use Netlify, Amplify, Firebase or Azure** if you want it managed and are already
  in that ecosystem.
- **Use Flightcontrol** if you want a Vercel-like product on your own AWS today and
  $49 to $249 a month is cheaper than your time.
- **Use Coolify or Dokploy** if you want a self-hosted Heroku for many services, not
  just Next.js, and a dashboard matters.
- **Use Kamal or Dokku** if you want minimal, config-as-code deployment and are happy
  owning the Dockerfile.
- **Use OpenNext plus SST** if you want serverless AWS with scale to zero and are
  comfortable owning IaC.
- **Use nextship** if you want the Next.js-specific correctness handled for you,
  your app on infrastructure you own, and nothing added to your repository. Today
  that means locally. From v0.3, DigitalOcean.

## 8. Sources

- [OpenNext](https://opennext.js.org/) and its [comparison page](https://opennext.js.org/aws/comparison)
- [Next.js across platforms: adapters, OpenNext, and our commitments](https://nextjs.org/blog/nextjs-across-platforms)
- [Next.js: deploying to platforms](https://nextjs.org/docs/app/guides/deploying-to-platforms)
- [Next.js: self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Netlify: Next.js deployment challenges](https://www.netlify.com/blog/how-we-run-nextjs/)
- [Netlify: the Next.js adapter API just shipped](https://www.netlify.com/blog/the-next-js-adapter-api-just-shipped-here-s-what-comes-next/)
- [Coolify: Next.js docs](https://coolify.io/docs/applications/nextjs) and [Nixpacks overview](https://next.coolify.io/docs/applications/builds/nixpacks/overview)
- [Self-hosted deployment tools compared: Coolify, Dokploy, Kamal, Dokku](https://dev.to/ameistad/self-hosted-deployment-tools-compared-coolify-dokploy-kamal-dokku-and-haloy-2npd)
- [Self-hosted PaaS compared 2026](https://wz-it.com/en/blog/self-hosted-paas-comparison-coolify-dokploy-caprover/)
- [AWS Amplify: SSR supported features](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-supported-features.html)
- [Firebase App Hosting](https://firebase.google.com/docs/app-hosting)
- [Azure Static Web Apps: Next.js support](https://learn.microsoft.com/en-us/azure/static-web-apps/nextjs)
- [Flightcontrol vs Vercel](https://getdeploying.com/flightcontrol-vs-vercel)
- [SST: Next.js on AWS](https://sst.dev/docs/start/aws/nextjs/)
- [DigitalOcean: Node.js buildpack](https://docs.digitalocean.com/products/app-platform/reference/buildpacks/nodejs/)
