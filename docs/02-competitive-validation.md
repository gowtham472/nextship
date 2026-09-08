# Competitive validation: are we building the wrong product?

Written to answer one question: is nextship a duplicate of OpenNext, and if not, is
the space it occupies already served? The conclusion changes the positioning in
[`00-design.md`](./00-design.md) §14, so it is recorded here before any more code is
written.

Author: Gowtham
Date: 2026-09-06

---

## 1. Short answer

**We are not building OpenNext.** OpenNext and nextship sit at different layers, and
OpenNext is explicit about where it stops.

**But the product as specced is crowded, and the stated wedge is not a wedge.**
"Zero-config Next.js deployment to your own cloud" is served today by at least four
mature options. What is genuinely unsolved is one layer deeper, and it is the layer
our roadmap currently defers to Phase 3.

## 2. What OpenNext actually is

OpenNext is a **build-time translation layer**. It runs `next build` and transforms
the output into a shape a cloud can run. Its own documentation states the boundary
plainly:

> "It should be noted that OpenNext does not actually deploy the app. It only
> bundles everything for your IAC to deploy it."

There is no dashboard, no managed service, no provisioning. You bring SST, CDK or
Terraform to create the infrastructure. Its primary targets are AWS Lambda and
Cloudflare Workers. Its comparison table does not list a plain Node server or Docker
as native targets, although a Node server target is referenced elsewhere in its
documentation, so this needs first-hand verification before we rely on either claim.

### Where the layers sit

```
  Framework build output          next build
        │
  ┌─────▼──────────────────┐
  │ ADAPTER / TRANSLATION   │   OpenNext, official Adapter API, our adapter
  └─────┬──────────────────┘
        │
  ┌─────▼──────────────────┐
  │ PROVISIONING / IaC      │   SST, CDK, Terraform, Pulumi
  └─────┬──────────────────┘
        │
  ┌─────▼──────────────────┐
  │ LIFECYCLE / CONTROL     │   Flightcontrol, Amplify, Coolify, Dokploy, Vercel
  │ previews, rollback,     │
  │ domains, logs, teams    │
  └─────┬──────────────────┘
        │
  ┌─────▼──────────────────┐
  │ RUNTIME CORRECTNESS     │   mostly nobody, outside Vercel
  │ shared cache, tag       │
  │ coordination, atomic    │
  │ HTML+RSC invalidation   │
  └────────────────────────┘
```

nextship as specced spans the middle two layers. OpenNext occupies only the top one.
So the duplication concern is unfounded on its own terms.

## 3. The real problem: the middle layers are occupied

| Option | What it does | Where it runs | Gap it leaves |
|---|---|---|---|
| **OpenNext + SST** | Translation plus IaC. "Deploy to your AWS in 3 commands." Also supports Next.js in a container on ECS Fargate. | Your AWS | You own an IaC codebase. Serverless-shaped. AWS only. |
| **Flightcontrol** | Vercel-like dashboard, git-driven, deploys into **your own AWS account**. $49/mo starter, $249/mo for preview environments and multi-region. | Your AWS | AWS only. Paid. Closed. |
| **AWS Amplify Hosting** | Managed Next.js hosting from git, first-party. | AWS (managed) | Reported gaps in advanced Next.js features. AWS only. |
| **Coolify / Dokploy** | Open source, git push, automatic SSL through Traefik, dashboard, Docker containers. The two leaders of the "done with Vercel" market. | Your VPS | You bring and run the server. Single-box shaped. Next.js correctness is not their concern. |
| **DigitalOcean App Platform** | Detects Next.js through the Node buildpack and builds from git with no configuration. A 2026 review reports ISR and image optimization working out of the box. | DigitalOcean | Needs first-hand verification. If accurate, the DO half of our wedge is already filled by DO itself. |

Read that table against our own pitch. "Vercel's zero-config experience in your own
AWS or DigitalOcean account" describes Flightcontrol for AWS, App Platform for DO,
and Coolify for anyone with a VPS. Our v1 differentiator, as written in
[`00-design.md`](./00-design.md) §14, is **portability across clouds under one tool**,
and portability alone is not something teams buy. Nobody picks a deployment tool
because it also supports a cloud they are not using.

**Verdict on the current spec: correct engineering, weak positioning.**

## 4. What is genuinely unsolved

The gap is not deployment. It is Next.js behaving correctly once there is more than
one instance, and it is documented by every party involved.

**Next.js itself** states that `revalidateTag()` on one instance invalidates only
that instance, and that other instances keep serving stale content until they
independently discover the invalidation. Coordinating requires implementing
`refreshTags()` against shared storage.

**The obvious workaround does not work.** Sharing a filesystem volume between
replicas is insufficient, because Next.js keeps an in-memory LRU on top of the
filesystem cache, so a shared disk does not clear the other instances' memory. This
matters because a shared volume is precisely the advice the self-hosted PaaS
ecosystem gives: Coolify's Next.js guidance is to mount `.next/cache` to a named
volume, which is correct for one replica and wrong for two.

