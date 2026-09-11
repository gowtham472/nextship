# Changelog

All notable changes to this repository. Attribution rules: `AGENTS.md` §1.1.

## [Unreleased]

### Added

- **A local rehearsal of the AWS container path.** `conformance/aws/probe.sh` runs Floci,
  a local AWS emulator, and pushes the streaming fixture nextship builds to its container
  registry, runs it as an ECS task, checks that it streams and confirms its output reaches
  CloudWatch Logs, all without an AWS account. Against Floci 2.0.1 it passes: first byte
  192 ms against 2141 ms, five log events. Floci does not emulate Lightsail container
  services and fails to list ECR images, so `docs/design.md` §9.2 records what each
  testing layer answers, and the roadmap records that Lightsail needs AWS's Paid plan.
  (Gowtham)

### Changed

- **Ragul D's contact address in package metadata.** Every package's `contributors` entry
  now carries an email, matching the `author` entry, so the published package names a way
  to reach both copyright holders. (Gowtham)

## [1.0.0] - 2026-09-11

v1.0: trustworthy for personal use on DigitalOcean. Streaming is a test that runs on
every change and has passed against App Platform itself, and the roadmap, README and
design agree on where the project stands.

### Added

- **Streaming conformance runs on every change.** Streaming was verified once, by hand,
  as 27 ms to first byte against a 2.02 s total. `conformance/streaming/` makes it a
  test: a fixture whose page renders its shell at once and its tail two seconds later,
  built by nextship and run as an image, with a check that fails unless the shell
  arrives before the tail. CI runs it on every push and pull request. The check was
  shown to fail against a server that buffers, one that never answers and one that
  drops the connection, and it takes any URL, so the same script measures a deployed
  target. Pointed at a live App Platform app it passed three runs of three, first byte
  230 to 448 ms against 2.2 to 2.4 s, so App Platform streaming is verified rather than
  assumed. The app and its images were removed afterwards. (Gowtham)

### Docs

- **The roadmap and design say where v1.0 actually stands.** The licence, the
  compatibility suite and the npm install were all done while the v1.0 checklist still
  called them blockers, the README placed AWS before v1.0 as a "v0.5" the roadmap never
  had, and the design doc still counted 124 unit tests and called the suite unrun. They
  now agree: v1.0 is complete, and AWS is v1.1. (Gowtham)

## [0.4.4] - 2026-09-11

The CLI draws the nextship wordmark when it runs on its own, and the site is
redesigned in the brand's type and colours, searchable, and served from Cloudflare.

### Added

- **The wordmark, in the terminal and across the project.** `nextship` on its own
  draws the nextship wordmark from `brand/nextship.png` in half block characters:
  "Next" in the terminal's own text colour, so it reads on a dark or a light
  background, "Ship" in the brand blue and the dot of its i in yellow. It uses
  truecolor, 256 or 16 colours as the terminal supports, and no colour at all under
  `NO_COLOR`. A pipe, or a window narrower than the wordmark, still gets the usage, so
  a script sees the same output as before. The README and the npm page show the
  wordmark, with a white-lettered copy for dark backgrounds. (Gowtham)

### Changed

- **The site builds as static files and deploys to Cloudflare.** Every page was already
  prerendered, so `npm run build` in `site/` now writes the whole site to `out/`, which
  a static host serves with no server to run or patch. `wrangler.jsonc` serves it as a
  Worker with static assets and no script, a `_headers` file sets security headers and
  year-long caching for the content-hashed assets, and `site/README.md` gives the
  Cloudflare settings. Cloudflare installs dependencies with pnpm for this repository
  whatever `site/` declares, which installs the CLI packages instead of the site, so the
  build turns that install off and its build command runs `npm ci` first. (Gowtham)

- **The site uses the brand's typeface and colours.** Text is set in Plus Jakarta
  Sans; the palette is white, the brand blue `#005EFF` and the yellow `#FDCF18`, with a
  deep blue dark theme; and the header and footer show the wordmark. The favicon and home
  screen icon come from `brand/nextship-favicon.png`, and `brand/logo.png` is the image a
  shared link previews with. (Gowtham)

- **The landing page is redesigned.** The headline blurs in word by word and ends on the
  wordmark's yellow square, the hero terminal plays the deploy transcript, a marquee
  lists the Next.js features that keep working, the measured results count up, and a
  flow diagram, the pipeline, the guarantees and the Vercel comparison follow. The
  entrance and the playback are CSS, so they run from the first paint without
  JavaScript, and every animation stops under reduced motion. The chip above the
  headline is gone. Rays of the brand blue fall through the hero: React Bits' LightRays,
  tuned in its Background Studio, following the theme, pausing off screen and left out
  under reduced motion. That one file keeps its own licence, MIT with the Commons Clause,
  rather than Apache-2.0. The animated beam, border beam, marquee and number ticker are
  adapted from Magic UI under the MIT License. Both are recorded in
  `site/THIRD_PARTY_NOTICES.md`. (Gowtham)

- **The docs gain search and a fuller page.** Ctrl K, Cmd K or `/` searches every page
  and heading from an index built at build time. Each page has a breadcrumb, an outline
  that marks the section being read, an edit link, previous and next cards and anchors
  on its headings, and narrow screens get a menu. Code blocks say whether they hold a
  command or output and copy with one click, and callouts mark the passages not to skim.
  (Gowtham)

### Fixed

- **Docs code blocks were drawn with inline code's border and padding.** The style for
  inline code matched every `code` element, and untagged fences, which hold the CLI's
  output, skipped highlighting altogether. Every fence is now a highlighted block, and
  inline code keeps its own style. (Gowtham)

## [0.4.3] - 2026-09-10

A change is refused while the app has a deployment in progress, the README stops
claiming what nextship does not do, and the repository has a code of conduct, issue
forms and a pull request template.

### Added

- **A change is refused while the app has a deployment in progress.** `deploy`,
  `env push`, `env rm`, `domain add` and `domain rm` each wrote the app spec without
  checking, so a second command could replace a release part way through. They now
  refuse, naming the deployment and its phase, and `deploy` checks before it builds
  rather than after. App Platform reports the unfinished deployment on the app itself,
  so the check holds across machines rather than only within one. `rollback` is exempt,
  because it is how you get away from a bad deployment. (Gowtham)

- **A code of conduct, issue forms and a pull request template.** GitHub's community
  profile scored the repository 71%, missing all three. The code of conduct adopts the
  Contributor Covenant 2.1 with a private reporting address, the bug form asks for the
  version, environment and `nextship detect` output a report needs, and security reports
  are routed to private advisories rather than public issues. (Gowtham)

- **Continuous integration on every push and pull request.** Tests ran only in the release
  workflow, so a broken commit on `main` went unnoticed until the next tag. `ci.yml`
  builds, typechecks and tests on Linux and Windows with Node 22 and 24, packs the CLI and
  installs the tarball into an empty project, and builds the site. The packed-install
  check moved into `packages/cli/scripts/verify-pack.mjs`, which the release workflow
  runs too, so a pull request is held to the same bar as a release. (Gowtham)

### Docs

- **A limitation that did not exist was listed as one.** The README and the 0.4.0
  changelog said a release was waited on without a deadline. `deploy` has always stopped
  waiting after 15 minutes and `rollback` after 10; the claim came from an audit that
  searched one file and missed the one holding the timeout. Removed. (Gowtham)

- **The README claimed support and tests that do not exist.** It described nextship as
  running in "your own DigitalOcean or AWS account", drew AWS Lightsail and a shared S3
  and CDN tier into the architecture as though they were built, gave a test count of 124
  that had long gone stale, and listed end-to-end runs "on real AWS and real DigitalOcean
  on every pull request". It now describes DigitalOcean App Platform as the only target,
  static files as served by the container, and proof as what actually runs, with no test
  count to go stale again. (Gowtham)

## [0.4.2] - 2026-09-10

Packaging and project detection fixes, and releases that go live only on a maintainer's 2FA
approval.

### Changed

- **Releases are staged rather than published.** The release workflow runs
  `npm stage publish`, and the trusted publisher allows only that. A staged version goes
  live when a maintainer approves it with 2FA, from the CLI or the package page, and
  approval requires interactive authentication, so no token or workflow can perform it. A
  compromised workflow or GitHub account can stage a release but cannot ship one.
  Provenance is generated for staged versions exactly as for direct publishes. (Gowtham)

### Fixed

- **Releases could not authenticate once the npm token was removed.** `actions/setup-node`
  with `registry-url` writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into
  `.npmrc`. With the variable empty, npm treats authentication as already configured and
  never attempts the OIDC exchange, so the publish failed with `ENEEDAUTH` and nothing was
  released. The workflow no longer sets `registry-url` or `NODE_AUTH_TOKEN`, which leaves
  the trusted publisher as the only credential. (Gowtham)

- **A project inside another project's workspace was treated as a member of it.** `detect`
  took the nearest ancestor with a `pnpm-workspace.yaml` or a `workspaces` field as the
  build root without checking whether its patterns include the project, so an npm project
  kept outside a pnpm monorepo would have been built from the monorepo root, with pnpm and
  a lockfile that does not know it exists. Membership is now checked, including `**` and
  `!` exclusions, and the nearest declaration is authoritative: when it does not include
  the project, the project is standalone. (Gowtham)

