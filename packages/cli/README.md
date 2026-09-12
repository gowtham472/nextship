<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/gowtham472/nextship/main/brand/nextship-dark.png">
    <img src="https://raw.githubusercontent.com/gowtham472/nextship/main/brand/nextship.png" alt="nextship" width="280">
  </picture>
</p>

# nextship

Deploy a Next.js app to infrastructure you own, with no Dockerfile, no `next.config` edits
and no infrastructure code. It runs on your machine or in CI, uses your cloud credentials,
and deploys to DigitalOcean App Platform.

```bash
npm install -g nextship-cli
```

The package is `nextship-cli`; the command it installs is `nextship`. npm refuses the name
`nextship` because an unrelated package called `next-ship` exists.

## Requirements

| Requirement | Why |
|---|---|
| Node.js 22 or newer | Runs the CLI |
| Docker 23 or newer, running | Every build happens inside BuildKit, so nothing compiles on your machine |
| Next.js 16.2 or newer | The Deployment Adapter API became stable in 16.2 |
| `DIGITALOCEAN_TOKEN` | Only for the commands that touch your account |

## Quick start

```bash
cd your-nextjs-app

nextship detect          # what nextship reads from this project; builds nothing
nextship doctor          # what changes when the app leaves its current platform
nextship run             # build, package and start it locally on :3000

export DIGITALOCEAN_TOKEN=dop_v1_...
nextship deploy          # print the plan and change nothing
nextship deploy --yes    # execute it
```

## Commands

```
detect           Report what nextship reads from this project
build            Build in Docker with the adapter injected
package          Build, then produce the runtime image
run              Package, then run the image locally
doctor           Report what changes when this app leaves its current platform
deploy           Show the deployment plan; --yes to execute it
rollback         Return to a previous deployment; --yes to execute it
logs             Runtime logs for the deployed app; --follow to stream
env              List runtime variables; env push to upload, env rm to remove
domain           List domains; domain add to attach, domain rm to detach
images           List pushed images; images prune to remove old ones
destroy <name>   Destroy the app this project created
```

`nextship` on its own draws the wordmark in the terminal; `nextship --help` prints every
command and option.

## What it will not do

- **Change anything without a plan.** `deploy`, `rollback` and `env rm` print what they
  will do and stop until you pass `--yes`.
- **Touch an app it did not create.** Every cloud command acts only on the app recorded in
  `nextship.json`.
- **Delete a cloud resource**, except through `destroy`, which needs the app name and
  `--yes`.
- **Send your code anywhere** but your own cloud account. There is no nextship server and
  no telemetry.
- **Change the app while a deployment is still in progress.** It refuses and names the
  deployment rather than replacing it part way through.

## Compatibility

Next.js's own end-to-end suite, run in deploy mode against a real container per test
file: 1051 of 1115 suites pass, reproduced exactly across two runs. Every failure is
attributed in the
[support matrix](https://github.com/gowtham472/nextship#compatibility-suite-results).

## Links

- [Documentation](https://nextship.saap.workers.dev/docs)
- [Source](https://github.com/gowtham472/nextship)
- [Security and credential handling](https://github.com/gowtham472/nextship/blob/main/SECURITY.md)
- [Changelog](https://github.com/gowtham472/nextship/blob/main/CHANGELOG.md)

Apache-2.0. Copyright 2026 Gowtham and Ragul D.