**OpenNext documents the same class of failure** in its own limitations: with ISR,
the data payload (JSON or RSC) and the HTML "might be out of sync," and on-demand
revalidation requires manual CDN invalidation. That is the atomic HTML plus RSC
problem from the research (`./private/vercel-nextjs-platform-research.md` §2.4, §3), still
open in the most mature translation layer in the ecosystem.

**And nobody has proven correctness.** As of now only **Vercel and Bun** have
verified adapters that run the official Next.js compatibility suite. Netlify,
Cloudflare and AWS adapters are being built in a shared monorepo and are expected by
the end of 2026. No self-hosting tool publishes suite results at all.

So the unoccupied position is not "easier deploys." It is:

> **Next.js that stays correct when you scale it, on infrastructure you own,
> with published proof.**

## 5. What this changes

### 5.1 The roadmap is upside down

Phase 3 (shared cache, distributed tag coordination, atomic HTML and RSC writes,
request collapsing) is currently deferred until "real users hit the ceiling of one
instance." That phase **is the product**. Phase 1 is table stakes that four other
tools already ship.

This does not invalidate Phase 1 work. The detect, build and package pipeline is
still needed, and D3 (containers everywhere) and D4 (correct-first) remain sound.
What changes is what we build immediately after it, and what we say the product is for.

### 5.2 The adapter is not a moat

Once OpenNext ships verified adapters for AWS and Cloudflare, maintaining our own
translation layer is a cost with no return. Our adapter should stay deliberately
thin, and we should plan to consume the official or OpenNext adapters where they fit.
The defensible work is the runtime correctness layer, not the build translation.

### 5.3 Two honest strategic options

**Option A: correctness layer first.** Build the shared cache handler, tag
coordination, atomic HTML and RSC invalidation and request collapsing as a portable
package that works on ECS, App Platform, Kubernetes, Coolify and Dokploy. Prove it
with published compatibility suite results. Smaller surface, sharper claim, and it
composes with the tools that already own the deploy step rather than fighting them.
Weaker as a standalone business; strong as the thing a platform is built on.

**Option B: platform, repositioned.** Keep the full CLI and control plane, but lead
with correctness rather than convenience: "the self-hosted Next.js platform that is
actually correct at scale, and publishes the test results to prove it." Bigger build,
competes directly with Flightcontrol and Coolify, and needs the correctness layer
anyway to have anything to say.

Both require the same core engineering. The difference is what ships first and what
the README promises.

## 6. Open items requiring first-hand verification

Two claims in this document come from secondary sources and change the analysis if
wrong:

1. **DigitalOcean App Platform ISR support.** If ISR and image optimization genuinely
   work with no configuration, the DO half of the original wedge is filled by DO.
   Verify by deploying a Next.js app with a `revalidate` route and an on-demand
   `revalidateTag` call, at one instance and at two.
2. **OpenNext's Node server and container targets.** Determines whether OpenNext is a
   component we can adopt for the container path or only for the serverless path.

## Sources

- [OpenNext comparison](https://opennext.js.org/aws/comparison)
- [OpenNext](https://opennext.js.org/)
- [3 Years of OpenNext](https://opennext.js.org/news/2026-03-25-3-years-of-opennext)
- [Next.js: Deploying to platforms](https://nextjs.org/docs/app/guides/deploying-to-platforms)
- [Next.js: Self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Next.js: How revalidation works](https://nextjs.org/docs/app/guides/how-revalidation-works)
- [Next.js across platforms: adapters, OpenNext, and our commitments](https://nextjs.org/blog/nextjs-across-platforms)
- [Netlify: the Next.js adapter API just shipped](https://www.netlify.com/blog/the-next-js-adapter-api-just-shipped-here-s-what-comes-next/)
- [Fixing Next.js ISR revalidation across Kubernetes replicas](https://strapi.io/blog/fixing-isr-revalidation-across-kubernetes-replicas-on-strapi)
- [Horizontal scaling with a custom Redis cacheHandler (discussion)](https://github.com/vercel/next.js/discussions/91824)
- [SST: Next.js on AWS](https://sst.dev/docs/start/aws/nextjs/)
- [Flightcontrol vs Vercel](https://getdeploying.com/flightcontrol-vs-vercel)
- [PaaS showdown: Flightcontrol, Vercel, Railway, Render, Fly.io](https://platformengineeringplaybook.com/blog/2025-10-paas-showdown-flightcontrol-vercel-railway-render-fly/)
- [Coolify vs Dokploy comparison](https://lumadock.com/tutorials/coolify-vs-dokploy)
- [Deploy Next.js on Coolify](https://lumadock.com/tutorials/deploy-nextjs-on-coolify)
- [DigitalOcean: Node.js buildpack](https://docs.digitalocean.com/products/app-platform/reference/buildpacks/nodejs/)
- [DigitalOcean App Platform review 2026](https://ghostlyinc.com/en-US/digitalocean-app-platform-test-review/)