- **Messages pointed installed users at files they do not have.** The missing token error,
  a `doctor` finding and the header of the generated Dockerfile named relative `docs/`
  paths, which exist in the repository and not in an npm install. They are absolute URLs
  now, and a test scans the source so a new one fails the build. (Gowtham)

- **The published package carried no README, LICENSE or NOTICE.** npm publishes the package
  directory rather than the repository, so the npm page showed no README and the two files
  Apache-2.0 requires to travel with the work were left behind. The package has its own
  README, LICENSE and NOTICE are copied from the root at pack time, and the release check
  fails if any of the three is missing. (Gowtham)

## [0.4.1] - 2026-09-10

Published as `nextship-cli`. The command it installs is still `nextship`.

npm refused the name `nextship`: an unrelated package called `next-ship` exists, and npm's
similarity check treats a name that differs only by punctuation as the same name. There is
no appeal, so the package took the closest available name. Only the install command
changes; nothing about using the tool does.

Publishing 0.4.0 also exposed a defect it would have shipped. npm rejects a `./` prefix in
a `bin` path and drops the entry rather than failing, so the package would have installed
with no `nextship` command at all, recorded only as a warning buried in the file listing:

```
npm warn publish "bin[nextship]" script name dist/index.js was invalid and removed
```

The release check missed it because it ran `node node_modules/nextship/dist/index.js`,
which works whether or not a binary is declared. It now runs the installed binary through
`node_modules/.bin` and asserts the package still declares one, so a dropped `bin` fails
the release instead of reaching a user. (Gowtham)

## [0.4.0] - 2026-09-10

**The first published version.** Everything before this lived only in the repository.

v0.4 is complete: domains and TLS, environment variables, image retention, `destroy`, and
log streaming, each verified against a live app. v0.5 is started rather than finished: the
driver interface exists and DigitalOcean implements it, the AWS driver does not.

The Next.js adapter compatibility suite has run. 1051 of 1115 suites pass, twice, with an
identical failure set, and every failure is attributed in the README.


### Release hardening

- **Version numbers disagreed with each other.** `package.json` said 0.3.0 while the
  roadmap said v0.4 was complete and v0.5 had started. Cut as **0.4.0**, the last finished
  milestone, with README, changelog, roadmap and the git tag all saying the same thing.
  Calling it 0.5.0 would have claimed AWS progress that does not exist.

- **The release workflow could not have used trusted publishing.** It runs on Node 22,
  which ships npm 10, and OIDC needs 11.5.1 or newer. The workflow now upgrades npm and
  records the toolchain it published with. npm cannot publish a package for the first time
  over OIDC at all, since a trusted publisher is configured in settings that do not exist
  until the package does, so the token is documented as a one-time bootstrap with the
  switch and the token deletion written down as the immediate next step.

- **The shipped source maps were dead weight, three times over.** They pointed at
  `../src/*.ts`, which is not published; sources were not inlined; and the CLI never asked
  Node to enable maps. Sources are inlined now and the CLI enables them, verified by
  throwing from inside an installed package and getting `src/config.ts:47:11` back rather
  than a position in emitted JavaScript. A stack trace in a bug report is now actionable.

- **`nextship.json` with no version blamed the wrong thing.** It reported
  `version undefined ... Update nextship`, sending someone with a hand-written or truncated
  file to upgrade the one thing that was not wrong. The three cases are now separate: no
  version, newer than this CLI, and older than this CLI, each with the action that fits.
  Found by testing the failure paths rather than by reading them.

- **Two limitations found by auditing the failure paths, and recorded rather than papered
  over.** A release is polled without a deadline, so a deployment that never reaches a
  terminal phase leaves `deploy` waiting until it is interrupted. And nothing locks a
  project against two concurrent runs. Neither corrupts anything, and both are now listed
  under Known limitations in the README instead of being discovered by whoever hits them
  first. (Gowtham)


### Added

- **Attribution settled, and a release workflow that publishes with provenance.**
  Copyright is held jointly by Gowtham and Ragul D, who mentored the work. The Sri Sairam
  Techno Incubator Foundation provided the tooling and the time and is acknowledged in the
  README, but holds no claim: providing a tool is not authorship, and there was no
  agreement assigning anything.

  `release.yml` publishes from CI rather than from a laptop, with `--provenance`, which
  signs a statement linking the published bytes to this repository and the exact commit.
  For a tool that asks people for a cloud token, being able to prove the published package
  came from the public source is worth more than asserting it.

  The workflow gates on build, typecheck and tests, refuses to publish when the tag
  disagrees with the package version, and installs the packed tarball into a clean project
  to prove the adapter resolves from the published tree. That last gate exists to catch
  the `workspace:*` defect if it ever returns. (Gowtham)

- **The published package no longer depends on something npm cannot install.** The CLI
  declared `"@nextship/adapter": "workspace:*"` and resolved it with `require.resolve` at
  build time. A registry cannot resolve a `workspace:` range, so installing `nextship`
  from npm would have produced a CLI that failed on the first build, unable to find its
  own adapter.

  The adapter was never a dependency in the real sense: it is a file copied into a build
  context, not a module the CLI imports. It now ships as a runtime asset beside
  `prune.cjs` and `load-env.cjs`, generated at build time by
  `packages/cli/scripts/bundle-adapter.mjs`, and stays a workspace devDependency purely so
  pnpm still builds it first. The adapter package is marked private, so there is one
  published package and no way for the two to drift apart in version.

  Also fixed while checking the payload: `npm pack` was shipping test source maps, because
  the exclusion covered `dist/**/*.test.js` but not its `.map`. The published tarball now
  contains zero test artifacts, three runtime assets, and one runtime dependency.

  Verified the way that matters: packed the tarball, installed it into a clean project,
  and ran a real build of a production app with the **installed** CLI rather than the
  workspace one. It resolved its adapter and produced an image. (Gowtham)

- **`SECURITY.md` and `CONTRIBUTING.md`.** This tool runs with a cloud token, reads env
  files and builds arbitrary projects, so a public repository needed a private reporting
  path and an honest account of what it can reach. `SECURITY.md` states the exposures
  plainly rather than implying there are none: the built image contains the Server Actions
  encryption key, pushed variables are readable from an app console, and `destroy` is not
  recoverable. (Gowtham)

- **Licensed under Apache-2.0, and the name verified rather than assumed.** The project
  had no license, which meant that as public code it was still all rights reserved and
  legally unusable by anyone. That was the hardest release blocker and the cheapest to
  fix.

  Apache-2.0 chosen over MIT for its explicit patent grant, which is what makes a
  company's legal review straightforward, and over AGPL because adoption matters more here
  than protecting a hosted business that does not exist yet. `LICENSE` is the canonical
  text fetched from apache.org rather than retyped, with a `NOTICE` carrying the copyright,
  and every manifest now declares the license and author.

  The name was checked before committing to it, since the README had warned since the
  first commit that it was a placeholder. `nextship` is free on npm and has no competing
  product. `nextpush` was considered and rejected on evidence: `nextpush-cli` is already
  published as the "Management CLI for the NextPush service", so taking that name would
  have made this the second NextPush. (Gowtham)

- **v1.0 scoped to DigitalOcean, and the conformance scripts run for the first time.**
  AWS moved to v1.1: v1.0 means trustworthy for personal use, the person using it deploys
  to DigitalOcean, and holding a release for a second cloud nobody has asked for would
  delay the evidence that actually matters.

  The three harness scripts had been written, committed and never executed. Run against a
  real application: `e2e-deploy.sh` exits 0 having printed exactly one URL on stdout, which
  is the whole contract since the harness parses that line, and the URL serves 200.
  `e2e-logs.sh` emits all five markers the harness reads. `e2e-cleanup.sh` removes both the
  container and the image. Verifying this first matters because the suite is hours of CI,
  and a broken script would have failed sixteen parallel groups before anyone learned
  anything. (Gowtham)

- **A driver interface, so a second cloud is a new driver rather than an edit to every
  command.** Every command imported the DigitalOcean client directly, and twenty-four of
  its operations were reachable from commands. Several were App Platform concepts rather
  than deployment concepts: rollback pins the app and then commits or reverts, an update
  replaces the whole spec so it has to be merged first, and reclaiming registry storage
  is a separate pass that makes the registry read-only. None of those exist on AWS.

  An interface built from those twenty-four operations would have been a DigitalOcean
  interface with a second cloud forced through it, which proves nothing. So `Target` is
  expressed as intent: `rollback(appId, to)` rather than validate-pin-commit, and
  `reclaim()` that can answer `not-needed` for a platform with nothing to run. The
  platform orchestration moved out of the commands and into
  `targets/digitalocean-target.ts`, and the App Platform spec manipulation into
  `targets/digitalocean-spec.ts`.

  A few decisions only a driver can make are now asked of it rather than assumed.
  `previewEnv` reports how each value would be stored, because App Platform encrypts
  anything not already public and cannot return it afterwards, and a plan should be able
  to say that without a command knowing the words `SECRET` or `GENERAL`.

  Verified by everything still behaving identically: 124 tests, and `domain`, `images`,
  `env`, and the `rollback`, `deploy` and `destroy` plans all producing the same output
  against the live app, including the preserved-settings line and the DNS warning.
  **This is proven against one cloud, which makes it a hypothesis until the second
  driver exists.** (Gowtham)

