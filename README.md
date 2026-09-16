<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/nextship-dark.png">
    <img src="brand/nextship.png" alt="nextship" width="320">
  </picture>
</p>

# nextship

[![ci](https://github.com/gowtham472/nextship/actions/workflows/ci.yml/badge.svg)](https://github.com/gowtham472/nextship/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/nextship-cli)](https://www.npmjs.com/package/nextship-cli)

**[Documentation](https://nextship.doodlebytestudio.in/docs)** and a [quick start](https://nextship.doodlebytestudio.in/docs/quick-start).

> Vercel's zero-config experience, in your own DigitalOcean account.
> Your code, your data, your bill, your region.

nextship takes a Next.js app and puts it on infrastructure you own, with no
Dockerfile, no `next.config.js` edits, no Terraform and no IAM archaeology. It runs
on your machine or in CI, uses your cloud credentials, and never sends your code
anywhere. Every Next.js feature keeps working, because the thing running in the
container is the Next.js server itself.

```bash
nextship deploy --yes
```

That command builds your app inside Docker, prunes the result to the files Next.js
says it needs, pushes the image to your registry, releases it, waits for it to go
live, and prints the URL.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="site/public/media/deploy-final.svg">
  <img src="site/public/media/deploy.svg" alt="A recording of nextship detect, then nextship deploy --yes: the plan, the build, the push to the registry, App Platform bringing the app live, and the URL it serves on." width="760">
</picture>

One uncut recording of a real deployment, 98 seconds shown in 43. Pauses over two seconds
are shortened and nothing else is edited;
[`deploy.cast`](./site/public/media/deploy.cast) keeps the real timings. The app was
destroyed afterwards, so its URL no longer serves.

---

## Status

**Version 1.0.2, for Next.js on DigitalOcean.** Verified against live App Platform deployments, including streaming through App Platform itself, and deployed from both Windows and an Apple Silicon Mac. Next is v1.1, a target for any Linux server reached over SSH, built on `feat/vm-target` and not released until it has run on real providers.

| Area | State |
|---|---|
| Local pipeline: `detect`, `build`, `package`, `run` | Done. Verified on a real production project and a purpose-built feature app |
| DigitalOcean deployment: `deploy`, `rollback`, `logs` | Done. Verified against a live app, including two rollbacks in opposite directions, and deployed from an Apple Silicon Mac (M3 Max) with 0.4.4 from npm, on the second attempt |
| Any Linux server over SSH | v1.1, built and not released. `server add`, deploy, rollback and every day-two command pass end to end against a local Ubuntu 24.04 test server over SSH; not yet run on a real provider. See [`docs/vm.md`](./docs/vm.md) |
| AWS | On demand, after a streaming experiment on Lightsail. The server target already runs on EC2 |
| Official Next.js adapter compatibility suite | Passes in full on 16.4.0-canary.22: 1123 of 1123 suites and 3599 of 3599 assertions, with 9 Vercel-specific tests skipped and each reason published. See the results below |

Verified on real containers: every route serves, image optimization produces WebP,
streaming does not buffer (27 ms to first byte against a 2.02 s total), ISR works
both time-based and on-demand, Server Actions execute, `after()` runs, and Edge runtime
routes run in Next.js's Edge runtime inside the server. Through App Platform's CDN,
on-demand revalidation needs a revalidate time on the page, as the limitations below say. The image
is 591 MB uncompressed against 1.13 GB before pruning.

**It was built for its author's own apps, and it works for yours** if you deploy
Next.js to DigitalOcean and one instance is enough. Everything that only matters once
many people depend on it, multiple instances above all, is recorded in
[`docs/roadmap.md`](./docs/roadmap.md) under "Beyond v1.0", each with the trigger that
would justify building it.

**v1.0 is DigitalOcean only.** That is the target that is built, verified against a live
app, and actually used. A second cloud is built on the proven one rather than beside it,
so the next target, any Linux server over SSH, follows as v1.1.

---

## Requirements

| Requirement | Why | Enforced |
|---|---|---|
| **Node.js 22 or newer** | Runs the CLI | Declared in `engines`, so your package manager warns or refuses |
| **Docker 23 or newer** | Every build runs inside BuildKit, so nothing is compiled on your machine | Yes. nextship queries the daemon and refuses older versions by name |
| **Next.js 16.2 or newer** | The Deployment Adapter API became stable in 16.2 | Yes, with the reason in the error |
| **A DigitalOcean API token** | Only for the commands that read or change your account | Yes, the error names the variable |
| **For a server:** an OpenSSH client, and an Ubuntu 22.04, Ubuntu 24.04 or Debian 12 server you can reach as root or as a user with passwordless sudo | `server add` runs setup over SSH as root | Yes. `server add` refuses any other distribution, under 1 GB of RAM, under 5 GB of free disk, or with ports 80 or 443 already in use, and names which |

Docker must be running. The local commands need nothing else.

## Install

```bash
npm install -g nextship-cli
```

The package is `nextship-cli` and the command is `nextship`. npm refuses the name
`nextship` because an unrelated package called `next-ship` already exists and its
similarity check does not distinguish the two.

Or build from source, which puts the same binary on your PATH:

```bash
git clone https://github.com/gowtham472/nextship.git
cd nextship
pnpm install && pnpm build
cd packages/cli && npm link && cd ../..
```

Before trusting it with a cloud account, read
[what it has access to](./SECURITY.md#what-this-tool-has-access-to). It is short, and it
is the honest answer to "what does this thing do with my token".

## Quick start

```bash
cd your-nextjs-app

nextship detect            # what nextship reads from this project
nextship doctor            # what changes when this app leaves Vercel
nextship run               # build, package and start it locally on :3000

export DIGITALOCEAN_TOKEN=dop_v1_...
nextship deploy            # print the plan, change nothing
nextship deploy --yes      # execute it
```

`deploy` prints a plan and stops. Nothing is created, changed or charged until you
pass `--yes`.

Tried it? A [first deploy report](https://github.com/gowtham472/nextship/issues/new?template=first_deploy.yml) takes two minutes, whether it worked or not.
Every verification so far was run by the people who wrote nextship, so how it goes on
your machine is the most useful thing anyone can report.

---

## Commands

```
nextship detect     Report what nextship reads from this project
nextship build      Build in Docker with the adapter injected, export the manifest
nextship package    Build, then produce the runtime image
nextship run        Package, then run the image locally
nextship doctor     Report what changes when this app leaves Vercel
nextship deploy     Show the deployment plan; add --yes to execute it
nextship rollback   Return to a previous deployment; add --yes to execute it
nextship logs       Runtime logs for the deployed app; --follow to stream
nextship env        List the runtime environment variables set on the app
nextship env push   Upload this project's env files as runtime variables
nextship env rm     Remove named variables from the app
nextship domain     List the domains attached to the app
nextship domain add Attach a domain and print the DNS record to create
nextship domain rm  Detach a domain
nextship images     List the images pushed for this project
nextship images prune  Remove old images, keeping the recent ones
nextship destroy <name>  Destroy the app this project created
nextship server add <user@host[:port]>  Prepare a Linux server and record it as the target
nextship server status  The server, every app on it, and what needs attention
nextship server reboot  Reboot the server and wait for every app to come back healthy
nextship server move <user@host[:port]>  Move this project's app to another server

  -h, --help        Show usage
  -v, --version     Show the version
```

Every stage is its own command, so a failure can be re-run in isolation without
repeating the stages that already succeeded. `build` and `package` are two targets of
one Dockerfile, so `package` reuses the compile from cache rather than starting over.

Unknown commands and unknown flags are errors. A mistyped option never gets silently
ignored.

`nextship` on its own draws the wordmark and points to `detect` and `--help`, in any
terminal at least 72 columns wide: in truecolor, 256 or 16 colours as the terminal
supports, and without colour under `NO_COLOR`. Piped, or in a narrower window, it prints
the usage above, so a script sees the text it always has.

### `nextship detect`

Reads the project and reports what every later stage will act on. Runs no build and
writes nothing.

```
> Inspecting project
v acme-web is a Next.js 16.2.9 project
  root          C:\Users\you\projects\acme-web
  package mgr   pnpm
  build command pnpm run build
  node          24
  sharp         0.34.5
  env files     none
```

Everything reported is read from disk rather than from what `package.json` declares,
including packages your package manager installed transitively. A project with no env
files says so instead of leaving you to guess.

In a workspace it also reports the workspace root and the app directory, because the
image is built from the workspace root where the lockfile and sibling manifests live.

### `nextship build`

Runs your own `build` script inside a Docker builder stage with the adapter injected
through `NEXT_ADAPTER_PATH`, then exports the manifest the adapter wrote to
`.nextship/output/manifest.json`.

Your `next.config.js` is never edited. Dependencies are installed inside the image,
so `next`, `sharp` and every native module are built for Linux regardless of the
machine you are on.

If the manifest comes back without the deployment id the adapter was given, the build
fails as a nextship defect rather than shipping something unverified.

### `nextship package`

Builds, then assembles the runtime image: a second stage that copies only the files
Next.js's own trace output lists, plus a generated launcher equivalent to the one
standalone mode writes.

```
v Image ready: acme-web:dpl-2b2c3e535f1e-4456a8b2
  platform   linux/amd64
  start it with: nextship run
```

The tag is the deployment id, derived from the build's content: the nextship version,
the generated Dockerfile, the adapter and prune script, the Server Actions key, and
the name and contents of every env file. Change any of them and the tag changes, which
is what stops an edited env file from shipping under a tag that already exists.

When the working tree is not a clean commit, the id is unique to that build instead,
and `build` says so rather than implying reproducibility it cannot provide:

```
  deployment dpl-2b2c3e535f1e-ebee628b
  this id is unique to this build, because the source is not a clean commit
```

The image is always built for `linux/amd64`, so an Apple Silicon machine cannot
produce an image the cloud target refuses to run.

### `nextship run`

Packages the project and starts the image locally on port 3000, loading your
highest-precedence env file so secrets stay outside the image. This exists so the
artifact can be verified before any cloud account is involved.

Runs attached with `--rm`. Ctrl+C stops and removes the container, so there is no
background state to clean up. A stop is reported as a stop, not as a failure: exit
130 for Ctrl+C and 143 for `docker stop` are the codes Next.js exits with after
draining connections.

### `nextship doctor`

Reports what changes when an app leaves Vercel. Most of these never stop a build, which
is exactly why they are worth surfacing: no error reveals them. The exception is a package
installed in `node_modules` that nothing declares, which fails the build in the image and
is reported as a blocker.

| Checked | Why it matters |
|---|---|
| `@vercel/analytics` and similar packages | They stop reporting and nothing errors |
| Cron jobs in `vercel.json` | They will simply never run |
| Routing rules in `vercel.json` | They stop applying |
| `VERCEL_URL` and `VERCEL_ENV` read in source | They become undefined |
| Packages in `node_modules` that nothing declares | They exist on your machine and not in the image, so the build fails on an import that resolves locally |
| A missing lockfile | Installs are no longer reproducible |
| The ISR cache not surviving a restart | Recorded so it is known before deploying, not after |

Findings are sorted with blockers first, and each one carries a consequence and an
action rather than only a name.

### `nextship deploy`

Builds, pushes and releases to DigitalOcean App Platform.

| Option | Default | Meaning |
|---|---|---|
| `--yes` | off | Execute the plan. Without it, `deploy` only prints the plan |
| `--target <id>` | `digitalocean` | Which target a project with no `nextship.json` deploys to. Refused when it disagrees with the recorded one |
| `--region <slug>` | `blr` | App Platform region. Recorded in `nextship.json` on the first deploy and reused after that |
| `--size <slug>` | `apps-s-1vcpu-0.5gb` | App Platform instance size |
| `--registry <name>` | the app name | Container registry name, which must be unique across all of DigitalOcean |

The plan is printed first, every time:

```
> Plan
  target        DigitalOcean, region blr
  registry      use existing "acme-registry", unchanged
  repository    acme-registry/acme-web
  app           UPDATE "acme-web" (1a2b3c4d), which nextship created
  instance      apps-s-1vcpu-0.5gb, 1 instance
  untouched     4 existing app(s) in this account
  nothing is ever deleted by this command
```

`nextship.json` is written before the wait for the deployment begins, so a timeout
still leaves the app recorded as yours rather than orphaned and unadoptable on the
next run.

A container registry region is not the same namespace as an App Platform region: the
app region `blr` corresponds to the registry region `blr1`. nextship matches them, and
if no registry region corresponds to your app region it says so and lists the ones
that exist instead of creating something in the wrong place.

#### Deploying to a server

For a project recorded by `nextship server add`, `deploy` builds the image and runs it on
that server behind Caddy.

| Option | Default | Meaning |
|---|---|---|
| `--build <mode>` | `remote` | `remote` builds on the server's own Docker, reached through an SSH forward of its socket, so nothing but the build context leaves your machine and the image is built natively for the server. `local` builds here for the server's architecture and streams the image with `docker save \| ssh docker load`. Recorded in `nextship.json`. A server under 2 GB of RAM is refused for remote builds |
| `--memory <size>` | an even share of 80% of RAM across the server's apps | The container's memory limit, such as `512m` |

```
> Plan
  target        your server 203.0.113.10, arm64, Docker 29.8.0
  build         on the server's Docker 29.8.0, for linux/arm64, over SSH
  image         kept on the server as acme-web:<deployment id>
  app           UPDATE "acme-web" (354832e1-3eab-4c38-ae2a-9cdad8e56b0f), which nextship created
  memory        up to 6268m of 7836 MiB
  address       http://203.0.113.10
  switch        Caddy moves traffic only once the new container is healthy; until then the current one serves
  caddy         the site is regenerated from the domains recorded for this app
  untouched     0 existing app(s) on this server
  removes images older than the newest 5 served deployments once this one is live; nothing else is deleted
```

A deployment starts a new container with no published port, waits for Docker to report it
healthy, then points Caddy at it and stops the previous one. Nothing a visitor sees
changes until the new container is healthy, so a deployment that fails leaves the previous
one serving, and a deployment that succeeds drops no request. Its last log lines are
printed when it fails. The first app deployed on a server answers `http://<server>`;
later apps answer nothing until `nextship domain add`.

The Server Actions key is kept on the server rather than in `.nextship/secrets.local.json`,
so every machine that deploys, including CI, builds with the same key. A key already in
your local file is copied to the server on the first deploy. If the server and your local
file hold different keys, `deploy` refuses rather than choosing one.

`rollback` on a server starts the earlier deployment's image again the same way. It uses
the current env file, not the one that deployment first ran with, and the plan says so.

### `nextship rollback`

Returns the app to a deployment that already ran. It builds nothing and pushes
nothing, so it cannot introduce a new fault.

| Option | Default | Meaning |
|---|---|---|
| `--yes` | off | Execute the plan. Without it, `rollback` only prints the plan |
| `--to <deployment>` | the previous live deployment | Roll back to a specific deployment id |

```
> Plan
  app        acme-web (1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d)
  current    dpl-2b2c3e535f1e-de39cb34  2026-09-08T08:58:51Z  (app spec updated)
  roll back  dpl-2b2c3e535f1e-715c3f77  2026-09-08T08:46:39Z  (initial deployment)
  no build, no push: this reuses an image that already ran
  nothing is deleted; the current deployment stays in the history
```

Without `--yes` it also lists the other deployments you could target with `--to`.

App Platform **pins** an app for the duration of a rollback, and a pinned app refuses
every further deployment until the rollback is committed or reverted. Leaving an app
pinned is the one way this command could cause lasting trouble, so the pin is
validated before it is taken, committed the moment the deployment reports active, and
reverted on every failure path in between. If the revert itself fails, nextship says
plainly that the app is still pinned and where to clear it, rather than hiding that
behind the original error.

Rollback targets are deployments that actually served traffic. A deployment that has
been replaced reports `SUPERSEDED`, not `ACTIVE`, and both are valid targets;
`ERROR`, `CANCELED` and in-progress deployments are not.

### `nextship logs`

Prints what the running container has written.

```
> Runtime logs for acme-web
web 2026-09-08T09:08:32.232594675Z Next.js 16.2.9
web 2026-09-08T09:08:32.233069121Z - Network:       http://0.0.0.0:3000
web 2026-09-08T09:08:32.233725936Z Ready in 0ms
```

| Option | Default | Meaning |
|---|---|---|
| `--follow` | off | Stream new output as it arrives instead of printing a snapshot and exiting |
| `--deployment <id>` | the running one | Server only: the logs of one deployment, including one that has been replaced. Takes a deployment id or the image tag plans show |

Without `--follow` this is a snapshot: what the container has buffered, then it exits.
With `--follow` it streams until you press Ctrl+C, which stops it cleanly rather than
killing it mid-line.

Neither is history. App Platform buffers only the container running right now, so a
deployment that has been replaced takes its output with it. When there is nothing
buffered, `logs` says so rather than implying the app printed nothing. Retaining
history means forwarding to an external service, which is not built: it needs a
destination and credentials that are yours to choose, so nextship would be guessing.

On a server, containers log to the journal, so history is kept:
`nextship logs --deployment dpl-1a2b3c4d5e6f-0a1b2c3d` reads a replaced deployment's
output until the journal, limited to 500M by `server add`, rotates it out.

### `nextship env`

Lists the runtime environment variables set on the app. Keys only: App Platform
stores them encrypted and will not return a secret's value to anyone, including you.

```
> Runtime environment for acme-web
  No runtime environment variables are set on this app.
  Values inlined at build time, such as NEXT_PUBLIC_*, still work. Anything read
  at request time is undefined. Run `nextship env push` to set them.
```

That distinction is the one to understand. Your env files are mounted as build
secrets and never enter an image layer, which is what keeps them out of the
registry, but it also means nothing survives to runtime. `NEXT_PUBLIC_*` values are
inlined during the build and keep working. A database URL read on each request does
not, until you push it.

### `nextship env push`

Uploads this project's env files as `RUN_TIME` variables.

The files are read by `@next/env`, the loader Next.js itself uses, so the values are
the ones the build saw. That is not a claim about care taken: a hand-written parser
here silently truncated a multi-line private key to its header line and mangled a
quoted value followed by a comment, and both deployed cleanly and failed at request
time. Using Next.js's own loader makes agreement structural.

`NEXT_PUBLIC_*` variables are stored readable, because they are compiled into the
JavaScript every visitor downloads and calling them secret would claim a protection
that does not exist. Everything else is stored encrypted. A push never weakens what is
already there: a variable already stored as a secret stays one, and an existing
broader scope is kept rather than narrowed.

| Option | Default | Meaning |
|---|---|---|
| `--yes` | off | Execute the plan. Without it, `env push` only prints the plan |

```
> Plan
  app        acme-web (1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d)
  source     .env.production
  add        DATABASE_URL, API_TOKEN
  update     none
  untouched  0 variable(s) already on the app
  all values are stored as App Platform secrets, encrypted and not readable afterwards
  nothing is removed; a variable this push does not mention keeps its current value
! These values leave your machine and are stored in your DigitalOcean account.
```

Keys and their classification are printed, values never are. A push adds and updates;
it does not remove, so a variable you set in the control panel survives a push that
does not name it. Use `nextship env rm` to remove one.

Because a stored secret is never returned, nextship cannot tell whether a value you
are pushing differs from the one already there, so a push always starts a new
deployment. When every key in a push is already set, it says so before you confirm.

**This is deliberately not part of `deploy`.** A local `.env` usually holds
development values, and shipping those to production as a side effect of deploying
is a failure that looks like a successful deploy. `deploy` warns in its plan when a
project has env files but the app has no runtime environment, and leaves the
decision to you.

### `nextship env rm <KEY>...`

Removes named variables from the app.

| Option | Default | Meaning |
|---|---|---|
| `--yes` | off | Execute the plan. Without it, `env rm` only prints the plan |

Every key must be named. There is no wildcard, no prefix match and no `--all`, because
the blast radius of a mistyped pattern here is a production outage. If any named key is
not set, the whole command refuses and changes nothing, rather than removing the
others and reporting partial success. A removed secret cannot be recovered, since App
Platform will not return its value.

### `nextship domain`

Lists the domains attached to the app, with the state App Platform reports for each.

```
> Domains for acme-web
  platform   acme-web-a1b2c.ondigitalocean.app  (always works, managed by App Platform)
  app.example.com  primary  being set up; serves once DNS points here and a certificate is issued
v 1 custom domain(s).
```

### `nextship domain add <domain>`

Attaches a domain and prints the DNS record you need to create.

| Option | Default | Meaning |
|---|---|---|
| `--yes` | off | Execute the plan. Without it, `domain add` only prints the plan |
| `--primary` | off | Make it the app's main address. The first custom domain is primary anyway |
| `--min-tls <1.2\|1.3>` | `1.2` | Minimum TLS version clients may use |

```
> Create this DNS record
  type    CNAME
  name    app.example.com
  value   acme-web-a1b2c.ondigitalocean.app
```

**nextship does not touch DNS, deliberately.** Editing DNS needs a token scope beyond
what deploying requires, and a tool with that scope can break every other service on a
domain, not just the app it was pointed at. So the record is printed and creating it
stays your decision. TLS is then automatic: App Platform issues and renews the
certificate once the record resolves, and there is nothing to configure.

Two consequences worth knowing. The first custom domain becomes the app's primary
address whatever you asked for, because App Platform promotes it; the plan says so.
And once a domain is primary it becomes the app's reported URL, so `deploy` and
`rollback` report the platform hostname as well, since that one always answers while a
custom domain does not until its record exists.

### `nextship domain rm <domain>`

Detaches a domain. The DNS record is left alone, because nextship did not create it,
and the command says to remove it yourself.

### `nextship images`

Lists the images pushed for this project and what each one is for.

```
> Images for acme-registry/acme-web
  dpl-2b2c3e535f1e-ebc1a38e  2026-09-08T10:10:01Z  deployed now
  dpl-2b2c3e535f1e-de39cb34  2026-09-08T08:58:48Z  kept for rollback
  orphaned   3 image(s) no tag points to, up to 181.9 MiB
  storage    390.2 MiB used in the registry, across every repository
v 2 image(s).
```

Storage is reported for the registry rather than per image, because a per-image figure
would be fiction: a tag is an index of a few kilobytes, its content lives in child
manifests the API lists separately, and layers are shared between images, so no
per-image number adds up to the total.

### `nextship images prune`

Removes old images so registry storage stops growing without bound. Rollback is the
reason images are kept at all, so this is a decision about how far back you can go.

| Option | Default | Meaning |
|---|---|---|
| `--yes` | off | Execute the plan. Without it, `prune` only prints the plan |
| `--keep <n>` | `5` | How many images to keep. The deployed one is always kept as well |
| `--gc` | off | Start garbage collection, which is what actually reclaims storage |

Two facts make this harder than it looks, and both were measured rather than assumed.

**Deleting a tag reclaims nothing.** The manifest survives untagged and keeps
referencing its layers, so garbage collection finds nothing unreferenced. Measured
here: deleting a tag and running collection to completion freed 0 bytes and deleted
0 blobs.

**But deleting untagged manifests destroys running deployments.** A tag points to an
OCI index whose platform manifests the registry API also reports as untagged. On this
registry the live tag is a 3.9 KB index whose amd64 child is a 181.9 MiB manifest
listed as untagged, so the cleanup most scripts perform deletes the image the app is
running.

So retention works on reachability. The tags being kept are roots, everything they
reference is kept with them, and only manifests no retained tag can reach are deleted.
Indexes are deleted before the images they point at, because the registry refuses to
remove a manifest another manifest still references.

The image the app is currently deployed from is never pruned, whatever `--keep` says.
Removing it would leave an app that runs until something reschedules it and then cannot
start.

Garbage collection is what frees the layers. It puts the registry into read-only mode
while it runs, so a deploy that overlaps it fails to push. That is why it is never
implicit in a deploy, and why `--gc` works on its own as well as after a prune.

### `nextship destroy <app-name>`

Removes the app this project created, and nothing else.

| Option | Default | Meaning |
|---|---|---|
| `--yes` | off | Execute the plan. Without it, `destroy` only prints the plan |
| `--images` | off | Also remove this project's images, then start garbage collection |

**The app name is required**, and this is the only command that asks for one. Every
other command acts on whatever directory you are in, which is fine when nothing can be
destroyed. Here it is not: `--yes` typed in the wrong project would remove the wrong
app. Naming it means the mistake has to be made twice and agree with itself.

```
> Plan
  app        DESTROY "acme-web" (1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d)
  address    acme-web-a1b2c.ondigitalocean.app stops serving and is not reissued
  domain     app.example.com stops serving this app
  images     kept in acme-registry; run `nextship images prune --gc --yes` first if you want them gone
  registry   kept, it is shared by every project on this account
  DNS        untouched, nextship did not create your records
  untouched  3 other app(s) in this account
```

What it deliberately leaves alone: the container registry, which every project on the
account shares, and your DNS records, which nextship did not create.

The generated hostname is not reissued. A replacement app gets a new random suffix, so
if a custom domain points at the old one, its DNS record has to be updated. `destroy`
warns about this by name before it runs.

Afterwards `nextship.json` keeps your settings but no longer records an app, so the
next `deploy` creates a fresh one rather than refusing.

### `nextship server add <user@host[:port]>`

Prepares a Linux server to run this project and records it in `nextship.json` as the
project's target. It works on any Ubuntu 22.04, Ubuntu 24.04 or Debian 12 server you can
SSH into: a Hetzner or Hostinger VPS, a DigitalOcean Droplet, EC2, Compute Engine, an
Azure VM or your own hardware.

| Option | Default | Meaning |
|---|---|---|
| `--yes` | off | Execute the plan. Without it, `server add` only prints the plan |
| `--no-firewall` | off | Leave ufw as it is |
| `--no-auto-updates` | off | Do not enable unattended security updates |
| `--no-swap` | off | Do not add a 2 GB swap file on a server with under 4 GB of RAM |
| `--no-ssh-hardening` | off | Leave password logins and root login as they are |

The plan shows the server's host key fingerprint before anything trusts it. Compare it
with the one your provider shows. From then on the key is pinned in `nextship.json`, and a
server presenting any other key is refused.

```
> Checking 203.0.113.10
> Plan for 203.0.113.10
  server        root@203.0.113.10:22
  host key      ssh-ed25519 SHA256:YrbhoPLtpPr48BI8g70C+hbCmMMSZBOCv009n/FJyiY, trusted from now on if you continue
  os            ok     ubuntu 24.04
  arch          ok     arm64
  resources     ok     7836 MiB RAM, 1023 MiB swap, 827 GB free
  ports         ok     80 and 443 are free for Caddy
  docker        CHANGE install Docker CE from Docker's apt repository
  user          CHANGE create the nextship user in the docker and systemd-journal groups
  ...
  ssh-hardening CHANGE turn off password logins and allow root by key only
```

With `--yes` it installs Docker CE if the server has none, creates a `nextship` user and
proves a login as that user from your machine, runs Caddy on ports 80 and 443, limits the
journal, enables security updates and ufw, installs a watchdog for containers that stay
unhealthy, and turns off SSH password logins last. Every later command connects as
`nextship`. Running it again against a server that is set up changes nothing; running it
from a second project records the same server for that project. Each step is described in
[`docs/vm.md`](./docs/vm.md).

Membership of the `docker` group is root-equivalent, and the plan says so: whoever can log
in as `nextship` controls the server.

Then `nextship deploy` deploys to that server. See [Deploying to a server](#deploying-to-a-server).

### Day-two commands on a server

`env`, `domain`, `images`, `logs`, `rollback` and `destroy` work on a server project with
the same flags and plans, and differ where a server does:

| Command | On a server |
|---|---|
| `env push`, `env rm` | Rewrite `/etc/nextship/apps/<name>/env` (mode 0600) over SSH stdin, then start the live image again with the zero-downtime sequence. Values are readable by the server's root and `nextship` users, and the plan says so. A value with a line break is refused |
| `domain add` | Records the domain, regenerates the app's Caddy site (validated, restored if the reload fails), and prints an `A` record for the server's address, plus an `AAAA` note when the server has IPv6. The plan warns when the domain does not resolve to the server yet. Caddy requests the certificate once it does, and `nextship domain` reports it live only when the server presents a valid certificate for it |
| `images`, `images prune` | Images on the server, removed with their stopped containers and cache volumes; the live one is always kept. After every successful deployment images beyond the newest five served deployments are pruned automatically, since removing an image frees its space at once. `--gc` trims Docker's build cache to 5 GB |
| `destroy` | Removes the app's containers, volumes, Caddy site and `/etc/nextship/apps/<name>`, and with `--images` its images. The server, Caddy, every other app and DNS are kept |
| `deploy` | Refuses when the server has under 3 GB free, naming `images prune` and `server status` |

### `nextship server status`

Reports the server and every app on it, from any project recorded on that server.

```
> Server 203.0.113.10
  os         Ubuntu 24.04.4 LTS, aarch64, up 1 hour, 6 minutes
  reboot     not required
  load       0.50 0.76 0.74
  memory     6124 MiB available of 7836 MiB
  disk       821.1 GB free of 910.7 GB
  docker     29.8.0
  caddy      v2.10.2
  setup      version 1
> Apps on 203.0.113.10
  acme-web  (this project)
    live       r20260914-193222-9696df
    container  running healthy, 0 restart(s), memory 110.2MiB / 6.121GiB
    domains    app.example.com (certificate live)
v Nothing needs attention.
```

It warns when the server has under 3 GB free, when a container other than Caddy publishes
a port (which Docker opens past ufw), when setup is older than this nextship's, when a
reboot is needed, and when a live app is not running healthy.

### `nextship server reboot`

Reboots the server and waits until every container that was running before is back and
healthy, for up to 10 minutes. It is the proof that a reboot, such as one security updates
need, brings every app back on its own: containers restart unless stopped, Docker and Caddy
start at boot, and the watchdog timer resumes. Every app on the server is down while it
reboots, and the plan says so. `--yes` executes it.

### `nextship server move <user@host[:port]>`

Moves this project's app to another server: sets the new server up as `server add` does,
copies the app record, its domains, the env file and the Server Actions key in memory over
SSH, streams the live image from the old server, deploys it on the new one, and records
the new server in `nextship.json` only once the app is healthy there. The old server is only
read, and keeps serving until you destroy the app there. Deployment history, older images
and the cache volumes are not copied. The DNS records to change are printed at the end.
It takes the same options as `server add`.

### Planned

v1.0 is complete. Next is v1.1, one target for any Ubuntu or Debian server reached over SSH,
which is where the claim that this ports beyond DigitalOcean is either proven or shown to
cost more than it looked.
See [`docs/roadmap.md`](./docs/roadmap.md), which also records what is
deliberately not being built and why.

---

## Safety

nextship runs against accounts with other things on them, so its guarantees are
structural rather than advisory:

- **Only `destroy` removes infrastructure**, it names the app it will remove, and it
  refuses unless you type that name back. It never touches the registry or your DNS.
- **Everything else deletes nothing, or one named thing behind `--yes`**: a
  configuration value with `env rm`, a domain attachment with `domain rm`, an
  unreachable image with `images prune`. No command removes an app as a side effect of
  doing something else.
- **`deploy` and `rollback` do nothing without `--yes`.** They print a plan and stop.
- **Only the app recorded in `nextship.json` is ever modified.** That file's `appId`
  is the ownership record.
- **An app that merely shares a name is refused, not adopted.** On an account running
  other services, a name collision is exactly where guessing does damage.
- **A recorded app that no longer exists is an error**, not an invitation to create a
  replacement.
- **A deploy never drops settings it does not manage.** The existing app spec is
  read first and used as the base, so custom domains, ingress rules, alerts,
  environment variables and any component you added by hand survive an update.
- **`env push` adds and updates, never removes.** A variable it does not mention
  keeps its current value.
- **A failed deployment leaves the previous revision serving.** Nothing is rolled back
  or deleted automatically.
- **A change never lands on top of one still in progress.** `deploy`, `env push`,
  `env rm`, `domain add` and `domain rm` refuse while the app has an unfinished
  deployment, and `deploy` checks before it spends time building. `rollback` is
  exempt: it is how you get away from a bad deployment, so App Platform's own rollback
  validation decides.
- **Waiting has a deadline.** `deploy` stops waiting after 15 minutes and `rollback`
  after 10, saying the deployment may still succeed. Nothing is cancelled, rolled back
  or deleted when it stops waiting.
- **Secrets never enter an image layer.** Env files, the Server Actions key, and
  `.npmrc` and `.yarnrc.yml`, which can hold a registry token, are BuildKit secret mounts,
  which BuildKit deliberately excludes from cache keys.
- **The registry token never reaches a command line.** It is written to a temporary
  Docker config directory with `0600` permissions instead of being passed as an
  argument, where any other process on the machine could read it.
- **Log proxy URLs are treated as secrets**, because they embed an access token. They
  never appear in output or in an error message.

On a server:

- **`server add` changes nothing without `--yes`**, and its plan lists every step that
  would change.
- **The host key is pinned.** Its fingerprint is shown before it is trusted, and every
  later connection uses strict checking against the key in `nextship.json`. A changed key
  is a hard error with instructions to re-verify it through your provider, never a prompt.
- **SSH runs in batch mode, without passwords, through your own `ssh`.** nextship never
  reads a private key, and no command string is interpreted by a shell on your machine.
  Every value placed in a remote command is validated or quoted.
- **You cannot be locked out by setup.** A login as the new `nextship` user is proven from
  your machine before anything depends on it, and SSH hardening runs last, after that.
- **Setup refuses rather than overrides.** An unsupported distribution, a Docker older than
  23, too little memory or disk, or another process on ports 80 or 443 stops it by name.

## Configuration

### `nextship.json`

Written by `deploy`, committed to your repository, and holding no secrets:

```json
{
  "version": 1,
  "target": "digitalocean",
  "region": "blr",
  "name": "acme-web",
  "registry": "acme-registry",
  "appId": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
}
```

For a project on a server, `server add` writes version 2 of the file, with the server and
its pinned host key. A DigitalOcean project stays at version 1:

```json
{
  "version": 2,
  "target": "vm",
  "name": "acme-web",
  "server": {
    "host": "203.0.113.10",
    "port": 22,
    "user": "nextship",
    "hostKey": "203.0.113.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOAcvH/9nWZZCMAtztAmv9Rm8tknstGlFBaWtrS+QjI1",
    "arch": "arm64"
  }
}
```

Deleting it makes nextship forget which app it owns, after which it will refuse to
touch the existing one rather than guess.

### Environment variables

| Variable | Read by | Purpose |
|---|---|---|
| `DIGITALOCEAN_TOKEN` | `deploy`, `rollback`, `logs` | Your API token. See [`docs/digitalocean.md`](./docs/digitalocean.md) for the scopes it needs |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | `build`, `deploy` | Overrides the per-project key. Set this wherever else you build, so Server Actions keep working for clients served by builds made here |
| `NO_COLOR` | all | Disables colored output |

Your app's own env files are detected and mounted automatically, in the order Next.js
loads them for a production build. You do not list them anywhere.

### Files nextship writes

Everything is under `.nextship/` inside your project, plus `nextship.json`:

```
.nextship/
  .gitignore              contains "*", written before anything sensitive exists
  Dockerfile              generated, three stages
  Dockerfile.dockerignore generated, so your own .dockerignore is untouched
  build/                  the adapter and prune script copied into the build context
  output/manifest.json    what the adapter reported
  secrets.local.json      the Server Actions encryption key, never committed
nextship.json             committed, no secrets
```

Nothing else in your project is modified. `next.config.js` is never touched.

On a server, `server add` creates:

```
/etc/nextship/                          owned by nextship, mode 0700
  server.json                           the setup version that last ran
  apps/                                 one directory per app, written by deploy
  caddy/Caddyfile                       imports sites/*.caddy
  caddy/sites/                          one Caddy site per app
/usr/local/lib/nextship/watchdog.sh     restarts containers unhealthy for 3 checks in a row
/etc/systemd/system/nextship-watchdog.* the timer that runs it every minute
/etc/systemd/journald.conf.d/nextship.conf   SystemMaxUse=500M, only if no limit was set
/etc/ssh/sshd_config.d/10-nextship.conf      unless --no-ssh-hardening
/etc/apt/apt.conf.d/20auto-upgrades          unless --no-auto-updates
/swapfile                                    2 GB, only under 4 GB of RAM, unless --no-swap
user nextship, Docker network nextship, container nextship-caddy,
volumes nextship-caddy-data and nextship-caddy-config
```

`secrets.local.json` is not committed, so another machine or a CI runner will generate
a different key and break Server Actions for clients served by builds from here.
nextship warns about this the moment it generates one, and refuses to rotate a key
silently.

---

## What it handles for you

Things you would otherwise configure by hand, all inferred or applied automatically:

- Finds the project from any subdirectory, and the workspace root above it
- Reads the installed Next.js version, not the declared range, and refuses anything older than 16.2 with a reason
- Picks your package manager from the lockfile and reuses your own `build` script
- Handles pnpm, npm, yarn and bun, single packages and workspaces
- Injects the adapter without touching `next.config.js`
- Sets `deploymentId`, so clients on an old build hard-navigate instead of breaking after a deploy
- Keeps one Server Actions encryption key per project, and refuses to rotate it silently
- Mounts your env files, that key, and any `.npmrc` or `.yarnrc.yml` as build secrets, so none enters an image layer
- Installs dependencies inside the image, so `next`, `sharp` and every native module are built for Linux
- Copies only traced files, and never a dependency source map or development runtime: `node_modules` went from 469 MB to 58 MB on a real project
- Generates the same launcher standalone mode would, so `@next/swc` (125 MB) stays out and boot is instant
- Makes a redirect to the container's own address relative, so a route handler redirecting to `new URL('/login', request.url)` lands on your domain rather than `0.0.0.0`
- Runs as a non-root user under `tini`, with jemalloc for sharp and a `HEALTHCHECK`
- Points the platform health check at a route your build prerenders, so probing costs a file read rather than a render
- Disables proxy buffering, so streaming and PPR are not silently broken by the platform
- Builds for `linux/amd64` regardless of your machine's architecture
- Derives the image tag from the build's content, so changing an env file cannot ship the old value under an unchanged tag
- Keeps `.nextship/` out of git on its own, so the key cannot be committed

## Cost

Budget **$10 per month** to start on DigitalOcean: $5 for the smallest App Platform
instance and $5 for a Basic container registry. The free registry tier does not hold
enough for rollback to have anything to roll back to.

On your own server nextship adds nothing to what your provider charges for the server:
there is no registry, load balancer or managed service involved, and several apps can share
one server. What a suitable server costs depends on the provider and changes often, so no
price is quoted here. For a remote build, choose a server with at least 2 GB of RAM, or use
`--build local`.

A costed comparison against Vercel at three traffic tiers is in
[`docs/costs.md`](./docs/costs.md). The short version: DigitalOcean
egress is $0.02 per GiB against Vercel's $0.15 and up, and App Platform needs no load
balancer, which was the line item that made the AWS path cost more than Vercel at
small scale.

## Known limitations

The full table with consequences and status is
[`docs/design.md`](./docs/design.md) §12. The ones worth knowing before you
deploy:

- **On App Platform, the ISR cache does not survive a restart.** It lives inside the
  container, so every restart, redeploy and rescheduling starts cold. Optimized images
  share that directory and are re-generated too. Single-instance ISR is correct per
  process, which is not the same as durable. On a server it does survive: regenerated
  pages are kept in a volume per image and optimized images in a volume per app, so a
  restart keeps both and a new build starts with its own pages.
- **App Platform's CDN keeps fully static pages.** Next.js marks a page with no
  revalidate time cacheable for a year, and App Platform's Cloudflare edge honours it, so
  `revalidatePath` and `revalidateTag` update the container while visitors keep the old
  page. Give any page you revalidate on demand an `export const revalidate`; the edge then
  keeps it at most that many seconds. `nextship doctor` warns when your source revalidates
  on demand.
- **A route handler's `request.url` names the container, not your domain.** Next.js builds
  it from the address the server listens on, so behind a proxy it reads
  `https://0.0.0.0:3000/...`. A redirect built from it still works, because nextship
  makes it relative. Any other absolute URL built from it does not, such as a link in a
  response body or a callback URL handed to an OAuth provider: build those from your
  site's configured URL instead.
- **On App Platform, logs are not history.** `--follow` streams live output, but a
  replaced deployment still takes its past output with it. Retaining it needs forwarding
  to an external service, which is not built. On a server, output goes to the journal, so
  `logs --deployment` reads a replaced deployment's logs until the journal's 500M limit
  rotates them out.
- **A server is one server.** No failover: if it is down, every app on it is down. There
  is no CDN in front unless you add one, the operating system is yours to keep patched
  and rebooted, and backups are yours. The `nextship` user is root-equivalent. See
  [`docs/vm.md`](./docs/vm.md).
- **On a server, rollback uses the current env file.** Rolling back code does not roll
  back a variable changed since, which App Platform does.
- **On a server, only the first app deployed answers `http://<server>`.** Every other app
  answers only on the domains attached to it.
- **A server's env file cannot hold a value with a line break.** Docker reads it one line
  per variable, so `env push` refuses such a value rather than truncating it. Encode it,
  for example as base64.
- **Two changes written in the same instant can both be accepted.** Every command that
  changes the app refuses while a deployment is in progress, but two that write at
  exactly the same moment can both pass that check, and App Platform then keeps the
  later one.
- **`public/` ships inside the image**, 78 MB of it on the real project. The container
  serves it correctly; moving it to a CDN is a performance change, deferred to v5.
- **An app that prerenders nothing is health checked on a rendered route.** The path is
  chosen from the build's prerendered pages, never Next.js's internal ones, so most apps
  are probed on a page served from disk. With nothing prerendered, `/` is polled and
  renders every time.
- **Middleware, Cache Components and PPR are proven by the compatibility suite alone, and
  PPR barely.** In the full run, 481 assertions pass in suites named for middleware and 122
  in suites for Cache Components, in containers on the CI runner. Deploy mode skips most
  PPR tests, leaving 10. None has been exercised on a live App Platform app, and
  multi-instance behaviour is not tested at all.

## Architecture

```
your machine or CI                         your DigitalOcean account
detect -> build in Docker -> prune  ---->  container registry
          adapter injected                 App Platform runs next start
```

One image, one Node server, one lifecycle. DigitalOcean App Platform is the only target
today. Every platform-specific call sits behind a single driver interface, so a second
cloud is a new driver rather than a rewrite. Static files are served by the same
container; there is no CDN tier. DigitalOcean has no Lambda, so a serverless-first
design could not port there at all, and `next start` in a single process already
supports every Next.js feature correctly.

**v1 ships no custom router.** The Next.js server is the router: middleware, dynamic
segments, ISR lookup, the `rsc` and `_rsc` cache-key discipline, PPR resume, and image
optimization. The bugs that cost competitors years do not exist in this shape. The
adapter's job is zero-config correctness plus infrastructure inference.

### Why this is buildable now

Next.js 16.2 shipped a stable, public Deployment Adapter API, co-designed with
OpenNext, Netlify, Cloudflare, AWS and Google. Vercel's own adapter uses it with no
private hooks, and the official compatibility test suite is available to any adapter
author. The years of reverse engineering undocumented build output are over.

### Two findings from building this

Both verified and recorded in [`docs/design.md`](./docs/design.md) §12:

- **Next.js standalone output cannot be used with the Adapter API.** Setting
  `output: 'standalone'` while any adapter is configured fails the build with `ENOENT`
  on `.next/next-server.js.nft.json`, and this reproduces with a completely no-op
  adapter. nextship assembles the equivalent tree itself from the same trace files.
- **Next.js's server trace for a non-standalone build omits its own entry module.**
  Relying on it alone boots to `Cannot find module next/dist/server/next.js`, so the
  launcher's entry points are always traced as well.

## Repository layout

```
AGENTS.md              binding rules: attribution, doc sync, no dead code, consistency
CHANGELOG.md           every change, attributed
LICENSE                Apache-2.0
SECURITY.md            how to report a vulnerability
CONTRIBUTING.md        how to work on this
brand/                 the logo, wordmark and favicon, with a white-lettered wordmark for dark backgrounds
docs/
  design.md            locked decisions, manifest, image contract, target drivers
  roadmap.md           v0.1 to v1.0, then what is deliberately not built
  costs.md             costed comparison against Vercel at three traffic tiers
  digitalocean.md      the API token, its scopes, and what deploying costs
  vm.md                deploying to your own server: setup, security, CI, backups
  vm-target-overview.html  a walkthrough of the VM target: before and after, and every workflow step by step
conformance/           scripts for the official Next.js adapter compatibility suite,
                       streaming conformance, and vm/e2e.sh against a server over SSH
packages/
  adapter/             Next.js Adapter API implementation, injected via NEXT_ADAPTER_PATH
  cli/                 every command; runtime/ holds the files copied into a build,
                       and runtime/vm/ the setup and watchdog scripts sent to a server
site/                  the marketing site and documentation, exported as static files
```

## How correctness is proven

Every measured result, and what each one was measured on, is collected on one page:
[Evidence](https://nextship.doodlebytestudio.in/docs/evidence). It ends with what has not been proven.

```bash
pnpm build                                  # compile both packages
pnpm typecheck                              # no emit
pnpm test                                   # unit tests
node packages/cli/scripts/verify-pack.mjs   # pack, install, run the command
```

0. **Unit tests** with `node:test`: detection against on-disk fixtures
   including workspace membership, Dockerfile and ignore rendering for both layouts,
   build identity, the `docker build` argument list, registry region matching,
   rollback target selection, deployment summaries and in-progress detection,
   undeclared package detection, and the prune script as a process including its
   failure modes. CI runs them on every push and pull request, on Linux and Windows
   with Node 22 and 24.
1. **The packed package**, installed from its own tarball into an empty project on
   every push and pull request, checking that the README, LICENSE, NOTICE and adapter
   are present and that the `nextship` command runs.
2. **The Next.js adapter compatibility suite**, the official one, the same suite
   Vercel's adapter runs against. Results below.
3. **Streaming conformance**, on every push and pull request: nextship builds a fixture
   whose page renders its shell at once and its tail two seconds later, runs the image,
   and fails unless the shell arrives before the tail. The check takes any URL, so the
   same script measures a deployed target (`conformance/streaming/`). On a live App
   Platform app it passed three runs of three, first byte 230 to 448 ms against a 2.2 to
   2.4 s total.
4. **Live verification on real containers and a real DigitalOcean app**, by hand:
   every route serves, image optimization produces WebP, streaming does not buffer,
   ISR works both time-based and on-demand, Server Actions execute, and `after()`
   runs.

Not automated yet: an end-to-end run against a real cloud account on every change,
which needs a dedicated account to run against.

### Compatibility suite results

Next.js's own end-to-end corpus, in `deploy` mode, building a real container per test
file. Run against `16.4.0-canary.22` in
[run 34755775792](https://github.com/gowtham472/nextship/actions/runs/34755775792).

| | |
|---|---|
| **Suites passing** | **1123 of 1123** |
| **Assertions passing** | **3599 of 3599**, the measure Next.js's adapters support page publishes |
| **Retries** | None. Every suite passed on its first attempt |
| **Skipped by our list** | 9 tests that assert what Vercel's CDN or proxy does, listed below |
| **Reproducible** | A second run, [34757301752](https://github.com/gowtham472/nextship/actions/runs/34757301752), matched suite by suite |
| **Stable release** | On `v16.3.5`, the latest stable Next.js, [run 34761218201](https://github.com/gowtham472/nextship/actions/runs/34761218201) passed 1108 of 1108 suites and 3489 of 3489 assertions. That release has fewer suites than the canary |

The counts come from the results file Next.js's test runner writes for every suite. The
1033 tests it reports as pending are the ones deploy mode skips: those in Next.js's own
deploy manifest, those a test skips itself when deployed, and our nine. The adapters page
leaves pending tests out of both sides, and so does this.

**From 94.3% to all of it.** 1.0.1's run passed 1051 of 1115 suites. Researching each of
the 64 failures showed that most were in our harness rather than in nextship, and the table
that attributed them here was wrong in two places: packages vendored into `node_modules` and
webpack configs under Turbopack were never nextship limitations. The harness now gives each
app what Next.js's own deploy path gives it:

- **The test's variables and the harness's flags reach the build and the container.** Docker
  inherited none of them, so `NEXT_PRIVATE_TEST_MODE` never compiled in the hydration
  marker the browser tests wait for, and `IS_TURBOPACK_TEST` never told `next build` which
  bundler the suite runs.
- **Packages a fixture commits under `node_modules` survive.** npm deleted them as
  extraneous; they are restored after the image's install, as Vercel's path does.
- **The server listens where the harness looks for it,** as localhost on the harness's
  port. Behind a remapped port, an app that fetched itself reached nothing.
- **The native TypeScript config suites run with the loader** Next.js's own CI runs them
  with.

Two failures were real nextship defects, both fixed: projects with the same package name,
or none, shared one Next.js build cache, which two builds at once corrupted, and the image
left out the route module contexts a Pages Router page needs when `next/head` or
`next/router` loads outside its bundle. Earlier runs found three more: the build log never
reached the harness, the deployment id was exported only under a prefixed name, and the
builder had no Python for dependencies that compile on install.

The suite also got faster: 319 runner-minutes and 17 minutes end to end, against 788 and
50 for 1.0.1's run, in the same 32 groups. What no longer happens: a 10 second fallback on
every browser page load, a readiness check that sat out a minute for any app whose `/`
answered with an error, and a fresh dependency install for every app, because npm had
named each lockfile after its temporary directory.

#### Tests skipped as Vercel-specific

| Suite | Tests | Why |
|---|---|---|
| `prerender` | 4 caching header tests | They expect `public, max-age=0, must-revalidate`, the header Vercel's CDN sends browsers. nextship returns what Next.js sets, which the same tests expect of `next start` |
| `app-dir/expire-time` | 1 | Marked `it.failing` when deployed, because Vercel's proxy does not yet honour `expireTime`. nextship does the blocking revalidation the test describes, so the test passes and `it.failing` reports that as an error |
| `app-dir/non-ascii-cache-item-name` | 1 | Off Vercel, the fixture installs a cache handler that never returns an entry, while the test needs a cached value |
| `middleware-rewrites` | 1 | Expects a rewrite's added query values in the URL a Pages API route receives, which the test attributes to deployed proxies. nextship passes them in `req.query`, as `next start` does |
| `app-dir/not-found-non-document` | 2 | Expect the HTML 404 Vercel's routing layer serves without invoking Next.js. nextship returns Next.js's plain text 404 |

The list, with each reason, is
[`conformance/deploy-tests-manifest.nextship.json`](./conformance/deploy-tests-manifest.nextship.json).
Bun's adapter keeps a list of its own the same way.


## Roadmap

| Version | Scope | State |
|---|---|---|
| **v0.1** | Local artifact: detect, build, package | Done |
| **v0.2** | Build in Docker, prune, run and verify locally | Done |
| **v0.3** | First cloud deployment to DigitalOcean: deploy, rollback, logs | Done, verified live. Image retention and a health endpoint were moved to v0.4 with reasons |
| **v0.4** | Day-two operations: domains and TLS, env, images, destroy, logs | Done, verified live |
| **v1.0** | Trustworthy for personal use: compatibility suite results, streaming conformance, honest limitations | Done. The suite passes in full (1123 of 1123 suites), the package is on npm under Apache-2.0, and streaming conformance passes in CI and on a live App Platform app |
| **v1.1** | Any Linux server over SSH | Built, and verified end to end on a local test server. Live verification on real providers comes before release |

Beyond v1.0, each with the trigger that would justify it: correctness at scale (a
shared cache and distributed tags, needed once there is more than one instance),
git-driven previews, a hosted control plane, edge performance (which is where serving
static assets from a CDN now lives), and other frameworks. The roadmap also records
what is deliberately not being built, so those decisions stay visible rather than
looking like oversights.

Details in [`docs/roadmap.md`](./docs/roadmap.md).

## Contributing

Read [`AGENTS.md`](./AGENTS.md) first. It is binding for humans and agents alike:
every change is attributed in `CHANGELOG.md`, documentation is updated in the same
change, every line must have a consumer and a reason to exist, and logic ships with
tests that pin its failure modes as well as its successes.

## License and copyright

Apache-2.0. See [`LICENSE`](./LICENSE) for the terms and [`NOTICE`](./NOTICE) for the
copyright holders, which are **Gowtham** and **Ragul D**.

You may use, modify and redistribute this, including commercially, provided you keep the
notice and state your changes. Apache-2.0 also grants you a patent licence from every
contributor, which is why it is preferable to MIT for anything a company might adopt.

Copyright holders are listed in [`NOTICE`](./NOTICE).

The marketing site carries a few third-party components under their own licences, listed
in [`site/THIRD_PARTY_NOTICES.md`](./site/THIRD_PARTY_NOTICES.md). One of them, the hero's
light, is under the React Bits licence rather than Apache-2.0. None of them is part of
the CLI or the npm package.

## Acknowledgements

**Ragul D**, for mentorship and technical guidance throughout, and a joint copyright
holder on the result.

**Sri Sairam Techno Incubator Foundation**, which provided the tooling and the time
during the internship this was built in. The Foundation holds no claim over the code and
asked for none; the credit is given because it is deserved.
