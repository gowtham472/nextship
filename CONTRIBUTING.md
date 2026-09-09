# Contributing

Read [`AGENTS.md`](./AGENTS.md) first. It is the binding rule set for this repository and
applies to humans and AI assistants alike. This file is the practical companion: how to
get set up and what a change is expected to look like.

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

You need Node 22 or newer and a running Docker 23 or newer. Every build happens inside
Docker, so nothing is compiled on your machine and there is no toolchain to install
beyond those two.

To run your working copy against a real project:

```bash
npm link --workspace packages/cli
cd ~/some-nextjs-app
nextship detect
```

## What a change is expected to include

`AGENTS.md` is the authority; these are the parts contributors trip over most.

**Every line must have a consumer.** No dead code, no unused exports, no configuration
option nothing reads. The compiler is set up to catch most of this, and a review will
catch the rest.

**Say why, not what.** The code already says what it does. A comment earns its place by
explaining a decision, a constraint, or a failure that shaped the code. Several comments
in this repository record a specific measured result, because that is what stops someone
"simplifying" the code back into the bug.

**Claims need evidence.** Do not write that something works. Run it, then write what
happened. Much of this project's history is defects found by running the thing rather
than by reading it, and the docs say so.

**Tests pin failure modes, not just successes.** A test that only proves the happy path
does not protect anything. Where a bug is fixed, the test should fail if the bug returns.

**Documentation changes in the same commit as the code.** A README that describes
behaviour that no longer exists is worse than no README.

**No em dashes or en dashes**, in code, comments, docs or commit messages. Use a colon,
a comma, or parentheses.

## Commits

Imperative subject, and a body that explains the reasoning rather than restating the
diff. Every change is recorded in [`CHANGELOG.md`](./CHANGELOG.md) under `[Unreleased]`
with attribution.

## Verifying against a real cloud

Some behaviour can only be verified against a live account, and doing so costs real
money. If you cannot, say so in the pull request rather than claiming verification that
did not happen. An honest "not verified" is worth more than a confident guess, and this
project's history has several defects that only a live run exposed.

## Running the compatibility suite

The Next.js adapter compatibility suite runs in CI, because it clones and builds Next.js
from source and then runs sixteen parallel groups. Trigger it from the Actions tab. It
needs a repository secret named `CONFORMANCE_ACTIONS_KEY` holding a base64 string:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

One fixed key is required because the suite builds many apps and Server Actions must stay
decryptable across all of them.

## Releasing

Releases are published from CI, never from a laptop. `.github/workflows/release.yml`
builds, typechecks, tests, refuses to continue if the git tag disagrees with the package
version, installs the packed tarball into a clean project to prove it works, and only then
publishes with `--provenance`.

Provenance signs a statement linking the published bytes to this repository and the exact
commit, which anyone can verify on the npm page. For a tool that asks people for a cloud
token, that is worth more than a promise.

**One-time setup.** Create an npm **automation** token (npmjs.com, Access Tokens,
Generate). An interactive token will fail in CI, because it prompts for 2FA. Add it as a
repository secret named `NPM_TOKEN`.

**Each release:**

1. Run the compatibility suite and make sure the support matrix in the README reflects it.
   Publishing claims about Next.js support that nothing has tested is the one mistake that
   costs trust permanently.
2. Move everything under `## [Unreleased]` in the changelog into a new version heading.
3. Bump the version in `packages/cli/package.json`.
4. Dry run: Actions, release, Run workflow, leave `dryRun` checked. It packs and verifies
   without publishing.
5. Tag and push. The tag triggers the real publish:

```bash
git tag v0.4.0 && git push origin v0.4.0
```

### Maintainers

The package is published from a personal npm account, because copyright sits with the
authors rather than with any organisation. Publish rights are granted separately, and
only after the first publish exists:

```bash
npm owner add <npm-username> nextship
npm owner ls nextship
```

A maintainer can publish new versions and can unpublish, so it is a real grant rather
than a credit. Credit belongs in `contributors` and in the acknowledgements, which cost
nothing and take nothing away.