- **Base image evaluated and deliberately kept.** `node:24-slim` is 332 MB of a 591 MB
  image, so it looked like the biggest remaining saving. Measured instead of assumed:

  | Base | Size | sharp resize, median of 15 |
  |---|---|---|
  | `node:24-slim` (glibc, kept) | 332 MB | **37.1 ms** |
  | `node:24-alpine` (musl) | 235 MB | 91.8 ms |
  | `distroless/nodejs24` (glibc) | 203 MB | not benchmarked |

  Alpine is 2.5 times slower for the same resize on identical libvips 8.18.6, and saves
  97 MB rather than the 150 to 200 the roadmap estimated. Image optimization is the most
  expensive thing this server does, so that is the wrong trade. Distroless keeps glibc
  and saves 129 MB, but removes the shell that diagnosing this system has repeatedly
  required. The deciding argument is that a base layer is cached per node and does not
  travel per deploy, so shrinking it optimises a number that mostly does not move, while
  pruning already took the layers that do move from 469 MB to 58 MB. (Gowtham)

- **The health check path is chosen from the build, not fixed at `/`.** A health check
  polls for as long as the app exists, so probing a route that renders on every request
  is a cost that never stops. The adapter reads the prerender manifest and reports a
  static route: `/` when it is prerendered, otherwise any prerendered route, and nothing
  when the build prerenders none, in which case the CLI falls back to `/` and says that
  it renders.

  A dedicated endpoint was considered and rejected on the evidence. The launcher hands
  the HTTP server to Next.js, so answering a path of our own means replacing
  `startServer` and owning keep-alive, upgrades and error handling on the most critical
  path in the system. Checking the real project first showed `/` is already prerendered,
  so the cost being solved was zero there and only exists for apps that prerender
  nothing. (Gowtham)

- **`nextship logs --follow`.** Logs were a snapshot only, which is the wrong shape
  while reproducing something. It streams over the websocket App Platform already
  returns, and Ctrl+C closes the socket cleanly rather than killing the process
  mid-line. Registering a signal handler stops Node exiting on Ctrl+C by itself, so a
  close the server never answers would hang the command with nothing to do but kill it;
  the close is raced against a short timer that finishes anyway. Verified against the
  live app: it connected, printed the backlog, streamed, and returned about a second
  after the interrupt. Eight tests on frame decoding, with fixtures built by
  `JSON.stringify` so an escaping mistake in a test cannot make the fixture disagree
  with what the server sends. (Gowtham)

- **`logs` moved into its own module.** It had been living in `rollback.ts`, a file
  that needed the word "and" to describe it, which `AGENTS.md` §4.2 says should be two
  files. (Gowtham)

- **`nextship destroy <app-name>`.** The lifecycle could create and update but not
  cleanly undo, so a project that was finished with left an app running and billing.

  It is the only command that removes infrastructure, so it does not inherit the
  safety the others get from being unable to delete. It takes two gates instead of
  one: the app name is a required argument that must match what the project recorded,
  and `--yes` still has to follow. The name is the real protection, because every
  other command acts on the current directory and `--yes` alone in the wrong one would
  destroy the wrong app.

  It removes the app, and with `--images` that project's images followed by garbage
  collection. Collection is started rather than suggested, because by then the app is
  gone and every other command resolves the registry through it, so recommending
  `images prune --gc` would be an instruction that cannot be followed. Never removed:
  the registry, which the whole account shares, and DNS records, which nextship did not
  create. The plan warns by name that the generated hostname is not reissued, so a
  custom domain pointing at it will need its record updated.

  Verified against a disposable app created for the purpose rather than against a real
  one: the app was removed, `nextship.json` kept its settings but dropped the app id so
  a later deploy creates a fresh one, a second run refused cleanly, and the other four
  apps and the live site were untouched. Four tests cover the name guard. (Gowtham)

- **Registry image retention: `nextship images` and `images prune`.** Every deploy
  pushed an image and nothing ever removed one, so storage grew without bound against a
  billed quota. The registry had reached 390 MiB for a single small app.

  **Two measurements pull in opposite directions, and both were made against the real
  registry rather than reasoned about.** Deleting a tag reclaims nothing: the manifest
  survives untagged and still references its layers, so collection freed 0 bytes and
  deleted 0 blobs. But deleting untagged manifests destroys running deployments,
  because a tag points to an OCI index whose platform manifests the API also reports as
  untagged: the live tag here is a 3.9 KB index whose amd64 child is a 181.9 MiB
  manifest listed as untagged.

  So retention is reachability. The tags being kept are roots, everything they
  reference is kept with them, and only manifests no retained tag can reach are
  deleted, parents before children because the registry refuses to remove a manifest
  another still references. The image the app is deployed from is never pruned whatever
  `--keep` says, because removing it leaves an app that runs until something reschedules
  it and then cannot start.

  Garbage collection is explicit rather than part of a deploy: it puts the registry into
  read-only mode while it runs and can wait fifteen minutes to begin, so a deploy that
  overlapped it would fail to push. Sixteen tests, including that the image a live tag
  points at is never removed despite being reported untagged, that a manifest shared by
  two retained indexes survives, and that an index is deleted before its children.
  Verified live end to end. (Gowtham)

- **Custom domains and TLS: `nextship domain`, `domain add`, `domain rm`.** An app was
  reachable only at its generated `.ondigitalocean.app` name. `domain add` attaches a
  hostname to the app and prints the CNAME record to create; App Platform then issues
  and renews the certificate once that record resolves, so TLS needs no configuration.

  **nextship never edits DNS.** That needs a token scope beyond deploying, and a tool
  holding it can break every service on a domain rather than just the app it was
  pointed at. Verified that the deploy token is already refused by the DNS API, so the
  boundary is real rather than a promise. `zone` is deliberately never set in the spec,
  since that asks App Platform to manage records it cannot see when the domain lives
  elsewhere.

  The full hostname is printed rather than the "host" portion control panels ask for,
  because splitting a name needs the public suffix list to be correct and a wrong split
  silently creates a record at the wrong name. Sixteen tests, including that a pasted
  URL is refused by name, that the platform's own domain cannot be attached, that
  adding or removing a domain leaves `ingress` and the service untouched, and that
  promoting a primary demotes the previous one. Verified live against
  `preview.doodlebytestudio.in`. (Gowtham)

- **`nextship env` and `nextship env push`.** A deployed container started with
  nothing in its environment: env files are mounted as build secrets and never
  enter an image layer, which is what keeps them out of the registry, but it also
  means nothing survived to runtime. Values Next.js inlines at build time, such as
  `NEXT_PUBLIC_*`, still worked, so an app booted and most pages rendered while
  anything read at request time was undefined. `env` lists the keys set on the app
  and never their values, since App Platform secrets cannot be read back at all.
  `env push` uploads the project's env files as encrypted `RUN_TIME` secrets, in
  Next.js's own precedence order, behind a plan and `--yes`. It adds and updates;
  a variable it does not mention keeps its value, so a push cannot remove one set
  in the control panel. (Gowtham)

- **`nextship env rm`.** Without it a pushed variable was permanent: `mergeEnvs`
  re-sends every key it is not given, so deleting a line from `.env` and pushing again
  left the old value live forever, and a key pushed by mistake could not be taken back.
  Every key must be named, with no wildcard and no `--all`, and if any named key is not
  set the whole command refuses rather than removing the others and reporting success.
  (Gowtham)

  Uploading is deliberately **not** part of `deploy`. A local `.env` usually holds
  development values, and shipping those to production as a side effect of
  deploying is a failure that looks like a working deploy. `deploy` warns instead,
  in the plan, before anything is built.

### Fixed

- **The compatibility results are reproducible, which is what makes them worth
  publishing.** The suite was run a second time hours later on separate runners and
  returned 1051 of 1115 again, failing a byte-identical set of 64 suites. Nothing in the
  support matrix is a runner having a bad day, so every entry is a real limitation someone
  else can reproduce. For contrast, Next.js's own deploy manifest records 33 flaky tests in
  a single suite for the reference adapter. (Gowtham)

- **The LICENSE appendix still carried Apache's `[yyyy] [name of copyright owner]`
  placeholder.** Filled in with 2026 and both copyright holders, matching `NOTICE`. The
  verbatim license text above the appendix is unchanged, and was diffed to prove it.

- **The site named a domain nobody has registered.** `metadataBase` pointed at
  `nextship.dev`, which would have produced Open Graph card images that 404 wherever the
  page was shared. It now reads `NEXT_PUBLIC_SITE_URL` and falls back to localhost, which
  is the honest default for a site that has no home yet. (Gowtham)

- **A package installed but not declared failed the build with a message about the wrong
  thing.** nextship installs from your lockfile inside the image and never ships the host
  `node_modules`, because those binaries are built for the machine you develop on. A
  package sitting in `node_modules` that nothing declares therefore reaches the build on
  your machine and not in the image, and Next.js reports `Module not found: Can't resolve
  'x'`, which names the import and nothing about the cause.

  `doctor` now reports these as blockers, before any build runs. Reachability is computed
  by walking the installed manifests rather than parsing a lockfile, because the three
  package managers write three formats and all of them already agree about what a package
  depends on. Measured against a real 230 package install and a pnpm workspace: no false
  positives, 274 ms and 10 ms.

  This was the largest single cause in the compatibility suite, 19 of 64 failures. Shipping
  the host `node_modules` would have turned a loud failure into a container running
  binaries built for the wrong platform, so the fix is to name the cause rather than to
  hide it. (Gowtham)

- **The compatibility suite has run, and the results are published.** 1051 of 1115 suites
  pass, 94.3%, against Next.js `16.4.0-canary.22`. Every one of the 64 failures is
  attributed in the README: 17 need an experimental flag the framework itself only sets in
  dev and start mode, 16 are packages vendored into `node_modules` that nextship does not
  ship by design, 6 are a `webpack` config under a harness that forces Turbopack, and 25
  are still being diagnosed.

  This was the last thing v1.0 claimed but had not done. Running it found three defects no
  unit test would have caught, all now fixed, which moved the rate from 93.4% to 94.3% with
  no regressions. Publishing the failures alongside the number is the point: a support
  claim nobody can check is worth nothing. (Gowtham)

- **A marketing page and documentation site, under `site/`.** Next.js 16.3.4, App Router,
  Tailwind v4, and eleven MDX pages covering getting started, the guides and the reference.
  Every page is prerendered; there is nothing to render per request.

  It is deliberately outside the pnpm workspace. The release workflow runs
  `pnpm install --frozen-lockfile` and `pnpm build` before publishing the CLI, and adding a
  Next.js app to the workspace would put React and a full site build on the critical path
  of every npm publish, for a package that depends on none of it.

  The docs outline is declared in `lib/nav.ts` rather than derived from the filesystem,
  and the build reconciles the two in both directions: a navigation entry with no file
  fails, and a file nothing links to fails. Those are the two quiet failure modes of a
  docs site, so neither is allowed to be quiet. (Gowtham)

- **A dependency that compiles on install could not build.** `node:*-slim` carries no
  Python and no compiler, so any package falling back to node-gyp failed the install with
  `Could not find any Python installation to use`, which reads as a broken project rather
  than a missing build tool. The builder stage now installs `python3`, `make` and `g++` in
  its own layer above the install, so it is cached rather than paid for on every build.
  The builder is discarded, so the runtime image is unchanged. (Gowtham)

### Changed

- **The compatibility suite runs in thirty-two groups instead of sixteen.** Measured on the
  first full run: the slowest group took 69 minutes against a 90 minute cap, with a spread
  of 28 to 69 minutes, so the suite would have started timing out as it grew. Timeouts are
  the worst failure mode here, because they look like results. (Gowtham)

- **The deployment id was invisible to a config that reads the environment.** The adapter
  puts it into the resolved config, which serves a `next.config` that reads its argument.
  A config that reads `process.env` directly saw nothing, because the build exported the
  id only as `NEXTSHIP_DEPLOYMENT_ID`. Found by the compatibility suite, where a fixture
  aborts the build with `Neither NEXT_PUBLIC_BUILD_ID nor NEXT_DEPLOYMENT_ID is set`. The
  build now exports both names from one `ARG`, so they cannot disagree. (Gowtham)

- **The suite could have been testing a Next.js nobody was testing.** The harness rewrites
  dependencies to `file:./next-test-packages/<name>/packed.tgz` so the app runs the build
  from the checkout under test. If that rewrite does not happen, the install resolves a
  published build from the registry instead and the whole run measures the wrong Next.js,
  which a passing log looks identical to. The deploy script now records the staged
  dependencies, whether the local tarballs exist, and the path Next.js actually resolved
  from. (Gowtham)

- **The compatibility suite never saw the build output.** In deploy mode the harness takes
  `next.cliOutput` from the logs script, and ours returned only the marker file, the server
  log and the live container log. Every test asserting on something Next.js printed while
  building, `deprecation-warnings` for one, failed against an empty build log regardless of
  how correct the deployment was.

  The packaging log is now returned after the markers, with the marker-shaped lines from
  the app's own post-build script filtered out so they cannot shadow ours: that copy reads
  `DEPLOYMENT_ID` from a variable the build does not set and reports it as `undefined`.
  (Gowtham)

- **Two ways the harness scripts could fail on top of an existing failure.** The logs
  script read its build log through a `&&` chain, so under `set -e` a missing log made the
  whole step exit non-zero, reporting a logs failure on top of whatever had already gone
  wrong. And appending exclusion rules to a project `.dockerignore` that lacked a trailing
  newline would have spliced its last rule into the first appended one, silently changing
  both. Rehearsed against both cases rather than reasoned about. (Gowtham)

- **The compatibility suite rebuilt every app twice.** Packaging runs two Docker builds,
  a manifest target and then the runtime image, and the harness scripts wrote their logs
  into the app directory, which is the build context. The log grew between the two builds,
  so `COPY . .` missed the cache on the second and everything after it re-ran: the whole
  Next.js build again, plus an 11 second trace prune. About 16 seconds wasted on every
  test in a suite where the per-group budget is already the binding constraint.

  The logs now live in a sibling directory, so the context is byte identical across both
  builds. Only the suite was affected: a real deploy writes nothing into the context
  between builds, since the manifest output and the actions key are both already ignored.
  (Gowtham)

- **The compatibility suite tried to compile its own test files as part of the app.**
  Each test's fixture directory is staged wholesale, so `app-action.test.ts` and its
  siblings arrive at the root of the app next to its `app/` directory. Next.js finds no
  tsconfig, writes a default one that includes `**/*.ts`, and type checks the test file
  against an app whose package.json never declared a test runner, so the build fails with
  `Cannot find name 'expect'`.

  Run in place inside the Next.js repo those files resolve jest's types by walking up to
  the monorepo root. In an isolated container there is nothing to walk up into, which is
  a property of deploying rather than a defect. The test files are now excluded from the
  build context: a deploy target has no business compiling the suite that tests it.
  (Gowtham)

- **The compatibility suite reported a build id of `unknown` for every test.** The deploy
  script read `.next/BUILD_ID` from the runner's filesystem, but nextship builds inside
  Docker, so `.next` never exists out there and the read fell through to its `unknown`
  fallback on every single test. The harness constructs `/_next/data/<buildId>/` URLs
  from that value, so every Pages Router data request in the suite asked for a path that
  could not exist, and the results were measuring the harness wiring rather than nextship.

  The real id is printed by the post-build script the harness injects into the app, which
  runs inside the image, so it is now read back out of the packaging log. The script fails
  loudly when the marker is absent, because a silent `unknown` is precisely the failure
  that made four runs uninterpretable. (Gowtham)

- **Dependency source maps and development runtimes were shipped in the image.** The
  trace ignore list excluded them, but it only applied while tracing: a trace entry
  that resolves to a directory was copied wholesale with no filter, so the same files
  came back in through a different door. Measured on a real build,
  `next/dist/compiled/next-server` alone was 58 MB of the 87 MB of `next/dist`, almost
  all of it `.map` and `.dev.js`.

  They are now excluded at the point of copying, whatever asks for them. Result:
  `compiled/next-server` 58 MB to 3.7 MB, `next/dist` 87 MB to 34 MB, `node_modules`
  111 MB to 58 MB, image **660 MB to 591 MB**. Verified the trimmed image still serves:
  all routes 200, unknown path 404, image optimization returns a byte-identical 66 KB
  WebP, boot unchanged.

  Application source maps under `.next` are deliberately kept, since those are the ones
  worth having for a stack trace. Development runtimes are unreachable because the image
  sets `NODE_ENV=production`, confirmed by reading the selection code in
  `module.compiled.js`. `env push` now warns that setting `NODE_ENV=development` would
  stop the container starting, which is a sharper consequence than before this change.
  (Gowtham)

- **`destroy --images` warned about a read-only registry when there were no images.**
  With nothing to remove it would still have announced garbage collection and then
  started one with nothing to collect, taking the whole account's registry read-only
  for no reason. `--images` now only counts as an image removal when there is at least
  one image. Caught by running the plan against an app whose repository was empty.
  (Gowtham)

- **The first version of retention deleted tags and reclaimed nothing.** It was built on
  the assumption that removing a tag lets garbage collection free the image. Measured
  against the real registry, collection then reported `blobs deleted: 0, freed: 0.0 MiB`
  and the manifest count was unchanged: deleting a tag leaves the manifest in place,
  merely untagged, still referencing every layer. Retention now works on reachability
  from retained tags and deletes manifests by digest. Caught because the run was
  measured rather than assumed to have worked. (Gowtham)

- **Deleting a child manifest before its index was refused by the registry.** "manifest
  is referenced by one or more other manifests". The removal set was processed in the
  order the API happened to list it, which put a platform image before the index
  pointing at it, so the first delete failed. Removals are now ordered parents first.
  Nothing had been deleted when it failed, so the registry was left consistent.
  (Gowtham)

- **`images prune --gc` did nothing when there was nothing to prune.** The command
  printed "storage is not reclaimed until garbage collection runs; add --gc to start
  it", but that path returned early before reaching collection, so the instruction it
  gave was a dead end. Found by running the command the output had just recommended.
  Collection now runs independently of whether any tag was removed. (Gowtham)

- **Image sizes were reported as 0.0 MiB for every image.** The figure came from the
  tag, which is an index of a few kilobytes rather than the content, so the listing
  implied images were free. Storage is now reported once for the registry, which is
  the billed number, and the misleading per-tag field was removed rather than left to
  invite the same mistake back. (Gowtham)

- **`deploy` and `rollback` reported a URL that answers nothing.** Attaching a custom
  domain makes it the app's primary, and App Platform then returns it as `live_url`,
  which both commands printed as the deployed address. A domain does not resolve until
  its DNS record exists, so a successful deploy would announce a dead link. Both now
  report the platform hostname, which always serves, and list custom domains with the
  state reported for each. Found by running it: `live_url` had already become
  `https://preview.doodlebytestudio.in` while the name did not resolve. (Gowtham)

- **The domain plan described a role that does not happen.** `domain add` without
  `--primary` said "alias", but App Platform promotes the first custom domain on an app
  to primary whatever the spec asks. Confirmed by sending `ALIAS` and reading `PRIMARY`
  back. The request now matches the outcome and the plan says why. A domain in
  `CONFIGURING` was also described as "DNS found", which was false: that phase is
  reached immediately on attaching, verified against a hostname with no record at all.
  (Gowtham)

- **The env file parser silently corrupted secrets, and is gone.** It was hand written
  and passed fourteen tests, and every one of the following was verified by running it,
  not by reading it: `PASSWORD="p@ss" # the "prod" one` produced `p@ss" # the "prod`,
  because the closing quote was found with `lastIndexOf` from the end of the line; a
  multi-line PEM private key was truncated to `"-----BEGIN KEY-----`; and
  `$VAR` was never expanded, so a value containing one reached production literally.
  All three deploy cleanly and fail at request time, which is the exact failure class
  the module claimed to defend against.

  Values are now read by **`@next/env`**, the loader Next.js itself uses, resolved from
  the project so it is the version that project builds with. Parity with the build is
  structural rather than something to keep writing tests for. Re-verified against the
  same inputs: the password parses as `p@ss`, the private key survives whole, and
  `postgres://$DB_HOST/app` expands. (Gowtham)

- **Expansion could have exfiltrated the API token.** `@next/env` expands `$VAR`
  against the environment it runs in, so a line such as `TOKEN=$DIGITALOCEAN_TOKEN` in
  a project's `.env` would have resolved to the live token and uploaded it to the
  deployment target. The loader runs as its own process with a deliberately minimal
  environment, which also keeps `loadEnvConfig` from writing into the environment the
  CLI later hands to `docker build`. Verified with the token exported and that exact
  line in a file: it resolved to empty. It reads `parsedEnv`, never `combinedEnv`,
  which is the whole ambient environment merged over the files. (Gowtham)

- **Every value was stored as an encrypted secret, including public ones.**
  `NEXT_PUBLIC_*` values are compiled into the JavaScript every visitor downloads, so
  storing them encrypted claimed a protection that did not exist and made them
  permanently unreadable. They are now stored `GENERAL`; everything else is `SECRET`.
  Confirmed on the live app: the secret came back as `EV[1:...]` with no readable
  value, the public one as plaintext. (Gowtham)

- **A push silently narrowed a variable it did not own.** A key set in the control panel
  as `GENERAL` / `RUN_AND_BUILD_TIME` was rewritten to `SECRET` / `RUN_TIME`, removing a
  build-time scope while the plan output promised that nothing is removed. A push now
  never weakens what is there: a stored secret is never downgraded, and an existing
  broader scope is kept. (Gowtham)

- **An API error could have printed a secret.** The update request carries plaintext
  values and errors are rendered from the response body, so a validation message
  quoting the rejected field would have put a secret in the terminal. Values are
  scrubbed from any error raised by the write. (Gowtham)

- **`env` reported "none" for an app that had variables.** It read only nextship's own
  service, ignoring app-level `spec.envs` and every other component, which is the same
  false negative that made `detect` call an installed `sharp` missing. It now reports
  every variable and where it lives, and fails on a missing app instead of rendering a
  404 as an empty list. `pushEnv` refuses when the `web` component is absent rather
  than performing an identity map and reporting success. (Gowtham)

- **The same helper existed three times.** `client()` and `ownedApp()` were byte
  identical in `rollback.ts` and `env.ts`, and `deploy.ts` held a third copy of the
  token check with different instructions for the same failure, so the advice a user
  got depended on which command they ran first. One `owned-app.ts` now serves all
  three. (Gowtham)

- **README claimed "no delete call anywhere in the codebase".** False: the CLI removes
  the temporary Docker config directory it creates. Restated as what is actually
  guaranteed, which is that no cloud resource is ever deleted. The changelog also
  claimed fifteen env tests where there were fourteen. (Gowtham)

- **A deploy could silently drop app settings it did not manage.** `PUT /apps/{id}`
  replaces the whole spec, and nextship built its spec from scratch every time, so
  anything the request omitted was gone. This was not hypothetical: the live app
  carries an `ingress` block nextship never sends, and the same path would have
  taken custom domains, alerts, runtime environment variables and any second
  component with it. The existing spec is now read first and used as the base, with
  only the fields nextship is responsible for written over it; objects are merged
  rather than replaced, so values App Platform fills in itself, such as the registry
  name, survive. The plan names what is being preserved. Verified against the real
  spec: unmerged would have sent three top-level keys where the live app has four,
  and the merge keeps `ingress` byte for byte. Seven tests. (Gowtham)


### Docs

- **Documentation restructured for a public repository.** Numeric prefixes dropped, so
  files are named for what they are: `design.md`, `roadmap.md`, `costs.md`,
  `digitalocean.md`, `review.md`. The two competitive-analysis documents moved to
  `docs/private/`, which is gitignored: one asks whether this is the wrong product and the
  other critiques named competitors, and neither belongs in a public release.

  `review.md` deliberately stayed public. Four source files cite it as the origin of a
  specific defect, so publishing the code while hiding the review would leave those
  citations pointing at nothing.

  Every relative link was then checked programmatically, in both directions, rather than
  by eye: eight were broken after the move, including private documents whose links to
  public ones needed to climb a directory. All resolve now. (Gowtham)

- **AWS compute chosen deliberately, and Lambda recorded as a non-goal.** The roadmap
  named ECS Express Mode at about $35 a month, mostly an unavoidable load balancer,
  without having weighed the alternatives. Checked against the Lightsail container
  services FAQ:

  | Option | Per month | Load balancer | Verdict |
  |---|---|---|---|
  | Lambda + Function URL | ~$0 to $2 | n/a | Rejected on correctness, not price |
  | **Lightsail container service** | **$7 to $15** | **built in, not billed separately** | **v0.5 default** |
  | ECS Express Mode | ~$35 | ~$16 to $18 | `--compute ecs`, for VPC and scale |

  Lightsail includes a load balanced TLS endpoint, automatic HTTP to HTTPS redirect,
  custom domains with a free domain-validated certificate, retained deployment history
  that a previous version can be redeployed from, and 500 GB of transfer per service.
  That maps onto `Target` almost one to one, including rollback, which really is "deploy
  a previous version".

  **Lambda is rejected on correctness rather than cost, and it would have been the
  cheapest.** It cannot run `next start`, so the app has to be split into functions and
  the routing pipeline re-implemented, which is the work `design.md` §2.1 exists to
  avoid. It also cannot port, since DigitalOcean has no Lambda.

  **One finding shapes the driver before it is written:** Lightsail container services
  cannot pull from a private registry. The FAQ is explicit that only public registries
  are supported, so the private path is `aws lightsail push-container-image`, which needs
  the `lightsailctl` plugin. That makes `pushImage` not a `docker push`, gives
  `prepareImageStore` nothing to create, and makes `reclaim()` answer `not-needed`, which
  is exactly why that outcome exists in the interface. It also adds the first user
  dependency beyond Docker, which the plan has to name rather than fail on.

  Every claim above was then put through an adversarial verification pass (205 agents,
  178 claims confirmed, 20 refuted, 61 questions left open). Three results changed the
  plan rather than confirming it:

  - **Rollback is scriptable after all.** The user guide documents redeploying a previous
    version only as a console procedure, which read like a capability gap. It is a
    documentation gap: `GetContainerServiceDeployments` returns each retained version with
    its full spec and `CreateContainerServiceDeployment` accepts that spec back.
  - **A claim about databases was wrong, and in our favour.** Lightsail container services
    do have private networking: a `<service>.service.local` domain, and managed databases
    reachable only within the account with public mode off by default. What Lightsail
    lacks is a normal VPC, so reaching an RDS instance in a private subnet is the
    `--compute ecs` case. That splits the "already on AWS" argument across the two options
    instead of resting it on one.
  - **The streaming question is genuinely unknown, not merely undocumented.** The pass
    knocked down both comfortable inferences: nothing published establishes that the
    endpoint is an Application Load Balancer, and ALB's WebSocket support would not prove
    it streams ordinary HTTP responses even if it were.

  A second risk is now recorded next to it: Lightsail is on neither the maintenance nor
  the sunset list as of 2026-09-08, but its user guide shows no document-history entry
  after 31 October 2025, and App Runner's own closure was announced 31 March 2026.
  Absence from a maintenance list is a point-in-time fact, not a commitment. (Gowtham)

- **The AWS target was wrong before any code was written.** The design named App Runner
  throughout. AWS has closed App Runner to new customers and will add no further
  features, so no new user of nextship could have used it. The replacement AWS
  recommends is ECS Express Mode, which provisions Fargate behind an Application Load
  Balancer in one call.

  The load balancer is the part that matters. `costs.md` already carried a
  Fargate + ALB column showing a $16 floor for the load balancer alone, and with App
  Runner gone that column is the realistic AWS number: **AWS becomes the most expensive
  of the three at small and medium scale, and DigitalOcean is cheapest at every tier
  measured.** The roadmap now states that the reason to support AWS is that people are
  already on AWS, not that it saves money, because that saving does not exist.

  v0.5 also gained the prerequisite it was missing: there is no driver interface today,
  every command imports the DigitalOcean client directly, and several of its 24
  operations are DigitalOcean concepts rather than deployment concepts. Building the
  interface from those would produce a DigitalOcean interface with AWS forced through
  it. (Gowtham)

- **Static assets on a CDN moved from v0.4 to v5, and non-goals recorded explicitly.**
  Serving `public/` and `_next/static` from Spaces is the largest size win left, 78 MB
  of a 591 MB image, but it is performance rather than correctness: the container serves
  that media correctly today, and it would add a second billable service to an account
  running one app. That is what the roadmap's own sequencing principles say to defer, so
  it now sits in v5 alongside the other CDN work, with the trigger written next to it.

  The roadmap also gained a "deliberately not built" section, so `env pull`, log
  forwarding and a dedicated health endpoint read as decisions with reasons rather than
  as gaps nobody noticed. (Gowtham)

## [0.3.0] - 2026-09-08

First cloud deployment. `deploy`, `rollback` and `logs` work against a real
DigitalOcean account and were verified on a live app rather than in a fixture.
Two v0.3 deliverables were deliberately not built and moved to v0.4: registry
image retention, because pruning old tags means deleting, and a dedicated health
endpoint, because serving one means the launcher handling a request before Next.js
does. Both are recorded with their reasons in `docs/roadmap.md`.

### Added

- **v0.3 verification pass, run end to end before the version was closed.** Typecheck,
  57 unit tests, both error paths of the argument parser, the missing-token path, then
  the whole pipeline against the real project: `detect`, `doctor`, `package` (image
  built, `linux/amd64`), `run` (all five routes 200, unknown path 404, a 1.80 MB PNG
  served as a 66 KB WebP, `dpl=` present on assets, container reported `healthy`,
  `docker stop` returned in 2.27 s and the command reported a clean stop), then
  `deploy`, `rollback` and `logs` in plan mode against the live app. The pass found
  two defects and one wrong claim, all recorded below. (Gowtham)

- **`nextship rollback` and `nextship logs`, verified against the live app.**
  Rollback re-releases an image that already ran, so it builds nothing, pushes
  nothing, and cannot introduce a new fault. App Platform pins an app for the
  duration of a rollback and a pinned app refuses further deployments, so the pin
  is validated before it is taken, committed as soon as the rollback reports
  active, and reverted on every failure path in between. Both commands act only on
  the app recorded in `nextship.json`. Exercised end to end twice on the real
  deployment: back to the initial build, then forward again with `--to`. The site
  served the expected deployment id each time, the app was left unpinned, and all
  three deployments remained in the history. (Gowtham)

- **`nextship doctor`.** Reports what changes when an app leaves Vercel, which
  nothing else covered and no build error reveals: Vercel packages that degrade
  silently (`@vercel/analytics` stops reporting and nothing errors), cron jobs in
  `vercel.json` that will simply never run, routing rules there that stop applying,
  Vercel environment variables read in source that become undefined, and a missing
  lockfile. Run against the real project it immediately flagged `@vercel/analytics`.
  Findings are sorted with blockers first and each carries a consequence and an
  action. Seven tests. (Gowtham)
- **Adapter compatibility harness integration.** The three scripts the official
  suite requires (`conformance/e2e-deploy.sh`, `e2e-logs.sh`, `e2e-cleanup.sh`) and
  a `conformance` workflow that clones and builds Next.js and runs the suite in
  sixteen groups. The deploy script reads its image tag from what packaging
  reported rather than the newest image on the daemon, which would be wrong under
  the harness's concurrency, and asks the kernel for a free port rather than
  assuming 3000. **The suite itself has not been run**, so no support matrix is
  published. (Gowtham)

- **15 more unit tests**, 34 in total. Build identity (an env change, a Dockerfile
  change, a key change and the env file list each produce a new id; a missing env
  file is an error; an explicit id wins; a non-reproducible source never reuses an
  id) and the `docker build` argument list (platform, build arg, label, secret
  mounts, that the key never appears in the argument list, and the export target).
  (Gowtham)

- **Streaming, ISR, on-demand revalidation, Server Actions and `after()` verified
  against a purpose-built app.** The real project had none of these, so a Next.js
  16.3.4 app was written with a 2 s Suspense boundary, a 5 s ISR route, a
  `revalidatePath` route handler, a Server Action form and an `after()` callback,
  then packaged and run through nextship. Results: streaming TTFB 27 ms against a
  2.02 s total, so the shell arrives before the slow boundary and nothing buffers;
  three consecutive ISR requests inside the window return identical content with
  `x-nextjs-cache: HIT`, and the page regenerates past the window; `revalidatePath`
  purges and re-renders on the next request; a Server Action submitted as a plain
  form POST executed three times and incremented state, which is the path that
  decrypts the action closure and therefore exercises the encryption key handling;
  the `after()` callback ran and wrote to disk. Skew protection appears as `dpl=` on
  assets, and `docker stop` returns in 2.5 s with exit 143. (Gowtham)
- **The launcher-trace fallback confirmed in production.** That app is Next.js
  16.3.4, where no server trace is written at all while an adapter is configured
  (`server: launcher trace 2093 files (Next.js wrote no server trace)`). Its image
  boots, so the fallback path is what makes 16.3.x work. (Gowtham)
- **The build runs inside Docker.** Install, `next build` with the adapter, and
  pruning all happen in a builder stage on the platform the image runs on. The
  Server Actions key is read from the CLI's environment and mounted as a BuildKit
  secret; each env file the project has is mounted at its own path for the build
  step only, in the order Next.js loads them. Neither enters an image layer. The
  package manager's store is a cache mount, so repeat builds only download what
  changed. The manifest is exported from a scratch stage with BuildKit's local
  exporter. Nothing is compiled on the developer's machine any more. (Gowtham)
- **Trace-based pruning, `runtime/prune.cjs`.** Copies exactly what Next.js's own
  trace files list: per-route `.nft.json`, the server trace when written, and a
  trace of the launcher's entry points made with the node-file-trace Next.js bundles.
  Symlinks are reproduced as symlinks. Writes the same `server.cjs` launcher that
  standalone mode generates, with the resolved config inlined, which keeps
  `@next/swc` out of the runtime image. On the real project: `node_modules` 469 MB
  to 111 MB, image 1.13 GB to 660 MB. (Gowtham)
- **Production hardening.** `HEALTHCHECK` in the image using node's own `fetch`;
  npm and corepack removed from the runtime stage; a Docker version gate for
  BuildKit; missing binaries fail by name; a corrupted `secrets.local.json` refuses
  to rotate the key; Ctrl+C during `nextship run` and an external `docker stop` are
  both reported as a normal stop (exit 130 and 143, the codes Next.js exits with
  after draining); `--version`.
  Graceful shutdown verified as Next.js's own path, exit 143 in about 2.5 s.
  (Gowtham)
- **19 unit tests** with `node:test`, run by `pnpm test`: detection against on-disk
  fixtures, Dockerfile and ignore rendering for both layouts, and the prune script
  as a process, including symlink reproduction, the no-server-trace path, and its
  failure modes. `AGENTS.md` now requires tests for logic and precise failures.
  (Gowtham)

- **Monorepo and workspace support.** A package inside a workspace is built from the
  workspace root, since that is where the lockfile and sibling manifests live.
  Dependencies hoisted to the root are found, the installed tree is kept whole so
  relative symlinks to sibling packages keep resolving, and `PATH` carries both
  `node_modules/.bin` directories because package managers disagree about where a
  workspace package's binaries land. `detect` reports the workspace root and app
  directory. Verified against a pnpm workspace: the app serves, and an import of a
  sibling package resolves to its real source in the image. (Gowtham)
- **Verified against a real production project** (Next.js 16.2.9, pnpm, 21 routes,
  heavy `next/image`). All 13 routes return 200, unknown paths 404, the server is
  ready in 223 ms, and image optimization works: a 22 KB PNG is served as a 14 KB
  WebP, which only happens when sharp is functioning on Linux. Optimizer URLs carry
  the `dpl` parameter, so skew protection covers images too. (Gowtham)
- **v0.2 verified end to end against a real Next.js 16.3.4 app**, created fresh with
  `create-next-app`. Page returns 200, hashed assets return 200 with the right
  content type, unknown paths return 404, the server reports ready in about 220 ms,
  `sharp` loads its Linux binary, `@next/swc-linux-x64-gnu` is present,
  devDependencies are absent from the image, and the project's env file reaches the
  container. (Gowtham)
- **`nextship run`.** Packages the project and starts the image locally on the port
  from the manifest, loading the project's env file so secrets stay out of the image.
  Runs attached, so Ctrl+C stops and removes the container and there is no leftover
  state to clean up. This exists so the artifact can be verified before any cloud
  account is involved. (Gowtham)

- **CLI `detect` / `build` / `package` pipeline.** `detect` resolves the project
  root, installed Next.js version, package manager, build command, Node major and
  sharp version, so nothing that can be read from the repository is ever asked of
  the user. `build` runs the project's own build command with the adapter injected
  through `NEXT_ADAPTER_PATH`, leaving `next.config.js` untouched. `package`
  generates a Dockerfile from the build output and produces a runnable image.
  (Gowtham)
- **Adapter API version gate.** `detect` fails with an actionable message when the
  installed Next.js is older than 16.2, which is the release that made the
  Deployment Adapter API stable. (Gowtham)
- **Persistent Server Actions encryption key.** The CLI reads
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` from the environment, or generates one into
  `.nextship/secrets.local.json` and reuses it. A new key per build would break
  Server Actions for any client still running the previous build. (Gowtham)
- **`AGENTS.md`.** Binding rules for every contributor: change attribution,
  documentation kept in sync within the same change, no dead or hanging code,
  consistency of style and terminology, and a definition of done. (Gowtham)
- **TypeScript build configuration.** A shared `tsconfig.base.json` with
  `noUnusedLocals` and `noUnusedParameters` enabled, so the no-dead-code rule is
  enforced by the compiler and not only by review. Each package gained `build` and
  `typecheck` scripts, which makes the `bin` and `exports` paths real rather than
  pointing at a `dist` nothing produced. (Gowtham)

### Changed

- **Deployment id format is `dpl-<commit>`**, with a random suffix when the working
  tree has uncommitted changes and the CLI saying so, and fully random outside git.
  It is also the image tag, replacing the content hash. (Gowtham)
- **Process spawning uses cross-spawn**, not `shell: true`. Node deprecates the
  latter because arguments are concatenated into a shell string, and it printed a
  deprecation warning to users on every build. (Gowtham)
- **Manifest trimmed again.** `runtime` and `requires` had no reader once the
  Dockerfile stopped depending on the manifest; jemalloc is now always installed at
  1 MB rather than conditionally. Four fields remain, each read. (Gowtham)
- **Dropped `output: 'standalone'`, which is incompatible with the Adapter API.**
  Verified against Next.js 16.3.4: setting it while an adapter is configured fails
  the build with `ENOENT` on `.next/next-server.js.nft.json` and leaves a standalone
  directory with no `server.js`. This reproduces with a completely no-op adapter, so
  it is the combination that breaks rather than our adapter. Standalone also writes
  its output after `onBuildComplete` runs, so the hook could not read it even if the
  two were compatible. The image now copies the project's compiled `.next` and runs
  `next start`. (Gowtham)
- **Image build context moved back to the project root**, since the files the image
  needs live there. A generated `.nextship/Dockerfile.dockerignore` excludes
  everything by default and re-includes only what is required, and the Dockerfile
  copies paths explicitly rather than using `COPY . .`, so source and env files still
  cannot reach the image. (Gowtham)
- **Ship Output reduced to `manifest.json`.** With no standalone bundle to copy, the
  `server/` and `assets/` directories had no consumer and were removed under
  `AGENTS.md` §3.1. The asset split returns in v0.4, when CDN upload reads it.
  (Gowtham)
- **v0.3 target fixed as DigitalOcean**, on the cost evidence and because App
  Platform needs no load balancer. AWS moves to v0.5. (Gowtham)
- **Roadmap restructured into versions, with v1.0 scoped as a personal tool.**
  Phases became v0.1 through v1.0, each independently usable. Work that only matters
  once other people depend on the tool moved to a "Beyond v1.0" section, each item
  recorded with the trigger that would justify building it, so skipping it stays a
  deliberate decision rather than an oversight. (Gowtham)
- **Positioning rewritten** in `docs/design.md` §14 to state plainly that v1.0 is
  a personal tool rather than a product, citing the competitive and cost findings
  that motivated the narrowing, and preserving the product-shaped pitch for the
  version where it would actually be true. (Gowtham)
- **Manifest trimmed to fields with a consumer.** It now carries `version`,
  `buildId`, `deploymentId`, `framework`, `runtime` and `requires`. The previously
  drafted `routes`, `prerenders`, `middleware`, `crons`, `env` and `static` fields
  had no reader and were removed under `AGENTS.md` §3.1. The manifest is versioned,
  so later phases add fields in the change that starts reading them. (Gowtham)
- **Prose style.** No em dashes anywhere in the repository, per `AGENTS.md` §4.1.
  (Gowtham)

### Fixed

- **`detect` reported an installed package as missing.** It probed only
  `node_modules/<name>`, but pnpm links just direct dependencies there. `sharp` is
  transitive for most Next.js projects, so `detect` said "not resolvable from the app
  root" for a project whose image was then shown to contain sharp 0.34.5 with its
  Linux binary. A wrong absence is worse than no report at all, since it invites
  installing a package that is already present. The probe now also reads pnpm's store,
  preferring a top-level link when both exist because that is the copy Node would
  load. Three tests: the transitive case, the precedence case, and that a genuinely
  absent package is still reported absent. (Gowtham)

- **The README documented output that did not reproduce.** Its `detect` example listed
  a sharp version and two env files for a project that has neither, and its `package`
  example showed an image tag with a registry prefix the local build does not apply.
  Both were replaced with output copied from real runs, and the tag section now
  explains what the deployment id is derived from and what `build` prints when the
  working tree is not a clean commit. (Gowtham)

- **Rollback could never find a target.** A deployment that has been replaced
  reports phase `SUPERSEDED`, not `ACTIVE`, so filtering for `ACTIVE` matched only
  the deployment already live. Against an app with two perfectly good deployments
  the command insisted there was nothing to roll back to. Candidate selection is
  now its own tested function that accepts both phases and excludes deployments
  which never served. Five tests pin the behaviour, including that `ERROR` and
  `CANCELED` stay excluded. (Gowtham)

- **Rollback plans printed raw deployment ids instead of image tags.** The image
  tag was read from `services[].source_image.tag`, a path that does not exist on
  the deployments endpoint: the sibling `services[]` array carries only a resolved
  digest, and the tag lives in the deployment's own `spec`. Reading a missing path
  yields `undefined` rather than an error, so this failed silently and cost the
  plan the one identifier a human can match against a build. Two tests use a
  fixture copied from a real API response, shaped so that reading the wrong field
  fails. (Gowtham)

- **`nextship logs` reported no output for an app that was plainly running.** It
  read `historic_urls`, which App Platform populates only when log forwarding is
  configured and which was empty on every request. The live `url` it returns is a
  websocket endpoint that also answers a plain GET with everything currently
  buffered, which is what makes a one-shot `logs` command possible; that is now
  the source, with `historic_urls` still read when present. These URLs embed an
  access token, so they are kept out of every log line and error message, and each
  read has its own timeout so one unreachable chunk cannot discard the rest. The
  empty case now states that App Platform buffers only the running container's
  output, rather than implying the app printed nothing. (Gowtham)

- **Editing a build helper produced a new image under an unchanged tag.** The digest
  covered the nextship version rather than the helper files themselves, so changing
  `prune.cjs` or the adapter without releasing reintroduced the identity defect in a
  narrower form. Found immediately after fixing the prune script, by noticing the tag
  had not moved. The digest now covers the contents of both helpers. (Gowtham)
- **Images were missing the two files standalone output adds by hand.** Next.js's
  `collect-build-traces` appends `jest-worker/processChild` and `threadChild` only
  when `isStandalone` is set. They are spawned as child processes by path rather
  than imported, so no trace lists them and nextship's prune could not have found
  them. Found by reading Next.js's source rather than by a failure, which is why it
  is worth recording: the failure mode would have been a worker spawn crashing at
  runtime under conditions the smoke tests never reach. (Gowtham)

- **An environment variable change shipped the old value under the same image tag.**
  Env files reach the build as BuildKit secret mounts, whose contents are
  deliberately excluded from the cache key, and the tag came from the git commit, so
  changing a value invalidated nothing and produced a byte-different image with an
  identical name. The deployment id is now a content address over the nextship
  version, the generated Dockerfile, the encryption key, and the name and contents of
  every env file. Verified by re-running the original experiment. This also makes
  rollback exact, since a tag now names one set of bytes. (Gowtham)
- **No target platform was pinned**, so the image was built for whichever
  architecture ran the command. An arm64 machine produced an image that cannot run on
  the amd64 hosts both clouds default to, failing at deploy time rather than build
  time. Every build now passes `--platform linux/amd64`. (Gowtham)
- **A one-character source change cost a 150 second rebuild.** `COPY . .` preceded
  the dependency install, so any edit re-ran it. Measured per step: the install is
  97.6 s and the Next.js compile is 6.3 s. Manifests are now copied before sources,
  using `COPY --parents` so a workspace's nested manifests keep their directories,
  and the application is copied after the install. A source-change rebuild went from
  150 s to 56 s. Next.js's own build cache is also kept across builds as a cache
  mount, which is correct but was not the cause. (Gowtham)
- **A project `.dockerignore` could undo nextship's exclusions.** Its rules were
  appended last, and Docker resolves conflicts by last match, so a project rule such
  as `!.env` would re-include files meant to arrive only as secret mounts. Project
  rules are merged in first and ours last. (Gowtham)
- **The Server Actions key silently differed across machines.** It lives in a
  git-ignored file, so CI generated its own and broke Server Actions for clients on
  builds made elsewhere. The CLI now says so when it generates a key, and warns when
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` disagrees with the stored value. (Gowtham)

- **Dependencies are installed inside the image instead of copied from the host.**
  A Windows-resolved `node_modules` put Windows binaries in a linux image: the
  container started, then tried to download `@next/swc-linux-x64-gnu` at runtime and
  died with `EACCES` creating a home directory the system user does not have. An
  earlier image only worked by accident, because a stray `npm install sharp` step was
  silently reinstalling next's Linux binaries, which was also what made that layer
  205 MB. A `deps` stage now runs the project's own package manager with a frozen
  lockfile and production-only dependencies. (Gowtham)
- **The adapter ships with the CLI rather than being installed into the user's
  project.** `NEXT_ADAPTER_PATH` takes an absolute path, so the adapter never needed
  to be a project dependency. Having it there put a `file:` entry in the project
  lockfile, and npm cannot build a virtual tree from a lockfile whose link target is
  missing, which broke `npm ci` inside the image and was reported misleadingly as a
  missing lockfile. Users now install one package. (Gowtham)
- **Image size cut from 1.56 GB to 773 MB.** `chown -R` after copying rewrote every
  file and added a second full-size copy of the application, measured at 351 MB.
  Ownership is now set by `COPY --chown` with the runtime user created first.
  Dropping devDependencies accounted for the rest. (Gowtham)
- **Workspace images keep sibling package sources.** An earlier attempt lifted only
  `node_modules` into the runtime image, which left every workspace symlink dangling:
  `@mono/ui` pointed at `../../../../packages/ui`, a path that did not exist in the
  image, so any import of a sibling package would have failed at runtime. (Gowtham)
- **Docker availability check queries the daemon, not the CLI.** `docker --version`
  succeeds while the daemon is stopped, so packaging would start and then fail with a
  named-pipe error that told the user nothing. It now runs
  `docker version --format {{.Server.Version}}` and says to start Docker. (Gowtham)

### Removed

- **`util/hash.ts`.** The image tag is the deployment id, so the content hash had no
  consumer. (Gowtham)
- **Host-side `node_modules` copying and the `deps` stage that replaced it.** Both
  superseded by building inside Docker. (Gowtham)
- **`packages/runtime` and its cache handler.** Next.js ships a correct filesystem
  cache handler, which is the right choice for the single-instance target of
  Phase 1. A custom handler with one local implementation and no consumer was
  speculative structure under `AGENTS.md` §3.1. A shared cache handler is Phase 3
  work and is tracked in `docs/roadmap.md`. (Gowtham)
- **Build-time cache seeding and the `cache/` output directory.** Writing seeded
  entries requires knowing the internal cache key format, which has not been
  verified. Claiming it would have been a fabricated capability under
  `AGENTS.md` §3.1. Prerendered pages still ship inside the standalone bundle.
  (Gowtham)
- **The fabricated `/_nextship/health` endpoint.** Nothing served it. Health
  checking is defined when the deployment drivers land. (Gowtham)
- **`templates/Dockerfile`.** The Dockerfile is generated in code from the
  manifest. A template file alongside the generator would have been a second
  source of truth. (Gowtham)
- **Unused exports.** `log.warn` had no caller and `build.OUTPUT_DIR` had no
  importer outside its own module. (Gowtham)

### Docs

- **`README.md` rewritten as a reference rather than a pitch.** Every command now has
  its own section with its full flag table, its actual output, and what it refuses to
  do, checked against the argument parser rather than written from memory. New
  sections cover requirements, install, a quick start, the safety guarantees stated
  as structural properties, `nextship.json`, every environment variable the CLI reads,
  and the exact list of files written into a project. Two numbers were overstated and
  are corrected: streaming first-byte is 27 ms, matching the measurement in
  `design.md` §11, and the image is 660 MB against 1.13 GB before pruning rather
  than against a figure measured on a different build. The compressed size, 182 MiB,
  is now the registry's own reported storage rather than a recollection. Every
  document and path the README links was checked to exist. (Gowtham)

- **`engines: { node: ">=22" }` declared** in all three manifests, so the README's
  stated Node requirement is enforced by the package manager instead of merely
  asserted. (Gowtham)

- `docs/digitalocean.md`: what the API token is, exactly which operations
  nextship will use it for, how to create one with custom scopes limited to the
  registry and apps rather than full account access, how to supply and revoke it,
  and what it costs. Records that the free registry tier is 500 MiB against a
  660 MB image, and that rollback needs more than one image retained, so a Basic
  registry at $5 is the realistic starting point alongside the $5 app. (Gowtham)

- `docs/review.md`: an adversarial pass over the design and
  differentiation documents. Reproduced three defects (an env change ships the old
  value under the same tag; no target platform is pinned; a one-character source
  change costs a 145 second cold build), found that the Server Actions key does not
  survive a change of machine, that the ISR cache is ephemeral and undocumented, that
  Vercel migration is absent from every document, and concluded that the claimed moat
  is weaker than stated: the only durable differentiator in the plan is the unbuilt
  v2 correctness layer. Everything is prioritised P0 to P3, with a verification
  method for each item rather than an assertion. (Gowtham)
- Competitive analysis, kept internal rather than published: every competitor in detail (Vercel, OpenNext, SST,
  Netlify, Cloudflare, Amplify, Firebase, Azure, Flightcontrol, Coolify, Dokploy,
  CapRover, Dokku, Kamal, Railway, Render, Fly, DigitalOcean App Platform, and plain
  Docker), a layer diagram of who occupies which part of the stack, a feature matrix
  marking which claims were measured here, the five things that are genuinely
  different, and a section listing where nextship is worse or not different at all.
  (Gowtham)

- `docs/costs.md`: costed comparison against Vercel Pro at three traffic
  tiers using September 2026 list prices. Finds that below roughly 1 TB of monthly
  egress Vercel is hard to beat and a self-hosted setup can cost more, that above
  that line savings are 40 percent on AWS and 80 percent on DigitalOcean, that
  bandwidth rather than compute drives all of it, and that per-seat pricing is the
  larger factor for teams on modest traffic. (Gowtham)
- Competitive validation, kept internal rather than published: evidence-based check on whether nextship
  duplicates OpenNext, and whether the space it targets is already served. Finds
  that OpenNext sits at a different layer and is not a duplicate, but that the
  "zero-config deploy to your own cloud" position is already held by Flightcontrol,
  Amplify, Coolify, Dokploy and DigitalOcean App Platform. Identifies multi-instance
  runtime correctness as the genuinely unoccupied position, and records two claims
  needing first-hand verification. Positioning is not yet changed in
  `docs/design.md` §14; that decision is open. (Gowtham)
- `docs/design.md`: build output layout, manifest schema, image contract and
  the host build tradeoff updated to describe what now exists. (Gowtham)
- `docs/roadmap.md`: Phase 1 weeks 1 to 3 marked against real status, with the
  cache seeding and monorepo gaps recorded. (Gowtham)
- `README.md`: repository layout and commands updated to the shipped pipeline.
  (Gowtham)

---

## Prior work

- **Design spec and roadmap** covering locked decisions, the Ship Output format,
  driver interface, AWS and DigitalOcean resource matrix and conformance gates.
  (Gowtham)
- **Research dossier** on Vercel's Next.js build and runtime internals, the
  Adapter API, and what competitors had to reverse engineer. (Gowtham)
